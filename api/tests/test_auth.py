"""Tests for username/password + TOTP login, sessions and rate limiting.

Needs a live Postgres instance with migrations applied -- same
DATABASE_URL setup as test_diary_router.py / test_foods_router.py.
Each DB-backed test runs inside a transaction that's rolled back
afterward (via a `get_session` dependency override).
"""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import ClassVar

import pyotp
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.passwords import hash_password
from app.auth.totp import encrypt_secret, new_secret
from app.db import engine, get_session
from app.main import app
from app.models.user import Role, User, UserSession

PASSWORD = "correct horse battery staple"


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Clear the in-memory login rate limiter between tests."""
    from app.auth import rate_limit

    rate_limit._login_attempts.clear()
    yield
    rate_limit._login_attempts.clear()


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
    # session/challenge cookies on subsequent requests within a test.
    # X-Requested-With satisfies the CSRF middleware, which gates every
    # mutating /api/* request ahead of auth.
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="https://test", headers={"X-Requested-With": "yfp"})


async def _make_user(
    db: AsyncSession, *, username: str = "alice", totp_enabled: bool = True,
) -> tuple[User, str | None]:
    secret = new_secret() if totp_enabled else None
    user = User(
        username=username, display_name="Alice", role=Role.user,
        password_hash=hash_password(PASSWORD), must_change_password=False,
        totp_secret_enc=encrypt_secret(secret) if secret else None,
        totp_enabled=totp_enabled,
    )
    db.add(user)
    await db.flush()
    return user, secret


async def _login(client: AsyncClient, username: str = "alice", password: str = PASSWORD):
    return await client.post("/api/auth/login", json={"username": username, "password": password})


@pytest.mark.asyncio
async def test_login_unknown_username_returns_401() -> None:
    async with await _client() as client:
        response = await _login(client, username="nobody")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_wrong_password_returns_401(session: AsyncSession) -> None:
    await _make_user(session)
    async with await _client() as client:
        response = await _login(client, password="totally-wrong-password")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_correct_credentials_without_totp_returns_setup_required(session: AsyncSession) -> None:
    await _make_user(session, totp_enabled=False)
    async with await _client() as client:
        response = await _login(client)

    assert response.status_code == 200
    assert response.json()["status"] == "setup_required"
    assert "login_challenge" in response.cookies
    assert "session" not in response.cookies


@pytest.mark.asyncio
async def test_login_correct_credentials_with_totp_returns_totp_required(session: AsyncSession) -> None:
    await _make_user(session)
    async with await _client() as client:
        response = await _login(client)

    assert response.status_code == 200
    assert response.json()["status"] == "totp_required"
    assert "login_challenge" in response.cookies


@pytest.mark.asyncio
async def test_full_login_then_totp_grants_session_and_protected_access(session: AsyncSession) -> None:
    _, secret = await _make_user(session)
    async with await _client() as client:
        login_response = await _login(client)
        assert login_response.status_code == 200

        code = pyotp.TOTP(secret).now()
        totp_response = await client.post("/api/auth/totp", json={"code": code})
        assert totp_response.status_code == 200
        assert "session" in totp_response.cookies

        protected = await client.get("/api/health/protected")

    assert protected.status_code == 200


@pytest.mark.asyncio
async def test_wrong_totp_code_returns_401_and_grants_no_session(session: AsyncSession) -> None:
    await _make_user(session)
    async with await _client() as client:
        await _login(client)
        totp_response = await client.post("/api/auth/totp", json={"code": "000000"})
        assert totp_response.status_code == 401

        protected = await client.get("/api/health/protected")

    assert protected.status_code == 401


@pytest.mark.asyncio
async def test_totp_without_login_challenge_returns_401(session: AsyncSession) -> None:
    async with await _client() as client:
        response = await client.post("/api/auth/totp", json={"code": "123456"})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_missing_cookie_denied_on_protected_route() -> None:
    async with await _client() as client:
        response = await client.get("/api/health/protected")

    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}


@pytest.mark.asyncio
async def test_tampered_cookie_denied_on_protected_route() -> None:
    async with await _client() as client:
        client.cookies.set("session", "tampered-not-a-real-token")
        response = await client.get("/api/health/protected")

    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}


@pytest.mark.asyncio
async def test_expired_session_denied_on_protected_route(session: AsyncSession) -> None:
    user, _ = await _make_user(session)
    token = "expired-test-token"
    now = datetime.now(UTC)
    session.add(UserSession(
        user_id=user.id, token_hash=hashlib.sha256(token.encode()).hexdigest(),
        auth_version=user.auth_version, created_at=now - timedelta(days=31),
        last_seen_at=now - timedelta(days=31), expires_at=now - timedelta(days=1),
    ))
    await session.flush()

    async with await _client() as client:
        client.cookies.set("session", token)
        response = await client.get("/api/health/protected")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_sixth_login_attempt_within_a_minute_is_rate_limited() -> None:
    async with await _client() as client:
        for _ in range(5):
            response = await _login(client, password="wrong-password")
            assert response.status_code == 401

        response = await _login(client, password="wrong-password")

    assert response.status_code == 429


@pytest.mark.asyncio
async def test_successful_logins_do_not_count_toward_rate_limit_budget(session: AsyncSession) -> None:
    """A successful login must not consume shared rate-limit budget --
    otherwise a legitimate login by one device could push others toward
    lockout. 10 successful logins in a row (double the 5/min budget) must
    all succeed."""
    await _make_user(session)
    async with await _client() as client:
        for _ in range(10):
            response = await _login(client)
            assert response.status_code == 200


@pytest.mark.asyncio
async def test_failed_logins_still_rate_limited_after_a_successful_login(session: AsyncSession) -> None:
    await _make_user(session)
    async with await _client() as client:
        ok = await _login(client)
        assert ok.status_code == 200

        for _ in range(5):
            response = await _login(client, password="wrong-password")
            assert response.status_code == 401

        response = await _login(client, password="wrong-password")

    assert response.status_code == 429


@pytest.mark.asyncio
async def test_rate_limit_keyed_by_x_real_ip_when_present() -> None:
    """Behind nginx, `request.client.host` is always the `web` container's
    address -- `X-Real-IP` (set by nginx from `$remote_addr`, which a client
    cannot spoof) must be used instead so different real clients get
    independent rate-limit budgets."""
    async with await _client() as client:
        for _ in range(5):
            response = await client.post(
                "/api/auth/login",
                json={"username": "alice", "password": "wrong-password"},
                headers={"X-Real-IP": "203.0.113.10"},
            )
            assert response.status_code == 401

        # Same underlying test-transport "client", but a different
        # X-Real-IP value -- must get its own budget, not be rate-limited
        # by client-A's attempts.
        response = await client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "wrong-password"},
            headers={"X-Real-IP": "203.0.113.20"},
        )
        assert response.status_code == 401

        # client-A's 6th attempt is still rate-limited.
        limited = await client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "wrong-password"},
            headers={"X-Real-IP": "203.0.113.10"},
        )

    assert limited.status_code == 429


@pytest.mark.asyncio
async def test_spoofed_x_forwarded_for_does_not_bypass_rate_limit() -> None:
    """Regression test for the re-review finding: nginx's
    `X-Forwarded-For` is set via `$proxy_add_x_forwarded_for`, which APPENDS
    to whatever the client already sent rather than replacing it -- so a
    client can send an arbitrary, rotating `X-Forwarded-For` value and it
    must NOT be used to derive a fresh rate-limit bucket per request. Same
    underlying connection (no X-Real-IP, as if nginx were bypassed and only
    the spoofable header were present) attempting 6 logins with a different
    X-Forwarded-For each time must still be rate-limited on the 6th."""
    async with await _client() as client:
        for i in range(5):
            response = await client.post(
                "/api/auth/login",
                json={"username": "alice", "password": "wrong-password"},
                headers={"X-Forwarded-For": f"10.0.0.{i}"},
            )
            assert response.status_code == 401

        limited = await client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "wrong-password"},
            headers={"X-Forwarded-For": "10.0.0.99"},
        )

    assert limited.status_code == 429


@pytest.mark.asyncio
async def test_client_ip_falls_back_when_x_real_ip_absent() -> None:
    from app.auth.rate_limit import client_ip

    class _FakeClient:
        host = "127.0.0.1"

    class _FakeRequest:
        headers: ClassVar[dict[str, str]] = {}
        client = _FakeClient()

    assert client_ip(_FakeRequest()) == "127.0.0.1"


@pytest.mark.asyncio
async def test_client_ip_prefers_x_real_ip() -> None:
    from app.auth.rate_limit import client_ip

    class _FakeClient:
        host = "10.0.0.5"  # the web container's address behind nginx

    class _FakeRequest:
        headers: ClassVar[dict[str, str]] = {"x-real-ip": "203.0.113.99"}
        client = _FakeClient()

    assert client_ip(_FakeRequest()) == "203.0.113.99"


@pytest.mark.asyncio
async def test_client_ip_ignores_x_forwarded_for_even_when_x_real_ip_absent() -> None:
    """A client hitting the backend directly (bypassing nginx, so no
    X-Real-IP is set) must not have its self-reported X-Forwarded-For
    trusted -- fall back to the raw connection address instead."""
    from app.auth.rate_limit import client_ip

    class _FakeClient:
        host = "10.0.0.5"

    class _FakeRequest:
        headers: ClassVar[dict[str, str]] = {"x-forwarded-for": "203.0.113.99, 10.0.0.5"}
        client = _FakeClient()

    assert client_ip(_FakeRequest()) == "10.0.0.5"


@pytest.mark.asyncio
async def test_client_ip_caps_absurdly_long_x_real_ip_value() -> None:
    """Defense-in-depth: a client hitting the backend directly (no nginx in
    front) could send an arbitrary, huge X-Real-IP value -- it must be
    capped rather than used verbatim as an unbounded dict key."""
    from app.auth.rate_limit import _MAX_IP_KEY_LENGTH, client_ip

    class _FakeClient:
        host = "10.0.0.5"

    class _FakeRequest:
        headers: ClassVar[dict[str, str]] = {"x-real-ip": "9" * 10_000}
        client = _FakeClient()

    result = client_ip(_FakeRequest())
    assert len(result) == _MAX_IP_KEY_LENGTH
