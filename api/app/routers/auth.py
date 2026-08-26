import secrets
import time
from collections import defaultdict

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.config import settings
from app.security import SESSION_MAX_AGE_SECONDS, create_session_cookie

router = APIRouter(prefix="/api/auth", tags=["auth"])

RATE_LIMIT_ATTEMPTS = 5
RATE_LIMIT_WINDOW_SECONDS = 60

# Defense-in-depth cap on the rate-limit bucket key length. X-Real-IP is set
# by nginx itself (see web/nginx.conf) and can't be spoofed by a client that
# goes through nginx, but a client hitting the backend directly (e.g. a
# misconfigured deployment with no proxy in front) could send an arbitrary
# X-Real-IP value straight through -- cap it so a garbage/huge header can't
# grow the in-memory dict unboundedly per request.
_MAX_IP_KEY_LENGTH = 64

# client IP -> list of attempt timestamps (monotonic seconds). In-memory is
# fine: this is a single-instance, single-user app.
_login_attempts: dict[str, list[float]] = defaultdict(list)


class LoginRequest(BaseModel):
    key: str


def _client_ip(request: Request) -> str:
    """The real client IP for rate-limiting purposes.

    Behind the nginx reverse proxy (see `web/nginx.conf`), `request.client.host`
    is always the `web` container's address -- every real client would share
    one rate-limit bucket. nginx sets both `X-Real-IP` and `X-Forwarded-For`,
    but only `X-Real-IP` is trustworthy: nginx sets it to `$remote_addr`,
    which OVERWRITES any value the client sent (a client cannot spoof it).
    `X-Forwarded-For` is set to `$proxy_add_x_forwarded_for`, which APPENDS
    the real client IP to whatever the client already put in that header --
    so a client can prepend an arbitrary value and rotate it per request to
    get a fresh rate-limit bucket every time. Falls back to
    `request.client.host` when `X-Real-IP` is absent, e.g. direct connections
    in dev without nginx in front.
    """
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        real_ip = real_ip.strip()
        if real_ip:
            return real_ip[:_MAX_IP_KEY_LENGTH]
    if request.client:
        return request.client.host
    return "unknown"


def _is_rate_limited(ip: str) -> bool:
    now = time.monotonic()
    attempts = _login_attempts[ip]
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    while attempts and attempts[0] < cutoff:
        attempts.pop(0)
    return len(attempts) >= RATE_LIMIT_ATTEMPTS


def _record_attempt(ip: str) -> None:
    _login_attempts[ip].append(time.monotonic())


@router.post("/login")
async def login(payload: LoginRequest, request: Request, response: Response):
    ip = _client_ip(request)

    if _is_rate_limited(ip):
        return Response(status_code=429, content='{"detail":"too many attempts"}',
                         media_type="application/json")

    if not secrets.compare_digest(payload.key, settings.app_key):
        # Only failed attempts count toward the 5/min budget -- a successful
        # login must not consume shared budget (this matters once multiple
        # legitimate devices share the same IP behind the reverse proxy).
        _record_attempt(ip)
        return Response(status_code=401, content='{"detail":"unauthorized"}',
                         media_type="application/json")

    # Payload doesn't need to carry the app key itself -- verify_session_cookie
    # only checks the signature and max_age, so a fixed marker avoids putting
    # the shared secret into a cookie value.
    token = create_session_cookie("authenticated")
    response.set_cookie(
        key="session",
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return {"status": "ok"}
