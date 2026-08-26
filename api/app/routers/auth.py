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

# client IP -> list of attempt timestamps (monotonic seconds). In-memory is
# fine: this is a single-instance, single-user app.
_login_attempts: dict[str, list[float]] = defaultdict(list)


class LoginRequest(BaseModel):
    key: str


def _client_ip(request: Request) -> str:
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

    _record_attempt(ip)

    if not secrets.compare_digest(payload.key, settings.app_key):
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
