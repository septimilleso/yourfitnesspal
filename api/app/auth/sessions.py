"""Database-backed sessions and short-lived password-login challenges."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Request, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User, UserSession


def _now() -> datetime:
    return datetime.now(UTC)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _challenge_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.app_key, salt="login-challenge")


async def create_session(db: AsyncSession, user: User, request: Request) -> str:
    token = secrets.token_urlsafe(32)
    now = _now()
    db.add(UserSession(
        user_id=user.id, token_hash=_hash_token(token), auth_version=user.auth_version,
        created_at=now, last_seen_at=now,
        expires_at=now + timedelta(days=settings.session_max_age_days),
        user_agent=request.headers.get("user-agent", "")[:255] or None,
        ip=(request.headers.get("x-real-ip") or (request.client.host if request.client else ""))[:64]
        or None,
    ))
    await db.commit()
    return token


async def resolve_session(db: AsyncSession, token: str) -> tuple[UserSession, User] | None:
    row = await db.execute(
        select(UserSession, User).join(User).where(UserSession.token_hash == _hash_token(token))
    )
    found = row.one_or_none()
    if found is None:
        return None
    session, user = found
    now = _now()
    if session.expires_at <= now or not user.is_active or session.auth_version != user.auth_version:
        return None
    if session.last_seen_at <= now - timedelta(minutes=5):
        session.last_seen_at = now
        session.expires_at = now + timedelta(days=settings.session_max_age_days)
        await db.commit()
    return session, user


async def revoke_session(db: AsyncSession, session_id: int) -> None:
    await db.execute(delete(UserSession).where(UserSession.id == session_id))
    await db.commit()


async def revoke_all(db: AsyncSession, user_id: int, except_session_id: int | None = None) -> None:
    stmt = delete(UserSession).where(UserSession.user_id == user_id)
    if except_session_id is not None:
        stmt = stmt.where(UserSession.id != except_session_id)
    await db.execute(stmt)
    await db.commit()


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        "session", token, max_age=settings.session_max_age_days * 86400, path="/",
        httponly=True, secure=settings.cookie_secure, samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie("session", path="/", httponly=True, secure=settings.cookie_secure, samesite="lax")


def sign_challenge(user: User, stage: str) -> str:
    return _challenge_serializer().dumps({"uid": user.id, "stage": stage, "av": user.auth_version})


def set_challenge_cookie(response: Response, user: User, stage: str) -> None:
    response.set_cookie(
        "login_challenge", sign_challenge(user, stage),
        max_age=settings.login_challenge_max_age_seconds, path="/api/auth", httponly=True,
        secure=settings.cookie_secure, samesite="strict",
    )


def clear_challenge_cookie(response: Response) -> None:
    response.delete_cookie("login_challenge", path="/api/auth", httponly=True,
                           secure=settings.cookie_secure, samesite="strict")


def read_challenge(request: Request) -> dict | None:
    # The native client has no cookie jar (ITP), so it sends the same signed value in a header.
    token = request.cookies.get("login_challenge") or request.headers.get("x-yfp-challenge")
    if not token:
        return None
    try:
        return _challenge_serializer().loads(token, max_age=settings.login_challenge_max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None
