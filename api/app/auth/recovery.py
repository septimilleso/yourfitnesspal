"""High-entropy, one-time recovery code helpers."""

import base64
import hashlib
import secrets


def _normalize(code: str) -> str:
    return code.replace("-", "").replace(" ", "").lower()


def generate_codes(n: int = 10) -> list[str]:
    """Generate human-readable ``xxxxx-xxxxx`` recovery codes."""
    codes: list[str] = []
    while len(codes) < n:
        value = base64.b32encode(secrets.token_bytes(7)).decode().lower().rstrip("=")[:10]
        code = f"{value[:5]}-{value[5:]}"
        if code not in codes:
            codes.append(code)
    return codes


def hash_code(code: str) -> str:
    return hashlib.sha256(_normalize(code).encode()).hexdigest()
