"""Characterization of logout, session listing/revocation, TOTP setup and
password change with the browser `session` cookie.

These tests pin today's behaviour (cookie-only auth, no token in the body) so
the native Bearer work can be checked against an unchanged baseline.

Needs a live Postgres instance with migrations applied -- same DATABASE_URL
setup as test_auth.py. Each DB-backed test runs inside a transaction that's
rolled back afterward (via a `get_session` dependency override).
"""

import hashlib
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
import sqlalchemy as sa
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.passwords import hash_password
from app.auth.totp import encrypt_secret, new_secret
from app.db import engine, get_session
from app.main import app
from app.models.user import Role, User, UserSession

PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "a brand new passphrase"


@pytest.fixture
async def session():
    """A session bound to a connection whose outer transaction is always
    rolled back, wired up as the app's `get_session` dependency so the
    router under test reads/writes through this same rolled-back
    transaction."""
    async with engine.connect() as connection:
        trans = await connection.begin()
        async with AsyncSession(bind=connection, expire_on_commit=False) as sess:
            app.dependency_overrides[get_session] = lambda: sess
            try:
                yield sess
            finally:
                app.dependency_overrides.pop(get_session, None)
        await trans.rollback()


async def _client() -> AsyncClient:
    # https base_url so httpx's cookiejar will store and resend the Secure
    # session/challenge cookies. X-Requested-With satisfies the CSRF
    # middleware, which gates every mutating /api/* request.
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="https://test", headers={"X-Requested-With": "yfp"})


async def _make_user(
    db: AsyncSession, *, totp_enabled: bool = True, must_change_password: bool = False,
) -> tuple[User, str | None]:
    secret = new_secret() if totp_enabled else None
    user = User(
        username="alice", display_name="Alice", role=Role.user,
        password_hash=hash_password(PASSWORD), must_change_password=must_change_password,
        totp_secret_enc=encrypt_secret(secret) if secret else None,
        totp_enabled=totp_enabled,
    )
    db.add(user)
    await db.flush()
    return user, secret


async def _login(client: AsyncClient):
    return await client.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})


async def _login_totp(client: AsyncClient, secret: str) -> str:
    """Password + TOTP login; returns the raw session token from the cookie.
    Only one TOTP login per test: the same secret cannot be replayed in the
    same 30 s step."""
    assert (await _login(client)).status_code == 200
    response = await client.post("/api/auth/totp", json={"code": pyotp.TOTP(secret).now()})
    assert response.status_code == 200
    return response.cookies["session"]


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _add_session(db: AsyncSession, user: User, token: str) -> UserSession:
    """A second live session for *user*, inserted directly so that no second
    TOTP login (and so no TOTP replay) is needed."""
    now = datetime.now(UTC)
    row = UserSession(
        user_id=user.id, token_hash=_token_hash(token), auth_version=user.auth_version,
        created_at=now, last_seen_at=now, expires_at=now + timedelta(days=30),
    )
    db.add(row)
    await db.flush()
    return row


async def _session_id(db: AsyncSession, token: str) -> int | None:
    return await db.scalar(sa.select(UserSession.id).where(UserSession.token_hash == _token_hash(token)))


@pytest.mark.asyncio
async def test_login_body_has_only_status_and_must_change_password(session: AsyncSession) -> None:
    await _make_user(session)
    async with await _client() as client:
        response = await _login(client)

    assert response.status_code == 200
    assert response.json() == {"status": "totp_required", "must_change_password": False}


@pytest.mark.asyncio
async def test_setup_flow_sets_session_cookie_and_returns_recovery_codes_without_token(
    session: AsyncSession,
) -> None:
    await _make_user(session, totp_enabled=False)
    async with await _client() as client:
        login = await _login(client)
        assert login.json() == {"status": "setup_required", "must_change_password": False}

        start = await client.post("/api/auth/setup/start")
        assert start.status_code == 200
        secret = start.json()["secret"]

        complete = await client.post("/api/auth/setup/complete", json={"code": pyotp.TOTP(secret).now()})
        assert complete.status_code == 200
        body = complete.json()
        assert set(body) == {"status", "recovery_codes"}
        assert body["status"] == "ok"
        assert len(body["recovery_codes"]) == 10
        assert "session" in complete.cookies

        protected = await client.get("/api/health/protected")

    assert protected.status_code == 200


