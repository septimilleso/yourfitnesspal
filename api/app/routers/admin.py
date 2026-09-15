"""Administrator-only account management endpoints."""

from datetime import UTC, datetime

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_admin
from app.auth.passwords import generate_temp_password, hash_password
from app.auth.sessions import revoke_all
from app.db import get_session
from app.models.goal import Goal
from app.models.user import AuditEvent, RecoveryCode, Role, User, UserSession
from app.permissions import (
    DEFAULT_PERMISSIONS,
    PERMISSION_LABELS,
    Permission,
    effective_permissions,
)
from app.schemas.admin import AdminDeleteRequest, AdminUserCreate, AdminUserPatch
from app.schemas.diary import GoalCreate
from app.services.audit import record

router = APIRouter(prefix="/api/admin", tags=["admin"])


async def _target(db: AsyncSession, user_id: int) -> User:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "user not found")
    return user


async def _can_remove_admin(db: AsyncSession, target: User) -> bool:
    count = await db.scalar(sa.select(sa.func.count()).select_from(User).where(User.role == Role.admin, User.is_active, User.id != target.id))
    return bool(count)


def _out(user: User, active_sessions: int = 0) -> dict:
    return {"id": user.id, "username": user.username, "display_name": user.display_name,
            "role": user.role, "permissions": sorted(effective_permissions(user), key=lambda p: p.value),
            "is_active": user.is_active, "totp_enabled": user.totp_enabled,
            "must_change_password": user.must_change_password,
            "failed_login_count": user.failed_login_count, "locked_until": user.locked_until,
            "last_login_at": user.last_login_at, "active_sessions": active_sessions}


@router.get("/permissions")
async def permissions(user: User = Depends(require_admin)):
    return [{"key": p, "label": PERMISSION_LABELS[p], "default": p in DEFAULT_PERMISSIONS} for p in Permission]


@router.get("/users")
async def users(db: AsyncSession = Depends(get_session), user: User = Depends(require_admin)):
    rows = (await db.scalars(sa.select(User).order_by(User.username))).all()
    counts = dict((await db.execute(
        sa.select(UserSession.user_id, sa.func.count()).group_by(UserSession.user_id)
    )).all())
    return [_out(row, counts.get(row.id, 0)) for row in rows]


@router.post("/users", status_code=201)
async def create_user(payload: AdminUserCreate, request: Request, db: AsyncSession = Depends(get_session), actor: User = Depends(require_admin)):
    existing = await db.scalar(sa.select(User.id).where(User.username == payload.username))
    if existing:
        raise HTTPException(409, "username già in uso")
    temporary_password = generate_temp_password()
    permissions = [] if payload.role is Role.admin else [
        p.value for p in (payload.permissions if payload.permissions is not None else DEFAULT_PERMISSIONS)
    ]
    target = User(username=payload.username, display_name=payload.display_name, role=payload.role,
                  permissions=permissions, password_hash=hash_password(temporary_password), must_change_password=True)
    db.add(target)
    await db.flush()
    await record(db, actor, "admin.user_create", target.id, request=request)
    await db.commit()
    return _out(target) | {"temporary_password": temporary_password}


@router.patch("/users/{user_id}")
async def patch_user(user_id: int, payload: AdminUserPatch, request: Request, db: AsyncSession = Depends(get_session), actor: User = Depends(require_admin)):
    target = await _target(db, user_id)
    if target.id == actor.id and ((payload.role and payload.role != Role.admin) or payload.is_active is False):
        raise HTTPException(409, "non puoi modificare il tuo ruolo o disattivare/eliminare te stesso")
    removing_admin = target.role is Role.admin and ((payload.role and payload.role != Role.admin) or payload.is_active is False)
    if removing_admin and not await _can_remove_admin(db, target):
        raise HTTPException(409, "deve esistere almeno un amministratore attivo")
    changed = payload.model_dump(exclude_unset=True)
    if "role" in changed and changed["role"] is Role.admin:
        changed["permissions"] = []
    if "permissions" in changed:
        changed["permissions"] = [p.value for p in changed["permissions"]]
    for field, value in changed.items():
        setattr(target, field, value)
    if payload.is_active is False:
        await revoke_all(db, target.id)
    await record(db, actor, "admin.user_update", target.id, {"fields": sorted(changed)}, request)
    await db.commit()
    return _out(target)


@router.post("/users/{user_id}/reset-password")
async def reset_password(user_id: int, request: Request, db: AsyncSession = Depends(get_session), actor: User = Depends(require_admin)):
    target = await _target(db, user_id)
    password = generate_temp_password()
    target.password_hash, target.must_change_password = hash_password(password), True
    target.auth_version += 1
    await revoke_all(db, target.id)
    await record(db, actor, "admin.password_reset", target.id, request=request)
    await db.commit()
    return {"temporary_password": password}


@router.post("/users/{user_id}/reset-totp", status_code=204)
async def reset_totp(user_id: int, request: Request, db: AsyncSession = Depends(get_session), actor: User = Depends(require_admin)):
    target = await _target(db, user_id)
    target.totp_secret_enc = target.totp_pending_secret_enc = None
    target.totp_enabled, target.totp_last_used_step = False, None
    target.auth_version += 1
    await db.execute(sa.delete(RecoveryCode).where(RecoveryCode.user_id == target.id))
    await revoke_all(db, target.id)
    await record(db, actor, "admin.totp_reset", target.id, request=request)
    await db.commit()


@router.post("/users/{user_id}/unlock", status_code=204)
async def unlock(user_id: int, request: Request, db: AsyncSession = Depends(get_session), actor: User = Depends(require_admin)):
    target = await _target(db, user_id)
    target.locked_until, target.failed_login_count = None, 0
    await record(db, actor, "admin.user_update", target.id, {"fields": ["locked_until"]}, request)
    await db.commit()


@router.delete("/users/{user_id}/sessions", status_code=204)
async def revoke_sessions(user_id: int, request: Request, db: AsyncSession = Depends(get_session), actor: User = Depends(require_admin)):
    target = await _target(db, user_id)
    await revoke_all(db, target.id)
    await record(db, actor, "admin.sessions_revoke", target.id, request=request)
    await db.commit()


@router.put("/users/{user_id}/goal", status_code=201)
async def set_goal(user_id: int, payload: GoalCreate, request: Request, db: AsyncSession = Depends(get_session), actor: User = Depends(require_admin)):
    target = await _target(db, user_id)
    goal = Goal(user_id=target.id, kcal=payload.kcal, protein_g=payload.protein_g,
                carbs_g=payload.carbs_g, fat_g=payload.fat_g, valid_from=datetime.now(UTC).date())
    db.add(goal)
    await record(db, actor, "admin.goal_set", target.id, request=request)
    await db.commit()
    await db.refresh(goal)
    return goal


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: int, payload: AdminDeleteRequest, request: Request, db: AsyncSession = Depends(get_session), actor: User = Depends(require_admin)):
    target = await _target(db, user_id)
    if payload.confirm_username != target.username:
        raise HTTPException(422, "username di conferma non corrisponde")
    if target.id == actor.id:
        raise HTTPException(409, "non puoi modificare il tuo ruolo o disattivare/eliminare te stesso")
    if target.role is Role.admin and not await _can_remove_admin(db, target):
        raise HTTPException(409, "deve esistere almeno un amministratore attivo")
    await record(db, actor, "admin.user_delete", target.id, request=request)
    await db.delete(target)
    await db.commit()


@router.get("/audit")
async def audit(db: AsyncSession = Depends(get_session), user: User = Depends(require_admin)):
    return (await db.scalars(sa.select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(200))).all()
