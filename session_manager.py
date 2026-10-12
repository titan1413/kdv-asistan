import time
import json
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
import redis
import os

class SessionManager:
    """Ortak session yönetimi - Redis tabanlı"""
    
    def __init__(self, max_sessions: int = 1000, session_timeout_minutes: int = 60):
        self.max_sessions = max_sessions
        self.session_timeout = timedelta(minutes=session_timeout_minutes)
        self.last_cleanup = time.time()
        
        # Redis bağlantısı
        redis_host = os.getenv('REDIS_HOST', 'localhost')
        redis_port = int(os.getenv('REDIS_PORT', 6379))
        redis_db = int(os.getenv('REDIS_DB', 0))
        
        try:
            self.redis_client = redis.Redis(
                host=redis_host,
                port=redis_port,
                db=redis_db,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2
            )
            # Bağlantı test
            self.redis_client.ping()
            self.use_redis = True
        except Exception:
            self.redis_client = None
            self.use_redis = False
            # Fallback: Bellek içi session
            self.sessions: Dict[str, Dict[str, Any]] = {}
    
    def _get_redis_key(self, session_id: str) -> str:
        """Redis için anahtar oluştur"""
        return f"session:{session_id}"
    
    def create_session(self, session_id: str, data: Dict[str, Any]) -> None:
        """Yeni session oluştur"""
        if self.use_redis:
            # Redis'te session oluştur
            session_data = {
                **data,
                'created_at': datetime.now().isoformat(),
                'last_accessed': time.time()
            }
            self.redis_client.setex(
                self._get_redis_key(session_id),
                int(self.session_timeout.total_seconds()),
                json.dumps(session_data)
            )
        else:
            # Bellek içi fallback
            self._cleanup_expired_sessions()
            
            if len(self.sessions) >= self.max_sessions:
                oldest_id = min(self.sessions.keys(), 
                              key=lambda k: self.sessions[k].get('last_accessed', time.time()))
                self.delete_session(oldest_id)
            
            self.sessions[session_id] = {
                **data,
                'created_at': datetime.now().isoformat(),
                'last_accessed': time.time()
            }
    
    def get_session(self, session_id: str) -> Dict[str, Any]:
        """Session getir"""
        if self.use_redis:
            # Redis'ten session getir
            data = self.redis_client.get(self._get_redis_key(session_id))
            if data:
                session_data = json.loads(data)
                # Last access güncelle
                session_data['last_accessed'] = time.time()
                self.redis_client.setex(
                    self._get_redis_key(session_id),
                    int(self.session_timeout.total_seconds()),
                    json.dumps(session_data)
                )
                return session_data
            
            # JSON'dan geri yükleme dene
            restored = self._restore_from_json(session_id)
            if restored:
                return restored
            return None
        else:
            # Bellek içi fallback
            if session_id not in self.sessions:
                restored = self._restore_from_json(session_id)
                if restored:
                    return restored
                return None
            
            self.sessions[session_id]['last_accessed'] = time.time()
            return self.sessions[session_id]
    
    def update_session(self, session_id: str, data: Dict[str, Any]) -> None:
        """Session güncelle"""
        if self.use_redis:
            # Redis'te session güncelle
            existing = self.get_session(session_id)
            if existing:
                existing.update(data)
                existing['last_accessed'] = time.time()
                self.redis_client.setex(
                    self._get_redis_key(session_id),
                    int(self.session_timeout.total_seconds()),
                    json.dumps(existing)
                )
        else:
            # Bellek içi fallback
            if session_id in self.sessions:
                self.sessions[session_id].update(data)
                self.sessions[session_id]['last_accessed'] = time.time()
    
    def delete_session(self, session_id: str) -> bool:
        """Session sil"""
        if self.use_redis:
            return bool(self.redis_client.delete(self._get_redis_key(session_id)))
        else:
            # Bellek içi fallback
            if session_id in self.sessions:
                del self.sessions[session_id]
                return True
            return False
    
    def clear_all(self) -> int:
        """Tüm session'ları sil"""
        if self.use_redis:
            # Redis'te tüm session anahtarlarını bul ve sil
            keys = self.redis_client.keys("session:*")
            if keys:
                return self.redis_client.delete(*keys)
            return 0
        else:
            # Bellek içi fallback
            count = len(self.sessions)
            self.sessions.clear()
            return count
    
    def _cleanup_expired_sessions(self) -> int:
        """Süresi geçmiş session'ları temizle (sadece bellek içi için)"""
        if self.use_redis:
            return 0  # Redis otomatik expiring kullanır
        
        now = time.time()
        expired_ids = []
        
        for session_id, session_data in self.sessions.items():
            last_accessed = session_data.get('last_accessed', now)
            if now - last_accessed > self.session_timeout.total_seconds():
                expired_ids.append(session_id)
        
        for session_id in expired_ids:
            del self.sessions[session_id]
        
        return len(expired_ids)
    
    def get_stats(self) -> Dict[str, Any]:
        """Session istatistikleri"""
        if self.use_redis:
            return {
                'total_sessions': len(self.redis_client.keys("session:*")),
                'max_sessions': self.max_sessions,
                'timeout_minutes': self.session_timeout.total_seconds() / 60,
                'backend': 'redis'
            }
        else:
            return {
                'total_sessions': len(self.sessions),
                'max_sessions': self.max_sessions,
                'timeout_minutes': self.session_timeout.total_seconds() / 60,
                'backend': 'memory'
            }
    
    def _restore_from_json(self, session_id: str) -> Optional[Dict[str, Any]]:
        """JSON'dan session geri yükle"""
        temp_dir = Path("temp_data")
        user_dir = temp_dir / session_id
        json_files = [
            user_dir / "indirilecek_kdv.json",
            user_dir / "yuklenilen_kdv.json",
            user_dir / "imalat_data.json",
            user_dir / "karsilastirma_result.json",
            user_dir / "iade_hesapla_result.json",
        ]
        
        for json_file in json_files:
            if json_file.exists():
                try:
                    with open(json_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        if data.get('session_id') == session_id:
                            session_data = {
                                **data,
                                'created_at': data.get('created_at', data.get('timestamp', datetime.now().isoformat())),
                                'last_accessed': time.time()
                            }
                            if self.use_redis:
                                self.redis_client.setex(
                                    self._get_redis_key(session_id),
                                    int(self.session_timeout.total_seconds()),
                                    json.dumps(session_data)
                                )
                            else:
                                self.sessions[session_id] = session_data
                            return session_data
                except Exception:
                    continue
        
        return None

# Global session manager instance
session_manager = SessionManager(max_sessions=1000, session_timeout_minutes=60)
