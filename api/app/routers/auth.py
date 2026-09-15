"""Username/password, TOTP and account-session endpoints."""

from datetime import UTC, datetime
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.passwords import (
    hash_password,
    needs_rehash,
    validate_password_policy,
    verify_dummy,
    verify_password,
)
from app.auth.rate_limit import (
    check_user_lock,
    client_ip,
    is_rate_limited,
    record_attempt,
    register_failure,
    reset_failures,
)
from app.auth.recovery import generate_codes, hash_code
from app.auth.sessions import (
    clear_challenge_cookie,
    clear_session_cookie,
    create_session,
    read_challenge,
    revoke_all,
    revoke_session,
    set_challenge_cookie,
    set_session_cookie,
)
from app.auth.totp import (
    decrypt_secret,
    encrypt_secret,
    new_secret,
    provisioning_uri,
    qr_svg_data_uri,
    verify_code,
)
from app.db import get_session
from app.models.user import RecoveryCode, User, UserSession
from app.permissions import effective_permissions
from app.schemas.auth import (
    LoginRequest,
    PasswordChangeRequest,
    RecoveryCodeRequest,
    SetupCompleteRequest,
    TotpRequest,
)
from app.services.audit import record

router = APIRouter(prefix="/api/auth", tags=["auth"])
Db = Annotated[AsyncSession, Depends(get_session)]
Current = Annotated[User, Depends(get_current_user)]


def _invalid_credentials() -> HTTPException:
    return HTTPException(401, "credenziali non valide")


async def _challenge_user(request: Request, db: AsyncSession, stage: str) -> User:
    data = read_challenge(request)
    if not data or data.get("stage") != stage:
        raise HTTPException(401, "challenge scaduto")
    user = await db.get(User, data.get("uid"))
    if not user or user.auth_version != data.get("av"):
        raise HTTPException(401, "challenge scaduto")
    return user


@router.post("/login")
async def login(payload: LoginRequest, request: Request, response: Response, db: Db):
    ip = client_ip(request)
    if is_rate_limited(ip):
        raise HTTPException(429, "too many attempts")
    user = await db.scalar(sa.select(User).where(User.username == payload.username.strip().lower()))
    if user is None:
        verify_dummy(payload.password)
        record_attempt(ip)
        raise _invalid_credentials()
    if check_user_lock(user):
        raise HTTPException(429, "account temporaneamente bloccato")
    if not user.is_active or not user.password_hash or not verify_password(user.password_hash, payload.password):
        record_attempt(ip)
        await register_failure(db, user)
        await record(db, user, "login.failure", user.id, request=request)
        await db.commit()
        raise _invalid_credentials()
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
        await db.commit()
    stage = "totp" if user.totp_enabled else "setup"
    set_challenge_cookie(response, user, stage)
    return {"status": f"{stage}_required", "must_change_password": user.must_change_password}


@router.post("/totp")
async def totp(payload: TotpRequest, request: Request, response: Response, db: Db):
    user = await _challenge_user(request, db, "totp")
    ip = client_ip(request)
    if is_rate_limited(ip):
        raise HTTPException(429, "too many attempts")
    if check_user_lock(user):
        raise HTTPException(429, "account temporaneamente bloccato")
    accepted_step = None
    if payload.code:
        accepted_step = verify_code(decrypt_secret(user.totp_secret_enc or ""), payload.code, user.totp_last_used_step)
    else:
        recovery = await db.scalar(sa.select(RecoveryCode).where(RecoveryCode.user_id == user.id, RecoveryCode.code_hash == hash_code(payload.recovery_code or ""), RecoveryCode.used_at.is_(None)))
        if recovery:
            recovery.used_at = datetime.now(UTC)
            await record(db, user, "totp.recovery_used", user.id, request=request)
            accepted_step = user.totp_last_used_step or 0
    if accepted_step is None:
        record_attempt(ip)
        await register_failure(db, user)
        await record(db, user, "login.failure", user.id, request=request)
        await db.commit()
        raise HTTPException(401, "codice non valido")
    user.totp_last_used_step = accepted_step
    user.last_login_at = datetime.now(UTC)
    reset_failures(user)
    await record(db, user, "login.success", user.id, request=request)
    await db.commit()
    token = await create_session(db, user, request)
    set_session_cookie(response, token)
    clear_challenge_cookie(response)
    return {"status": "ok"}


