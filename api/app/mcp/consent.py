"""Signed, short-lived carrier for a pending /authorize request.

`PostgresOAuthProvider.authorize` cannot finish on its own: the user must
log in (password + TOTP) and approve in the SPA first. The validated
authorization parameters travel to `/connect` and back to
`POST /api/oauth/consent` inside this signed token, so nothing is stored
server-side until the user approves.
"""

from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.config import settings

MAX_AGE_SECONDS = 600


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.app_key, salt="oauth-authorize")


def sign_request(data: dict) -> str:
    return _serializer().dumps(data)


def load_request(token: str) -> dict | None:
    """The request dict, or None when tampered with or older than 10 minutes."""
    try:
        return _serializer().loads(token, max_age=MAX_AGE_SECONDS)
    except BadSignature:  # SignatureExpired is a subclass
        return None
