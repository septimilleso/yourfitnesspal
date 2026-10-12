"""FastAPI dependencies that enforce authenticated users and permissions."""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.sessions import resolve_session
from app.db import get_session
from app.models.user import Role, User
from app.permissions import Permission, effective_permissions


def _bearer_token(request: Request) -> str | None:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer":
        return None
    return token.strip() or None


async def get_current_user(
    request: Request, db: Annotated[AsyncSession, Depends(get_session)]
) -> User:
    # Cookie first, as before: a present but invalid cookie is not retried with the Bearer header.
    token = request.cookies.get("session")
    if token is None:
        token = _bearer_token(request)
    resolved = await resolve_session(db, token) if token else None
    if resolved is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    user_session, user = resolved
    request.state.user_session = user_session
    return user


async def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role is not Role.admin:
        raise HTTPException(status_code=403, detail="forbidden")
    return user


def require_permission(permission: Permission) -> Callable:
    async def dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        if permission not in effective_permissions(user):
            raise HTTPException(status_code=403, detail="forbidden")
        return user
    return dependency