@router.post("/setup/start")
async def setup_start(request: Request, db: Db):
    user = await _challenge_user(request, db, "setup")
    secret = new_secret()
    user.totp_pending_secret_enc = encrypt_secret(secret)
    await db.commit()
    uri = provisioning_uri(secret, user.username)
    return {"otpauth_uri": uri, "secret": secret, "qr_svg_data_uri": qr_svg_data_uri(uri)}


@router.post("/setup/complete")
async def setup_complete(payload: SetupCompleteRequest, request: Request, response: Response, db: Db):
    user = await _challenge_user(request, db, "setup")
    if not user.totp_pending_secret_enc:
        raise HTTPException(401, "challenge scaduto")
    if user.must_change_password:
        if not payload.new_password:
            raise HTTPException(422, "nuova password obbligatoria")
        try:
            validate_password_policy(payload.new_password)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        if user.password_hash and verify_password(user.password_hash, payload.new_password):
            raise HTTPException(422, "la nuova password deve essere diversa")
    secret = decrypt_secret(user.totp_pending_secret_enc)
    step = verify_code(secret, payload.code, None)
    if step is None:
        await register_failure(db, user)
        raise HTTPException(401, "codice non valido")
    if payload.new_password:
        user.password_hash = hash_password(payload.new_password)
        user.must_change_password = False
        await record(db, user, "password.change", user.id, request=request)
    user.totp_secret_enc, user.totp_pending_secret_enc = user.totp_pending_secret_enc, None
    user.totp_enabled, user.totp_last_used_step = True, step
    reset_failures(user)
    await db.execute(sa.delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    codes = generate_codes()
    db.add_all([RecoveryCode(user_id=user.id, code_hash=hash_code(code)) for code in codes])
    await record(db, user, "totp.setup", user.id, request=request)
    await db.commit()
    token = await create_session(db, user, request)
    set_session_cookie(response, token)
    clear_challenge_cookie(response)
    return {"status": "ok", "recovery_codes": codes}


@router.get("/me")
async def me(user: Current):
    return {"id": user.id, "username": user.username, "display_name": user.display_name, "role": user.role, "permissions": sorted(p.value for p in effective_permissions(user))}


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, db: Db, user: Current):
    await revoke_session(db, request.state.user_session.id)
    clear_session_cookie(response)


@router.post("/password", status_code=204)
async def password(payload: PasswordChangeRequest, request: Request, db: Db, user: Current):
    if not user.password_hash or not verify_password(user.password_hash, payload.current_password):
        raise HTTPException(401, "credenziali non valide")
    try:
        validate_password_policy(payload.new_password)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    user.password_hash = hash_password(payload.new_password)
    await revoke_all(db, user.id, request.state.user_session.id)
    await record(db, user, "password.change", user.id, request=request)
    await db.commit()


@router.post("/recovery-codes")
async def recovery_codes(payload: RecoveryCodeRequest, request: Request, db: Db, user: Current):
    if not user.totp_secret_enc or verify_code(decrypt_secret(user.totp_secret_enc), payload.code, user.totp_last_used_step) is None:
        raise HTTPException(401, "codice non valido")
    codes = generate_codes()
    await db.execute(sa.delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    db.add_all([RecoveryCode(user_id=user.id, code_hash=hash_code(code)) for code in codes])
    await record(db, user, "recovery.regenerate", user.id, request=request)
    await db.commit()
    return {"recovery_codes": codes}


@router.get("/sessions")
async def sessions(request: Request, db: Db, user: Current):
    rows = (await db.scalars(sa.select(UserSession).where(UserSession.user_id == user.id))).all()
    return [{"id": s.id, "created_at": s.created_at, "last_seen_at": s.last_seen_at, "user_agent": s.user_agent, "ip": s.ip, "current": s.id == request.state.user_session.id} for s in rows]


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: int, db: Db, user: Current):
    session = await db.scalar(sa.select(UserSession).where(UserSession.id == session_id, UserSession.user_id == user.id))
    if not session:
        raise HTTPException(404, "session not found")
    await revoke_session(db, session.id)
