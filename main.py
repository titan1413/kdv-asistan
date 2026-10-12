import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Response, File, UploadFile
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil
from dotenv import load_dotenv

load_dotenv()
from pathlib import Path
from typing import List, Optional
import datetime
import json
from security import (
    validate_session_id,
    validate_email,
    sanitize_full_name,
    sanitize_phone,
    RateLimiter,
)

# ---------------------------------------------------------------------------
# Rate limiter instances
# ---------------------------------------------------------------------------
_login_limiter        = RateLimiter(max_requests=5,  window_seconds=60)   # 5 / dakika
_forgot_limiter       = RateLimiter(max_requests=3,  window_seconds=60)   # 3 / dakika


def _get_client_ip(request: Request) -> str:
    """Return the real client IP."""
    direct_ip = request.client.host if request.client else "unknown"
    return direct_ip


_RATE_LIMIT_RESPONSE = JSONResponse(
    content={"success": False, "error": "Çok fazla istek gönderildi. Lütfen 1 dakika bekleyiniz."},
    status_code=429,
    headers={"Retry-After": "60"},
)

# Import auth module
from auth import login_user, forgot_password, get_user_id_from_token, get_user_email_from_token

_UNAUTHORIZED_RESPONSE = JSONResponse(
    content={"success": False, "error": "Yetkisiz erişim. Lütfen giriş yapın."},
    status_code=401
)

def _get_user_id(request: Request) -> Optional[str]:
    """Authorization header'daki Bearer token'ı user_id'ye çözer."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:].strip() if auth_header.startswith("Bearer ") else ""
    return get_user_id_from_token(token) if token else None



# Import indirilecek KDV functionality
from indirilecek import (
    get_indirilecek_kdv_page,
    upload_xml_files,
    upload_json_data,
    export_excel,
    get_session_data,
    reset_download_limits,
    UPLOAD_DIR,
    EXCEL_DIR
)



@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler"""
    from auth import cleanup_expired_tokens
    cleanup_task = asyncio.create_task(cleanup_expired_tokens())
    yield
    cleanup_task.cancel()
    # Cleanup: close redis connection
    from session_manager import session_manager
    if session_manager.redis_client:
        session_manager.redis_client.close()

app = FastAPI(
    title="KDV Asistan Web App",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan
)

# CORS middleware - restrict to configured origins
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000")
_ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

# Static files
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/KDV_Web", StaticFiles(directory="KDV_Web"), name="KDV_Web")
app.mount("/templates", StaticFiles(directory="templates"), name="templates")



@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Ana sayfa - Landing page (KDV_Web/index.html)"""
    return FileResponse("KDV_Web/index.html")



@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Login sayfasi"""
    return FileResponse("KDV_Web/login.html")





@app.post("/api/login")
async def api_login(request: Request):
    """Login API endpoint - handles authentication and device tracking"""
    if not _login_limiter.is_allowed(_get_client_ip(request)):
        return _RATE_LIMIT_RESPONSE
    from auth import LoginRequest
    data = await request.json()
    login_request = LoginRequest(**data)
    return await login_user(login_request)

@app.get("/api/client-config.js")
async def client_config_js():
    """Supabase public credentials as a JS snippet — values injected from server env vars."""
    supabase_url = os.getenv("SUPABASE_URL", "")
    # Prefer dedicated SUPABASE_ANON_KEY; fall back to SUPABASE_KEY for backwards
    # compatibility (both hold the same publishable key in most deployments).
    supabase_anon_key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY", "")
    content = (
        f"window.SUPABASE_URL={json.dumps(supabase_url)};"
        f"window.SUPABASE_ANON_KEY={json.dumps(supabase_anon_key)};"
    )
    return Response(
        content=content,
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/verify-session")
async def api_verify_session(request: Request):
    """Aktif session token'ı doğrular. Başka cihazdan giriş yapıldıysa geçersiz döner."""
    from auth import verify_session_token
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:].strip() if auth_header.startswith("Bearer ") else ""
    return await verify_session_token(token)

@app.post("/api/forgot-password")
async def api_forgot_password(request: Request):
    """Forgot password API endpoint"""
    if not _forgot_limiter.is_allowed(_get_client_ip(request)):
        return _RATE_LIMIT_RESPONSE
    from auth import ForgotPasswordRequest
    data = await request.json()
    forgot_request = ForgotPasswordRequest(**data)
    return await forgot_password(forgot_request)





@app.get("/indirilecek-kdv", response_class=HTMLResponse)
async def indirilecek_kdv_page(request: Request):
    """Indirilecek KDV listesi olusturma sayfasi"""
    return get_indirilecek_kdv_page(request)







@app.post("/upload-xml")
async def upload_xml_endpoint(request: Request, files: List[UploadFile] = File(...)):
    """XML dosyalarünü yükler ve isler"""
    user_id = _get_user_id(request)
    if not user_id:
        return _UNAUTHORIZED_RESPONSE
    return await upload_xml_files(files, user_id)

@app.post("/upload-json-data")
async def upload_json_data_endpoint(request: Request):
    """Client-side parsed JSON data accepts - for client-side XML parsing"""
    user_id = _get_user_id(request)
    if not user_id:
        return _UNAUTHORIZED_RESPONSE
    # Mükellef/dönem kontrolü kaldırıldı - bu sayfa bağımsız çalışır
    return await upload_json_data(request, user_id, None, None)

@app.get("/export-excel")
async def export_excel_endpoint(request: Request, session_id: str, export_type: str = "standart", combine_rows: bool = False, manually_processed: str = ""):
    """Excel dosyasü olarak disa aktarir"""
    user_id = _get_user_id(request)
    if not user_id:
        return _UNAUTHORIZED_RESPONSE
    
    # Parse manually processed keys
    manually_processed_keys = []
    if manually_processed:
        try:
            manually_processed_keys = json.loads(manually_processed)
        except:
            manually_processed_keys = []
    
    return await export_excel(session_id, export_type, combine_rows, user_id, manually_processed_keys)

@app.get("/session-data/{session_id}")
async def get_session_data_endpoint(request: Request, session_id: str):
    """Oturum verilerini getirir"""
    user_id = _get_user_id(request)
    if not user_id:
        return _UNAUTHORIZED_RESPONSE
    return await get_session_data(session_id, user_id)

@app.get("/reset-download-limits")
async def reset_download_limits_endpoint(request: Request, session_id: str):
    """Indirme haklarini sifirlar - mod degistiginde cagrılır"""
    user_id = _get_user_id(request)
    if not user_id:
        return _UNAUTHORIZED_RESPONSE
    return await reset_download_limits(session_id, user_id)




if __name__ == "__main__":
    import uvicorn
    print("KDV Asistan Web App baslatiliyor...")
    print("Sunucu: http://0.0.0.0:8000")
    print("Yerel: http://localhost:8000")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False, workers=1, log_level="info")
