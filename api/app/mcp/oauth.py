"""OAuth 2.1 authorization server storage and policy for the MCP endpoint.

The MCP SDK serves the protocol endpoints (/register, /authorize, /token,
/revoke and the metadata documents) and calls `PostgresOAuthProvider` for
storage. Every access-token check re-validates the account (active, same
`auth_version`, still holding `mcp.access`), so password/TOTP resets,
deactivation and permission removal cut MCP access immediately.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlsplit

import sqlalchemy as sa
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.totp import decrypt_secret, encrypt_secret
from app.config import settings
from app.db import session_scope
from app.mcp.consent import sign_request
from app.models.oauth import OAuthAuthCode, OAuthClient, OAuthTokenPair
from app.models.user import User
from app.permissions import Permission, effective_permissions
from app.services.audit import record

AUTH_CODE_TTL = timedelta(minutes=5)
LAST_USED_RESOLUTION = timedelta(minutes=5)


def _now() -> datetime:
    return datetime.now(UTC)


def hash_token(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def redirect_uri_allowed(uri: str) -> bool:
    """https anywhere; plain http only for loopback (desktop/CLI clients)."""
    parts = urlsplit(uri)
    if parts.scheme == "https":
        return bool(parts.hostname)
    return parts.scheme == "http" and parts.hostname in {"localhost", "127.0.0.1"}


def user_may_connect(user: User) -> bool:
    return user.is_active and Permission.mcp_access in effective_permissions(user)


def _grant_valid(row: OAuthTokenPair, user: User) -> bool:
    return row.auth_version == user.auth_version and user_may_connect(user)


class StoredAuthCode(AuthorizationCode):
    row_id: int
    user_id: int


class StoredRefreshToken(RefreshToken):
    row_id: int
    family_id: str


async def issue_tokens(
    db: AsyncSession, user: User, client_id: str, scopes: list[str], family_id: str | None = None
) -> OAuthToken:
    access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    now = _now()
    db.add(OAuthTokenPair(
        user_id=user.id, client_id=client_id, family_id=family_id or str(uuid.uuid4()),
        access_token_hash=hash_token(access),
        access_expires_at=now + timedelta(minutes=settings.oauth_access_token_minutes),
        refresh_token_hash=hash_token(refresh),
        refresh_expires_at=now + timedelta(days=settings.oauth_refresh_token_days),
        scopes=list(scopes), auth_version=user.auth_version, created_at=now,
    ))
    await db.commit()
    return OAuthToken(
        access_token=access, expires_in=settings.oauth_access_token_minutes * 60,
        refresh_token=refresh, scope=" ".join(scopes) or None,
    )


async def revoke_user_tokens(db: AsyncSession, user_id: int, client_id: str | None = None) -> int:
    """Revoke every live token pair of a user (optionally for one client). No commit."""
    stmt = (
        sa.update(OAuthTokenPair)
        .where(OAuthTokenPair.user_id == user_id, OAuthTokenPair.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    if client_id is not None:
        stmt = stmt.where(OAuthTokenPair.client_id == client_id)
    return (await db.execute(stmt)).rowcount


async def _revoke_family(db: AsyncSession, family_id: str) -> None:
    await db.execute(
        sa.update(OAuthTokenPair)
        .where(OAuthTokenPair.family_id == family_id, OAuthTokenPair.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


async def _record_reuse(db: AsyncSession, user_id: int, client_id: str, kind: str) -> None:
    user = await db.get(User, user_id)
    await record(db, user, "mcp.token_reuse", user_id, {"client_id": client_id, "kind": kind})


async def list_connections(db: AsyncSession, user_id: int) -> list[dict]:
    """Clients holding a live (not revoked, not rotated, refreshable) grant."""
    last_used = sa.func.max(
        sa.func.coalesce(OAuthTokenPair.last_used_at, OAuthTokenPair.created_at)
    )
    rows = await db.execute(
        sa.select(OAuthClient.client_id, OAuthClient.client_name, OAuthClient.created_at, last_used)
        .join(OAuthTokenPair, OAuthTokenPair.client_id == OAuthClient.client_id)
        .where(
            OAuthTokenPair.user_id == user_id,
            OAuthTokenPair.revoked_at.is_(None),
            OAuthTokenPair.rotated_at.is_(None),
            OAuthTokenPair.refresh_expires_at > _now(),
        )
        .group_by(OAuthClient.client_id, OAuthClient.client_name, OAuthClient.created_at)
        .order_by(OAuthClient.created_at.desc())
    )
    return [
        {"client_id": cid, "client_name": name or "Client MCP", "connected_at": created,
         "last_used_at": used}
        for cid, name, created, used in rows
    ]


async def create_authorization_code(db: AsyncSession, user: User, request: dict) -> str:
    """Persist a one-time code for an approved consent and return the client
    redirect URL carrying it. The caller commits."""
    now = _now()
    # Opportunistic cleanup of long-dead codes.
    await db.execute(
        sa.delete(OAuthAuthCode).where(OAuthAuthCode.expires_at < now - timedelta(days=1))
    )
    code = secrets.token_urlsafe(32)
    db.add(OAuthAuthCode(
        code_hash=hash_token(code), client_id=request["client_id"], user_id=user.id,
        redirect_uri=request["redirect_uri"],
        redirect_uri_provided_explicitly=request["redirect_uri_provided_explicitly"],
        code_challenge=request["code_challenge"], scopes=request["scopes"],
        resource=request["resource"], expires_at=now + AUTH_CODE_TTL,
    ))
    return construct_redirect_uri(request["redirect_uri"], code=code, state=request["state"])


def denied_redirect(request: dict) -> str:
    return construct_redirect_uri(
        request["redirect_uri"], error="access_denied",
        error_description="The user denied the request", state=request["state"],
    )


async def purge_expired(db: AsyncSession, now: datetime | None = None) -> tuple[int, int]:
    """Delete dead codes (>1 day) and dead token rows (refresh expired, or
    revoked/rotated more than 30 days ago). Returns (codes, tokens) deleted."""
    now = now or _now()
    codes = await db.execute(sa.delete(OAuthAuthCode).where(sa.or_(
        OAuthAuthCode.expires_at < now - timedelta(days=1),
        OAuthAuthCode.used_at < now - timedelta(days=1),
    )))
    tokens = await db.execute(sa.delete(OAuthTokenPair).where(sa.or_(
        OAuthTokenPair.refresh_expires_at < now,
        OAuthTokenPair.revoked_at < now - timedelta(days=30),
        OAuthTokenPair.rotated_at < now - timedelta(days=30),
    )))
    await db.commit()
    return codes.rowcount, tokens.rowcount


class PostgresOAuthProvider:
    """`OAuthAuthorizationServerProvider` backed by Postgres."""

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with session_scope() as db:
            row = await db.scalar(sa.select(OAuthClient).where(OAuthClient.client_id == client_id))
        if row is None:
            return None
        data = dict(row.info)
        data["client_secret"] = (
            decrypt_secret(row.client_secret_enc) if row.client_secret_enc else None
        )
        return OAuthClientInformationFull.model_validate(data)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        uris = [str(uri) for uri in client_info.redirect_uris or []]
        if not uris or not all(redirect_uri_allowed(uri) for uri in uris):
            raise RegistrationError(
                "invalid_redirect_uri", "redirect URIs must use https (or http on localhost)"
            )
        async with session_scope() as db:
            db.add(OAuthClient(
                client_id=client_info.client_id,
                client_name=(client_info.client_name or "")[:255] or None,
                client_secret_enc=(
                    encrypt_secret(client_info.client_secret) if client_info.client_secret else None
                ),
                info=client_info.model_dump(mode="json", exclude={"client_secret"}, exclude_none=True),
            ))
            await db.commit()

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        request = {
            "client_id": client.client_id,
            "redirect_uri": str(params.redirect_uri),
            "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
            "code_challenge": params.code_challenge,
            "state": params.state,
            "scopes": params.scopes or [],
            "resource": params.resource,
        }
        base = settings.public_base_url.rstrip("/")
        return f"{base}/connect?{urlencode({'req': sign_request(request)})}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> StoredAuthCode | None:
        async with session_scope() as db:
            row = await db.scalar(sa.select(OAuthAuthCode).where(
                OAuthAuthCode.code_hash == hash_token(authorization_code),
                OAuthAuthCode.client_id == client.client_id,
            ))
            if row is None:
                return None
            if row.used_at is not None:
                # A replayed code means it leaked: kill what it produced.
                await revoke_user_tokens(db, row.user_id, row.client_id)
                await _record_reuse(db, row.user_id, row.client_id, "authorization_code")
                await db.commit()
                return None
            return StoredAuthCode(
                code=authorization_code, scopes=list(row.scopes),
                expires_at=row.expires_at.timestamp(), client_id=row.client_id,
                code_challenge=row.code_challenge, redirect_uri=row.redirect_uri,
                redirect_uri_provided_explicitly=row.redirect_uri_provided_explicitly,
                resource=row.resource, subject=str(row.user_id), row_id=row.id,
                user_id=row.user_id,
            )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: StoredAuthCode
    ) -> OAuthToken:
        # `TokenError` is a frozen dataclass; raising it *inside* an
        # `@asynccontextmanager` block makes CPython's contextlib crash while
        # re-raising it (it tries to set `__traceback__`, which a frozen
        # dataclass's `__setattr__` refuses). So every error path here exits
        # `session_scope()` normally first, and only raises after.
        error: str | None = None
        async with session_scope() as db:
            used = await db.execute(
                sa.update(OAuthAuthCode)
                .where(
                    OAuthAuthCode.id == authorization_code.row_id,
                    OAuthAuthCode.used_at.is_(None),
                )
                .values(used_at=_now())
            )
            if used.rowcount != 1:
                error = "authorization code already used"
            else:
                user = await db.get(User, authorization_code.user_id)
                if user is None or not user_may_connect(user):
                    await db.commit()
                    error = "access to this account is not allowed"
                else:
                    return await issue_tokens(db, user, client.client_id, authorization_code.scopes)
        raise TokenError("invalid_grant", error)

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> StoredRefreshToken | None:
        async with session_scope() as db:
            found = (await db.execute(
                sa.select(OAuthTokenPair, User)
                .join(User, User.id == OAuthTokenPair.user_id)
                .where(
                    OAuthTokenPair.refresh_token_hash == hash_token(refresh_token),
                    OAuthTokenPair.client_id == client.client_id,
                )
            )).one_or_none()
            if found is None:
                return None
            row, user = found
            if row.rotated_at is not None and row.revoked_at is None:
                # A rotated refresh token came back: it leaked. Kill the family.
                await _revoke_family(db, row.family_id)
                await _record_reuse(db, row.user_id, row.client_id, "refresh_token")
                await db.commit()
                return None
            if row.revoked_at is not None or row.refresh_expires_at <= _now():
                return None
            if not _grant_valid(row, user):
                return None
            return StoredRefreshToken(
                token=refresh_token, client_id=row.client_id, scopes=list(row.scopes),
                expires_at=int(row.refresh_expires_at.timestamp()),
                resource=settings.mcp_resource_url, subject=str(user.id),
                row_id=row.id, family_id=row.family_id,
            )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: StoredRefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        # Same reason as exchange_authorization_code: raise only after
        # session_scope() has exited, never from inside the `async with`.
        invalid = False
        async with session_scope() as db:
            rotated = await db.execute(
                sa.update(OAuthTokenPair)
                .where(
                    OAuthTokenPair.id == refresh_token.row_id,
                    OAuthTokenPair.rotated_at.is_(None),
                    OAuthTokenPair.revoked_at.is_(None),
                )
                .values(rotated_at=_now())
            )
            if rotated.rowcount != 1:
                invalid = True
            else:
                user = await db.get(User, int(refresh_token.subject))
                if user is None:
                    invalid = True
                else:
                    granted = (
                        [s for s in scopes if s in refresh_token.scopes]
                        if scopes else refresh_token.scopes
                    )
                    return await issue_tokens(
                        db, user, client.client_id, granted, family_id=refresh_token.family_id
                    )
        raise TokenError("invalid_grant", "refresh token is no longer valid")

    async def load_access_token(self, token: str) -> AccessToken | None:
        async with session_scope() as db:
            found = (await db.execute(
                sa.select(OAuthTokenPair, User)
                .join(User, User.id == OAuthTokenPair.user_id)
                .where(OAuthTokenPair.access_token_hash == hash_token(token))
            )).one_or_none()
            if found is None:
                return None
            row, user = found
            now = _now()
            if (
                row.revoked_at is not None
                or row.rotated_at is not None
                or row.access_expires_at <= now
                or not _grant_valid(row, user)
            ):
                return None
            if row.last_used_at is None or row.last_used_at <= now - LAST_USED_RESOLUTION:
                row.last_used_at = now
                await db.commit()
            return AccessToken(
                token=token, client_id=row.client_id, scopes=list(row.scopes),
                expires_at=int(row.access_expires_at.timestamp()),
                resource=settings.mcp_resource_url, subject=str(user.id),
            )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        async with session_scope() as db:
            digest = hash_token(token.token)
            row = await db.scalar(sa.select(OAuthTokenPair).where(sa.or_(
                OAuthTokenPair.access_token_hash == digest,
                OAuthTokenPair.refresh_token_hash == digest,
            )))
            if row is None:
                return
            await _revoke_family(db, row.family_id)
            await db.commit()
