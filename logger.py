import logging
import os
from datetime import datetime

# Log dosyası yolu
LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, f"app_{datetime.now().strftime('%Y%m%d')}.log")

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

if not logger.handlers:
    _formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')

    _fh = logging.FileHandler(LOG_FILE, encoding='utf-8')
    _fh.setLevel(logging.INFO)
    _fh.setFormatter(_formatter)
    logger.addHandler(_fh)

    _sh = logging.StreamHandler()
    _sh.setLevel(logging.INFO)
    _sh.setFormatter(_formatter)
    logger.addHandler(_sh)

def log_info(message):
    """Bilgi logu yazar"""
    logger.info(message)

def log_error(message):
    """Hata logu yazar"""
    logger.error(message)

def log_warning(message):
    """Uyar logu yazar"""
    logger.warning(message)

def log_user_action(user_id, action, details):
    """Kullanıcı aksiyon logu yazar"""
    logger.info(f"USER: {user_id} | ACTION: {action} | DETAILS: {details}")
