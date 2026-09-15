"""Small in-process authentication rate limiter and account lockout helpers."""

import time
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User

RATE_LIMIT_ATTEMPTS = 5
RATE_LIMIT_WINDOW_SECONDS = 60
_MAX_IP_KEY_LENGTH = 64
_login_attempts: dict[str, list[float]] = defaultdict(list)


def client_ip(request: Request) -> str:
    """Use nginx-overwritten X-Real-IP; never trust X-Forwarded-For."""
    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return real_ip[:_MAX_IP_KEY_LENGTH]
    return request.client.host if request.client else "unknown"


def is_rate_limited(ip: str) -> bool:
    now = time.monotonic()
    attempts = _login_attempts[ip]
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    while attempts and attempts[0] < cutoff:
        attempts.pop(0)
    return len(attempts) >= RATE_LIMIT_ATTEMPTS


def record_attempt(ip: str) -> None:
    _login_attempts[ip].append(time.monotonic())


def check_user_lock(user: User) -> bool:
    return user.locked_until is not None and user.locked_until > datetime.now(UTC)


async def register_failure(db: AsyncSession, user: User) -> None:
    user.failed_login_count += 1
    if user.failed_login_count >= settings.user_lockout_threshold:
        user.locked_until = datetime.now(UTC) + timedelta(minutes=settings.user_lockout_minutes)
    await db.commit()


def reset_failures(user: User) -> None:
    user.failed_login_count = 0
    user.locked_until = None
