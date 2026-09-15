"""Minimal, deliberately non-sensitive audit log writer."""

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import AuditEvent, User


async def record(
    session: AsyncSession,
    actor: User | None,
    action: str,
    target_user_id: int | None = None,
    details: dict | None = None,
    request: Request | None = None,
) -> None:
    """Append an event. Callers must never pass credentials or secrets."""
    ip = None
    if request:
        ip = request.headers.get("x-real-ip") or (request.client.host if request.client else None)
    session.add(AuditEvent(
        actor_user_id=actor.id if actor else None, target_user_id=target_user_id, action=action,
        ip=ip[:64] if ip else None, details=details or {},
    ))
