"""
Security utilities: input validation, sanitization, and XSS/SQL-injection prevention.

All user-supplied values MUST pass through these helpers before:
  - being stored in the database
  - being used in filesystem path construction
  - being embedded in HTML responses
"""

import re
import uuid
import threading
import time
from typing import Optional

# ---------------------------------------------------------------------------
# Limits
# ---------------------------------------------------------------------------
MAX_DEVICE_NAME_LENGTH = 100
MAX_DEVICE_ID_LENGTH = 255
MAX_EMAIL_LENGTH = 254          # RFC 5321
MIN_PASSWORD_LENGTH = 6
MAX_PASSWORD_LENGTH = 128
MAX_FEEDBACK_LENGTH = 2000
MAX_FULL_NAME_LENGTH = 100
MAX_PHONE_LENGTH = 20

# ---------------------------------------------------------------------------
# Compiled patterns
# ---------------------------------------------------------------------------
_EMAIL_PATTERN = re.compile(
    r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$'
)
# Session IDs are UUIDs (hex + hyphens, 36 chars) or short fallback strings
_UUID_PATTERN = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE,
)
# Device IDs accepted formats:
#   1. UUID or "web-<UUID>"  – JS fallback path (crypto.randomUUID)
#   2. 64-char hex string    – SHA-256 hash from BrowserFingerprint via crypto.subtle (HTTPS/localhost)
#   3. "fp-<16 hex chars>"  – JS hash fallback for non-secure HTTP contexts
_DEVICE_ID_PATTERN = re.compile(
    r'^(web-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    r'|^[0-9a-f]{64}$'
    r'|^fp-[0-9a-f]{16}$',
    re.IGNORECASE,
)
# Phone: digits, spaces, +, -, (, )
_PHONE_PATTERN = re.compile(r'^[\d\s\+\-\(\)]{5,20}$')


# ---------------------------------------------------------------------------
# Validators
# ---------------------------------------------------------------------------

def validate_email(email: str) -> bool:
    """Return True if *email* is a syntactically valid address."""
    if not email or len(email) > MAX_EMAIL_LENGTH:
        return False
    return bool(_EMAIL_PATTERN.match(email.strip()))


def validate_uuid(value: str) -> bool:
    """Return True if *value* is a valid UUID (Supabase user / session IDs)."""
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, AttributeError):
        return False


def validate_session_id(session_id: str) -> bool:
    """
    Validate a session ID used in filesystem path construction.

    Accepts:
      - empty string / None  (caller uses the default global path)
      - valid UUID strings

    Rejects anything that could cause path traversal (../, absolute paths,
    shell metacharacters, etc.).
    """
    if not session_id:
        return True
    return bool(_UUID_PATTERN.match(session_id.strip()))


def validate_device_id(device_id: str) -> bool:
    """
    Validate a browser device fingerprint ID.
    Accepts UUID format and "web-<uuid>" produced by the JS fallback.
    """
    if not device_id or len(device_id) > MAX_DEVICE_ID_LENGTH:
        return False
    return bool(_DEVICE_ID_PATTERN.match(device_id.strip()))


# ---------------------------------------------------------------------------
# Sanitisers
# ---------------------------------------------------------------------------

def sanitize_text(value: str, max_length: int = 255) -> str:
    """
    Remove null bytes and non-printable control characters,
    then truncate to *max_length* and strip surrounding whitespace.
    """
    if not value:
        return ""
    cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', str(value))
    return cleaned[:max_length].strip()


def sanitize_device_name(name: Optional[str]) -> str:
    """Return a clean device name safe for storage and display."""
    return sanitize_text(name or "Bilinmeyen Cihaz", MAX_DEVICE_NAME_LENGTH)


def sanitize_full_name(name: str) -> str:
    """Return a clean full name."""
    return sanitize_text(name or "", MAX_FULL_NAME_LENGTH)


def sanitize_phone(phone: str) -> str:
    """Return a clean phone number string."""
    return sanitize_text(phone or "", MAX_PHONE_LENGTH)


def escape_telegram_markdown(value: str) -> str:
    """Escape Telegram Markdown (legacy) special characters to prevent injection.

    Neutralises: * _ ` [ ] ( ) so user input cannot inject bold/italic/links
    into Telegram bot messages sent with parse_mode='Markdown'.
    """
    return re.sub(r'([*_`\[\]()])', r'\\\1', str(value))


def validate_feedback_message(message: str) -> Optional[str]:
    """
    Validate and sanitise a user feedback message.
    Returns the cleaned message, or None if it is invalid/empty.
    """
    if not message:
        return None
    cleaned = sanitize_text(message, MAX_FEEDBACK_LENGTH)
    if len(cleaned) < 5:
        return None
    return cleaned


# ---------------------------------------------------------------------------
# Rate Limiter
# ---------------------------------------------------------------------------

class RateLimiter:
    """
    In-memory sliding-window rate limiter.

    Thread-safe for single-process deployments (uvicorn with 1 worker).
    For multi-worker setups, replace with a Redis-backed implementation.

    Usage:
        limiter = RateLimiter(max_requests=5, window_seconds=60)
        if not limiter.is_allowed(client_ip):
            raise HTTPException(status_code=429, ...)
    """

    def __init__(self, max_requests: int, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._buckets: dict = {}          # ip -> [timestamp, ...]
        self._last_cleanup = time.monotonic()

    # ------------------------------------------------------------------
    def is_allowed(self, key: str) -> bool:
        """Return True if the request is within the rate limit."""
        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            self._maybe_cleanup(now)
            timestamps = self._buckets.get(key, [])
            timestamps = [t for t in timestamps if t > cutoff]
            if len(timestamps) >= self.max_requests:
                self._buckets[key] = timestamps
                return False
            timestamps.append(now)
            self._buckets[key] = timestamps
            return True

    def remaining(self, key: str) -> int:
        """Return how many requests are still allowed in the current window."""
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            used = len([t for t in self._buckets.get(key, []) if t > cutoff])
            return max(0, self.max_requests - used)

    # ------------------------------------------------------------------
    def _maybe_cleanup(self, now: float) -> None:
        """Periodically remove stale buckets (every 5 minutes)."""
        if now - self._last_cleanup < 300:
            return
        cutoff = now - self.window_seconds
        stale = [k for k, v in self._buckets.items()
                 if not any(t > cutoff for t in v)]
        for k in stale:
            del self._buckets[k]
        self._last_cleanup = now
