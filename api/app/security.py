from itsdangerous import BadSignature, SignatureExpired, TimestampSigner

from app.config import settings

SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60  # 30 days

_SALT = "session-cookie"


def _signer() -> TimestampSigner:
    return TimestampSigner(settings.app_key, salt=_SALT)


def create_session_cookie(key: str) -> str:
    """Sign `key` into an opaque session cookie value."""
    return _signer().sign(key).decode("utf-8")


def verify_session_cookie(token: str) -> bool:
    """Check the signature and max_age of a session cookie value."""
    try:
        _signer().unsign(token, max_age=SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return False
    return True
