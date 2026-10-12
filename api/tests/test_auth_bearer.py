"""Bearer-token sessions on the same rules as the `session` cookie.

Needs a live Postgres instance with migrations applied -- same DATABASE_URL
setup as test_auth_sessions.py. Each DB-backed test runs inside a transaction
that's rolled back afterward (via a `get_session` dependency override).
"""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, get_session
from app.main import app
from app.models.user import UserSession
from tests.test_auth_sessions import (
    NEW_PASSWORD,
    PASSWORD,
    _add_session,
    _client,
    _login_totp,
    _make_user,
    _session_id,
    _token_hash,
)


@pytest.fixture
async def session():
    async with engine.connect() as connection:
        trans = await connection.begin()
        async with AsyncSession(bind=connection, expire_on_commit=False) as sess:
            app.dependency_overrides[get_session] = lambda: sess
            try:
                yield sess
            finally:
                app.dependency_overrides.pop(get_session, None)
        await trans.rollback()


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_bearer_session_authorizes_protected_route_without_cookie(session: AsyncSession) -> None:
    user, _ = await _make_user(session)
    token = "bearer-valid-token"
    await _add_session(session, user, token)

    async with await _client() as client:
        response = await client.get("/api/health/protected", headers=_bearer(token))

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_bearer_scheme_is_case_insensitive(session: AsyncSession) -> None:
    user, _ = await _make_user(session)
    token = "bearer-lowercase-scheme-token"
    await _add_session(session, user, token)

    async with await _client() as client:
        response = await client.get("/api/health/protected", headers={"Authorization": f"bearer {token}"})

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_random_bearer_token_is_unauthorized(session: AsyncSession) -> None:
    await _make_user(session)

    async with await _client() as client:
        response = await client.get("/api/health/protected", headers=_bearer("random-token-not-in-db"))

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_empty_bearer_token_is_unauthorized(session: AsyncSession) -> None:
    await _make_user(session)

    async with await _client() as client:
        response = await client.get("/api/health/protected", headers={"Authorization": "Bearer   "})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_expired_bearer_session_is_unauthorized(session: AsyncSession) -> None:
    user, _ = await _make_user(session)
    token = "expired-bearer-token"
    now = datetime.now(UTC)
    session.add(UserSession(
        user_id=user.id, token_hash=_token_hash(token),
        auth_version=user.auth_version, created_at=now - timedelta(days=31),
        last_seen_at=now - timedelta(days=31), expires_at=now - timedelta(days=1),
    ))
    await session.flush()

    async with await _client() as client:
        response = await client.get("/api/health/protected", headers=_bearer(token))

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_basic_scheme_with_session_token_is_unauthorized(session: AsyncSession) -> None:
    user, _ = await _make_user(session)
    token = "basic-scheme-token"
    await _add_session(session, user, token)

    async with await _client() as client:
        response = await client.get("/api/health/protected", headers={"Authorization": f"Basic {token}"})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_logout_with_bearer_revokes_that_token(session: AsyncSession) -> None:
    user, _ = await _make_user(session)
    token = "bearer-logout-token"
    await _add_session(session, user, token)

    async with await _client() as client:
        logout = await client.post("/api/auth/logout", headers=_bearer(token))
        assert logout.status_code == 204

        protected = await client.get("/api/health/protected", headers=_bearer(token))
        repeated_logout = await client.post("/api/auth/logout", headers=_bearer(token))

    assert protected.status_code == 401
    assert repeated_logout.status_code == 401
    assert await _session_id(session, token) is None


@pytest.mark.asyncio
async def test_sessions_list_with_bearer_marks_bearer_session_current(session: AsyncSession) -> None:
    user, _ = await _make_user(session)
    token = "bearer-list-token"
    bearer_row = await _add_session(session, user, token)
    other = await _add_session(session, user, "other-list-token")

    async with await _client() as client:
        response = await client.get("/api/auth/sessions", headers=_bearer(token))

    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()}
    assert rows[bearer_row.id]["current"] is True
    assert rows[other.id]["current"] is False


@pytest.mark.asyncio
async def test_bearer_session_revoked_from_cookie_session_is_unauthorized(session: AsyncSession) -> None:
    user, secret = await _make_user(session)
    token = "bearer-revoked-token"
    bearer_row = await _add_session(session, user, token)

    async with await _client() as client:
        await _login_totp(client, secret)

        async with await _client() as bearer_client:
            before = await bearer_client.get("/api/health/protected", headers=_bearer(token))

            deleted = await client.delete(f"/api/auth/sessions/{bearer_row.id}")
            assert deleted.status_code == 204

            after = await bearer_client.get("/api/health/protected", headers=_bearer(token))

    assert before.status_code == 200
    assert after.status_code == 401


@pytest.mark.asyncio
async def test_password_change_from_cookie_revokes_bearer_and_keeps_cookie(session: AsyncSession) -> None:
    user, secret = await _make_user(session)
    token = "bearer-password-token"
    await _add_session(session, user, token)

    async with await _client() as client:
        cookie_token = await _login_totp(client, secret)

        async with await _client() as bearer_client:
            assert (await bearer_client.get("/api/health/protected", headers=_bearer(token))).status_code == 200

            changed = await client.post(
                "/api/auth/password",
                json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
            )
            assert changed.status_code == 204

            current = await client.get("/api/health/protected")
            bearer_after = await bearer_client.get("/api/health/protected", headers=_bearer(token))

    assert current.status_code == 200
    assert bearer_after.status_code == 401
    assert await _session_id(session, cookie_token) is not None
    assert await _session_id(session, token) is None


@pytest.mark.asyncio
async def test_bearer_post_without_x_requested_with_is_csrf_rejected(session: AsyncSession) -> None:
    user, _ = await _make_user(session)
    token = "bearer-csrf-token"
    await _add_session(session, user, token)

    # No default X-Requested-With header here, unlike _client().
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        response = await client.post("/api/auth/logout", headers=_bearer(token))

    assert response.status_code == 403
    assert response.json() == {"detail": "csrf"}
    assert await _session_id(session, token) is not None
