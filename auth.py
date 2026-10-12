"""
Authentication Module for Web Application
Handles login, device tracking, and license verification using Supabase
"""

from fastapi import HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from supabase import create_client, Client
from datetime import datetime, timezone, timedelta
import re
import time
import uuid
from pathlib import Path
from logger import log_info, log_error, log_user_action
from security import (
    validate_email,
    validate_device_id,
    sanitize_device_name,
    MIN_PASSWORD_LENGTH,
    MAX_PASSWORD_LENGTH,
)

# In-memory token store: {token -> {"user_id", "expires_at", "email"}}
_token_store: dict = {}
# Tek aktif oturum zorunluluğu: {user_id -> token}
_user_to_token: dict = {}
# İptal edilen token'lar: {token -> revoked_at} - başka cihaz tespiti için
_revoked_tokens: dict = {}

# Supabase Configuration
import os
from dotenv import load_dotenv
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise EnvironmentError(
        "SUPABASE_URL ve SUPABASE_KEY ortam değişkenleri tanımlı değil. "
        "Proje kök dizininde bir .env dosyası oluşturun."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def _get_request_client() -> Client:
    """Her istek için yeni Supabase client oluşturur (shared auth state sorununu önler)."""
    return create_client(SUPABASE_URL, SUPABASE_KEY)

class LoginRequest(BaseModel):
    email: str
    password: str
    device_id: str
    device_name: Optional[str] = "Bilinmeyen Cihaz"

class ForgotPasswordRequest(BaseModel):
    email: str


async def login_user(request: LoginRequest):
    """
    Authenticate user with email/password and manage device registration
    
    Flow:
    1. Authenticate with Supabase Auth
    2. Check if device is already registered for this user
    3. If device exists: allow login
    4. If device is new: check user's device limit from Supabase
    5. If under limit: register new device and allow login
    6. If at limit: show error message
    7. Verify license status
    """
    try:
        email = request.email.strip().lower()
        password = request.password
        device_id = request.device_id.strip()
        device_name = request.device_name

        # Input validation
        if not email or not password:
            return {
                "success": False,
                "error": "E-posta ve şifre boş bırakılamaz."
            }

        if not validate_email(email):
            return {
                "success": False,
                "error": "Geçerli bir e-posta adresi girin."
            }

        if len(password) < MIN_PASSWORD_LENGTH or len(password) > MAX_PASSWORD_LENGTH:
            return {
                "success": False,
                "error": "Şifre uzunluğu geçersiz."
            }

        if not validate_device_id(device_id):
            return {
                "success": False,
                "error": "Cihaz kimliği geçersiz."
            }

        device_name = sanitize_device_name(device_name)

        log_user_action("unknown", "LOGIN_ATTEMPT", f"E-posta: {email}, Device ID: {device_id[:16]}...")

        # Her istek için yeni Supabase client (shared auth state sorununu önler)
        sb = _get_request_client()

        # Step 1: Authenticate with Supabase
        try:
            auth_response = sb.auth.sign_in_with_password({
                "email": email,
                "password": password
            })
            user_id = auth_response.user.id
        except Exception as auth_error:
            error_msg = str(auth_error).lower()
            if "invalid login credentials" in error_msg:
                log_user_action("unknown", "LOGIN_FAILED", f"E-posta: {email}, Hata: Hatalı kimlik bilgileri")
                return {
                    "success": False,
                    "error": "Hatalı e-posta veya şifre."
                }
            else:
                log_error(f"Auth error: {auth_error}")
                return {
                    "success": False,
                    "error": "Bağlantı hatası veya yetki sorunu."
                }

        # Step 2: Check if device is already registered
        device_check = sb.table("user_devices").select("*").eq("user_id", user_id).eq("device_id", device_id).execute()

        if len(device_check.data) > 0:
            # Device already registered, proceed to license check
            log_user_action(user_id, "DEVICE_RECOGNIZED", f"Device ID: {device_id[:16]}...")
            license_result = check_license_status(user_id, sb)
            _write_user_log(user_id, "LOGIN_SUCCESS", f"Cihaz tanındı: {device_name}", supabase_client=sb)
            return _attach_session_token(user_id, license_result, email=email)
        else:
            # New device, check limit
            log_user_action(user_id, "NEW_DEVICE_DETECTED", f"Device ID: {device_id[:16]}...")
            
            # Get user's device limit from Supabase
            try:
                profile_res = sb.table("profiles").select("max_devices").eq("id", user_id).single().execute()
                
                # Get limit from Supabase (default to 1 if not set)
                user_limit = profile_res.data.get('max_devices', 1) if profile_res.data else 1
                
                # Count current devices
                all_devices = sb.table("user_devices").select("id", count="exact").eq("user_id", user_id).execute()
                current_device_count = all_devices.count if all_devices.count else 0
                
                if current_device_count < user_limit:
                    # Register new device
                    insert_result = sb.table("user_devices").insert({
                        "user_id": user_id,
                        "device_id": device_id,
                        "device_name": device_name,
                        "added_at": datetime.now(timezone.utc).isoformat()
                    }).execute()
                    
                    # Insert sonucunu doğrula
                    if not insert_result.data:
                        log_error(f"Device insert failed for user={user_id}, device={device_id}. RLS veya constraint hatası olabilir.")
                        return {
                            "success": False,
                            "error": "Cihaz kaydı yapılamadı. Lütfen tekrar deneyin."
                        }
                    
                    log_user_action(user_id, "DEVICE_REGISTERED", f"Device: {device_name}, Total: {current_device_count + 1}/{user_limit}")
                    _write_user_log(user_id, "DEVICE_REGISTERED", f"Yeni cihaz eklendi: {device_name} ({current_device_count + 1}/{user_limit})", supabase_client=sb)
                    
                    # Check license
                    license_result = check_license_status(user_id, sb)
                    if license_result.get("success"):
                        _write_user_log(user_id, "LOGIN_SUCCESS", f"Giriş başarılı: {device_name}", supabase_client=sb)
                    return _attach_session_token(user_id, license_result, email=email)
                else:
                    # Limit reached
                    log_user_action(user_id, "DEVICE_LIMIT_REACHED", f"Limit: {user_limit}")
                    _write_user_log(user_id, "DEVICE_LIMIT_REACHED", f"Cihaz limiti aşıldı ({user_limit}): {device_name}", supabase_client=sb)
                    return {
                        "success": False,
                        "error": f"Cihaz limitiniz ({user_limit}) dolmuştur. Maksimum bilgisayar sayısına ulaştınız. Lütfen iletişime geçin."
                    }
            except Exception as limit_error:
                log_error(f"Device limit check/register error: {limit_error}")
                # Cihaz kaydı başarısız - login'e izin VERME
                return {
                    "success": False,
                    "error": "Cihaz kaydı sırasında hata oluştu. Lütfen tekrar deneyin."
                }

    except Exception as e:
        log_error(f"Login process error: {e}")
        return {
            "success": False,
            "error": "Sistem hatası oluştu."
        }


def check_license_status(user_id: str, sb: Client = None):
    """
    Check if user has valid license
    
    Returns:
        dict: success status and message
    """
    try:
        # Get user profile
        client = sb or supabase
        response = client.table("profiles").select("*").eq("id", user_id).execute()

        if not response.data or len(response.data) == 0:
            log_error(f"Profile not found for user: {user_id}")
            return {
                "success": False,
                "error": "Profil bilgileri bulunamadı. Lütfen iletişime geçin."
            }

        profile_data = response.data[0]
        now = datetime.now(timezone.utc)

        # 1. Admin Check
        if profile_data.get("license_type") == "Admin":
            log_user_action(user_id, "LOGIN_SUCCESS", "Admin giriş")
            return {
                "success": True,
                "message": "Yönetici girişi başarılı. Hoş geldiniz."
            }

        # 2. Purchased License Check
        if profile_data.get("lisans_bitis"):
            try:
                end_date = datetime.fromisoformat(profile_data["lisans_bitis"].replace('Z', '+00:00'))
                if end_date > now:
                    log_user_action(user_id, "LOGIN_SUCCESS", "Lisans aktif")
                    return {
                        "success": True,
                        "message": "Lisansınız aktif."
                    }
                else:
                    log_user_action(user_id, "LOGIN_FAILED", "Lisans süresi dolmuş")
                    return {
                        "success": False,
                        "error": "Lisans süreniz dolmuştur!"
                    }
            except Exception as date_error:
                log_error(f"License date parse error: {date_error}")

        # 3. Manual Trial Period Check
        if profile_data.get("deneme_baslangic"):
            try:
                start_date = datetime.fromisoformat(profile_data["deneme_baslangic"].replace('Z', '+00:00'))
                end_date = start_date + timedelta(days=30)
                
                if end_date > now:
                    remaining_days = (end_date - now).days
                    log_user_action(user_id, "LOGIN_SUCCESS", f"Deneme sürümü, kalan: {remaining_days} gün")
                    return {
                        "success": True,
                        "message": f"Deneme sürümü aktif. Kalan: {remaining_days} gün."
                    }
                else:
                    log_user_action(user_id, "LOGIN_FAILED", "Deneme süresi dolmuş")
                    return {
                        "success": False,
                        "error": "Deneme süreniz doldu!"
                    }
            except Exception as date_error:
                log_error(f"Trial date parse error: {date_error}")

        # 4. No License Found
        log_user_action(user_id, "LOGIN_FAILED", "Lisans bulunamadı")
        return {
            "success": False,
            "error": "Lisansınız bulunmuyor. Lütfen aktivasyon için iletişime geçin."
        }

    except Exception as e:
        log_error(f"License check error: {e}")
        return {
            "success": False,
            "error": "Lisans kontrolü sırasında hata oluştu."
        }


_TOKEN_STORE = Path("temp_data") / ".tokens"
_TOKEN_TTL_SECONDS  = int(os.getenv("SESSION_TTL_HOURS",  "8")) * 3600   # Mutlak süre (8 saat)
_TOKEN_IDLE_SECONDS = int(os.getenv("SESSION_IDLE_MINUTES", "90")) * 60  # Hareketsizlik süresi (90 dk)


def _persist_token(token: str, user_id: str, email: str = "") -> None:
    """Token→user_id+email eşlemesini diske yazar (sunucu yeniden başlatılsa da geçerli kalır)."""
    try:
        import json as _json, time as _time
        _TOKEN_STORE.mkdir(parents=True, exist_ok=True)
        token_file = _TOKEN_STORE / f"{token}.json"
        payload = {"user_id": user_id, "expires_at": _time.time() + _TOKEN_TTL_SECONDS}
        if email:
            payload["email"] = email
        token_file.write_text(_json.dumps(payload), encoding="utf-8")
    except Exception as e:
        log_error(f"Token persist hatası: {e}")


def _attach_session_token(user_id: str, result: dict, email: str = "") -> dict:
    """Başarılı girişlerde yeni bir session token üretip memory+disk'e kaydeder."""
    if not result.get("success"):
        return result
    token = str(uuid.uuid4())
    # Önceki token'ı iptal et (başka cihazdan giriş senaryosu)
    old_token = _user_to_token.get(user_id)
    if old_token:
        _token_store.pop(old_token, None)
        _revoked_tokens[old_token] = time.time()
        try:
            (_TOKEN_STORE / f"{old_token}.json").unlink(missing_ok=True)
        except Exception:
            pass
    now = time.time()
    _token_store[token] = {
        "user_id":    user_id,
        "expires_at": now + _TOKEN_TTL_SECONDS,
        "last_active": now,
        "email":      email,
    }
    _user_to_token[user_id] = token
    _persist_token(token, user_id, email)
    result["session_token"] = token
    log_info(f"Session token oluşturuldu: user={user_id[:8]}... TTL={_TOKEN_TTL_SECONDS // 3600}s")
    return result


async def verify_session_token(token: str) -> dict:
    """Verilen token hâlâ aktif mi diye kontrol eder. Sebep kodu ile yanıt döner."""
    if not token:
        return {"valid": False, "reason": "no_token"}
    if token in _revoked_tokens:
        return {"valid": False, "reason": "revoked"}
    entry = _token_store.get(token)
    if entry:
        now = time.time()
        if entry.get("expires_at", 0) < now:
            _token_store.pop(token, None)
            _user_to_token.pop(entry.get("user_id"), None)
            return {"valid": False, "reason": "expired"}
        if now - entry.get("last_active", now) > _TOKEN_IDLE_SECONDS:
            _token_store.pop(token, None)
            _user_to_token.pop(entry.get("user_id"), None)
            return {"valid": False, "reason": "idle"}
        return {"valid": True}
    # Sunucu yeniden başlatılmışsa disk'ten kontrol et
    user_id = get_user_id_from_token(token)
    if user_id:
        return {"valid": True}
    return {"valid": False, "reason": "not_found"}


async def cleanup_expired_tokens() -> None:
    """Background task: süresi dolmuş token'ları saatte bir temizler."""
    import asyncio as _asyncio
    while True:
        await _asyncio.sleep(3600)
        now = time.time()
        expired = [t for t, v in list(_token_store.items()) if v.get("expires_at", 0) < now]
        for t in expired:
            entry = _token_store.pop(t, None)
            if entry:
                _user_to_token.pop(entry.get("user_id"), None)
        # Revoked token kaydını TTL sonrası temizle
        old_revoked = [t for t, ts in list(_revoked_tokens.items()) if now - ts > _TOKEN_TTL_SECONDS]
        for t in old_revoked:
            _revoked_tokens.pop(t, None)
        if expired or old_revoked:
            log_info(f"Session cleanup: {len(expired)} süresi dolmuş, {len(old_revoked)} iptal edilmiş token temizlendi.")


def _write_user_log(user_id: str, action_type: str, description: str, ip_address: str = None, supabase_client: Client = None):
    """Write an entry to the user_logs table in Supabase. Fails silently."""
    try:
        payload = {
            "user_id": user_id,
            "action_type": action_type,
            "description": description,
        }
        if ip_address:
            payload["ip_address"] = ip_address
        client = supabase_client or supabase
        client.table("user_logs").insert(payload).execute()
    except Exception as e:
        log_error(f"user_logs write error: {e}")


async def forgot_password(request: ForgotPasswordRequest):
    """
    Send password reset email to user
    """
    try:
        email = request.email.strip()
        
        if not validate_email(email):
            return {
                "success": False,
                "error": "Geçerli bir e-posta adresi girin."
            }

        log_user_action("unknown", "PASSWORD_RESET_REQUEST", f"E-posta: {email}")

        # Send reset email via Supabase
        try:
            result = supabase.auth.reset_password_for_email(
                email,
                options={'redirect_to': 'https://3065.com.tr/sifre-guncelle.html'}
            )
            log_info(f"Password reset result for {email}: {result}")
        except Exception as supabase_err:
            log_error(f"Supabase reset_password_for_email hatası: {supabase_err}")
            return {
                "success": False,
                "error": f"E-posta gönderilemedi: {str(supabase_err)}"
            }

        log_info(f"Password reset email sent to: {email}")
        return {
            "success": True,
            "message": "Sıfırlama linki e-postanıza gönderildi. Lütfen tarayıcıda açılan sayfada şifrenizi güncelleyin ve ardından bu ekrandan giriş yapın."
        }

    except Exception as e:
        log_error(f"Password reset error: {e}")
        return {
            "success": False,
            "error": "E-posta gönderilemedi. Lütfen daha sonra tekrar deneyin."
        }


def get_user_id_from_token(token: str) -> Optional[str]:
    """Verilen session token'ı user_id'ye çözer. Önce belleği, yoksa disk."""
    if not token:
        return None
    entry = _token_store.get(token)
    if entry:
        now = time.time()
        if entry.get("expires_at", 0) < now:
            _token_store.pop(token, None)
            _user_to_token.pop(entry.get("user_id"), None)
            return None
        if now - entry.get("last_active", now) > _TOKEN_IDLE_SECONDS:
            _token_store.pop(token, None)
            _user_to_token.pop(entry.get("user_id"), None)
            return None
        # Her başarılı kullanımda hareketsizlik sayıcısını sıfırla
        entry["last_active"] = now
        return entry["user_id"]
    # Sunucu yeniden başlatılmışsa disk'ten oku ve belleğe al
    try:
        import json as _json
        token_file = _TOKEN_STORE / f"{token}.json"
        if token_file.exists():
            data = _json.loads(token_file.read_text(encoding="utf-8"))
            if data.get("expires_at", 0) < time.time():
                token_file.unlink(missing_ok=True)
                return None
            user_id = data.get("user_id")
            if user_id:
                _token_store[token] = {
                    "user_id": user_id,
                    "expires_at": data["expires_at"],
                    "email": data.get("email", "")
                }
                _user_to_token[user_id] = token
                return user_id
    except Exception:
        pass
    return None


def get_user_email_from_token(token: str) -> str:
    """Verilen session token'dan kullanıcı e-postasını çözer."""
    if not token:
        return ""
    entry = _token_store.get(token)
    if entry:
        return entry.get("email", "")
    # Disk fallback
    try:
        import json as _json
        token_file = _TOKEN_STORE / f"{token}.json"
        if token_file.exists():
            data = _json.loads(token_file.read_text(encoding="utf-8"))
            return data.get("email", "")
    except Exception:
        pass
    return ""
