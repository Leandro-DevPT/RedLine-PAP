"""Small dependency-free TOTP helper compatible with Authy/Google Authenticator."""
import base64
import hashlib
import hmac
import struct
import time


def _normalize_secret(secret: str) -> str:
    if not secret:
        return ""
    return secret.strip().replace(" ", "").upper()


def _totp(secret: str, moment: int) -> int:
    normalized = _normalize_secret(secret)
    if not normalized:
        return -1
    key = base64.b32decode(normalized + "=" * (-len(normalized) % 8), casefold=True)
    counter = moment // 30
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    start = digest[-1] & 15
    number = struct.unpack(">I", digest[start:start + 4])[0] & 0x7fffffff
    return number % 1_000_000


def verify_totp(secret: str, code: str, timestamp: int | None = None) -> bool:
    """Accept the current 30-second TOTP window and one adjacent window."""
    if not isinstance(code, str) or not code.isdigit() or len(code) != 6:
        return False
    moment = int(time.time() if timestamp is None else timestamp)
    normalized = _normalize_secret(secret)
    if not normalized:
        return False
    for offset in (-1, 0, 1):
        if f"{_totp(normalized, moment + offset * 30):06d}" == code:
            return True
    return False
