"""TOTP generation, encrypted storage and replay-safe verification."""

import base64
import re
import time

import pyotp
import segno
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import settings

_CODE_RE = re.compile(r"^\d{6}$")
_STEP_SECONDS = 30


def _fernet() -> Fernet:
    key = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=b"yfp-totp-secret"
    ).derive(settings.app_key.encode())
    return Fernet(base64.urlsafe_b64encode(key))


def new_secret() -> str:
    return pyotp.random_base32()


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def provisioning_uri(secret: str, username: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=settings.totp_issuer)


def qr_svg_data_uri(uri: str) -> str:
    return segno.make(uri, error="m").svg_data_uri(scale=6)


def verify_code(secret: str, code: str, last_used_step: int | None) -> int | None:
    """Return the accepted time step, or ``None`` for an invalid/replayed code."""
    normalized = code.strip().replace(" ", "")
    if not _CODE_RE.fullmatch(normalized):
        return None
    now_step = int(time.time() // _STEP_SECONDS)
    totp = pyotp.TOTP(secret, interval=_STEP_SECONDS)
    for step in (now_step - 1, now_step, now_step + 1):
        if last_used_step is not None and step <= last_used_step:
            continue
        if totp.verify(normalized, for_time=step * _STEP_SECONDS, valid_window=0):
            return step
    return None