@pytest.mark.asyncio
async def test_setup_complete_with_must_change_password_needs_new_password(session: AsyncSession) -> None:
    user, _ = await _make_user(session, totp_enabled=False, must_change_password=True)
    async with await _client() as client:
        login = await _login(client)
        assert login.json() == {"status": "setup_required", "must_change_password": True}

        secret = (await client.post("/api/auth/setup/start")).json()["secret"]
        code = pyotp.TOTP(secret).now()

        missing = await client.post("/api/auth/setup/complete", json={"code": code})
        assert missing.status_code == 422
        assert missing.json() == {"detail": "nuova password obbligatoria"}

        complete = await client.post(
            "/api/auth/setup/complete", json={"code": code, "new_password": NEW_PASSWORD},
        )

    assert complete.status_code == 200
    assert set(complete.json()) == {"status", "recovery_codes"}
    assert "session" in complete.cookies
    assert user.must_change_password is False


@pytest.mark.asyncio
async def test_logout_makes_next_protected_request_unauthorized(session: AsyncSession) -> None:
    _, secret = await _make_user(session)
    async with await _client() as client:
        token = await _login_totp(client, secret)
        assert (await client.get("/api/health/protected")).status_code == 200

        logout = await client.post("/api/auth/logout")
        assert logout.status_code == 204

        # The server-side row is gone, so replaying the old cookie must fail.
        client.cookies.set("session", token)
        protected = await client.get("/api/health/protected")

    assert protected.status_code == 401
    assert await _session_id(session, token) is None


@pytest.mark.asyncio
async def test_sessions_list_marks_current_session(session: AsyncSession) -> None:
    user, secret = await _make_user(session)
    async with await _client() as client:
        token = await _login_totp(client, secret)
        other = await _add_session(session, user, "other-session-token")

        response = await client.get("/api/auth/sessions")

    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()}
    current_id = await _session_id(session, token)
    assert set(rows) == {current_id, other.id}
    assert rows[current_id]["current"] is True
    assert rows[other.id]["current"] is False
    assert set(response.json()[0]) == {"id", "created_at", "last_seen_at", "user_agent", "ip", "current"}


@pytest.mark.asyncio
async def test_delete_session_revokes_another_session(session: AsyncSession) -> None:
    user, secret = await _make_user(session)
    other_token = "other-session-token"
    async with await _client() as client:
        await _login_totp(client, secret)
        other = await _add_session(session, user, other_token)

        async with await _client() as other_client:
            other_client.cookies.set("session", other_token)
            assert (await other_client.get("/api/health/protected")).status_code == 200

            deleted = await client.delete(f"/api/auth/sessions/{other.id}")
            assert deleted.status_code == 204

            revoked = await other_client.get("/api/health/protected")

        still_valid = await client.get("/api/health/protected")

    assert revoked.status_code == 401
    assert still_valid.status_code == 200


@pytest.mark.asyncio
async def test_password_change_revokes_other_sessions_and_keeps_current(session: AsyncSession) -> None:
    user, secret = await _make_user(session)
    other_token = "other-session-token"
    async with await _client() as client:
        token = await _login_totp(client, secret)
        await _add_session(session, user, other_token)

        async with await _client() as other_client:
            other_client.cookies.set("session", other_token)

            changed = await client.post(
                "/api/auth/password",
                json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
            )
            assert changed.status_code == 204

            current = await client.get("/api/health/protected")
            other_protected = await other_client.get("/api/health/protected")

    assert current.status_code == 200
    assert other_protected.status_code == 401
    assert await _session_id(session, token) is not None
    assert await _session_id(session, other_token) is None
