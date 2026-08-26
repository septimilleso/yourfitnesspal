import time
from typing import ClassVar

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app
from app.security import SESSION_MAX_AGE_SECONDS, create_session_cookie


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Clear the in-memory login rate limiter between tests."""
    from app.routers import auth as auth_router

    auth_router._login_attempts.clear()
    yield
    auth_router._login_attempts.clear()


async def _client() -> AsyncClient:
    # https base_url so httpx's cookiejar will store and resend the Secure
    # session cookie on subsequent requests within a test.
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="https://test")


@pytest.mark.asyncio
async def test_login_wrong_key_returns_401() -> None:
    async with await _client() as client:
        response = await client.post("/api/auth/login", json={"key": "wrong-key"})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_right_key_returns_200_and_sets_cookie() -> None:
    async with await _client() as client:
        response = await client.post("/api/auth/login", json={"key": settings.app_key})

    assert response.status_code == 200
    assert "session" in response.cookies
    set_cookie = response.headers.get("set-cookie", "")
    assert "HttpOnly" in set_cookie
    assert "Secure" in set_cookie
    assert "samesite=lax" in set_cookie.lower()


@pytest.mark.asyncio
async def test_valid_cookie_grants_access_to_protected_route() -> None:
    async with await _client() as client:
        login_response = await client.post("/api/auth/login", json={"key": settings.app_key})
        assert login_response.status_code == 200

        response = await client.get("/api/health/protected")

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_missing_cookie_denied_on_protected_route() -> None:
    async with await _client() as client:
        response = await client.get("/api/health/protected")

    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}


@pytest.mark.asyncio
async def test_tampered_cookie_denied_on_protected_route() -> None:
    async with await _client() as client:
        client.cookies.set("session", "tampered.invalid-signature")
        response = await client.get("/api/health/protected")

    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}


@pytest.mark.asyncio
async def test_expired_cookie_denied_on_protected_route(monkeypatch) -> None:
    # Sign a cookie as if it were created just past SESSION_MAX_AGE_SECONDS
    # ago, by faking time.time() (used by itsdangerous.TimestampSigner) at
    # sign-time only. The signature itself stays valid -- only the embedded
    # timestamp is stale -- so this exercises SignatureExpired specifically,
    # not BadSignature.
    real_time = time.time
    stale_time = real_time() - SESSION_MAX_AGE_SECONDS - 60
    monkeypatch.setattr("itsdangerous.timed.time.time", lambda: stale_time)
    expired_token = create_session_cookie("authenticated")
    monkeypatch.setattr("itsdangerous.timed.time.time", real_time)

    async with await _client() as client:
        client.cookies.set("session", expired_token)
        response = await client.get("/api/health/protected")

    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}


@pytest.mark.asyncio
async def test_sixth_login_attempt_within_a_minute_is_rate_limited() -> None:
    async with await _client() as client:
        for _ in range(5):
            response = await client.post("/api/auth/login", json={"key": "wrong-key"})
            assert response.status_code == 401

        response = await client.post("/api/auth/login", json={"key": "wrong-key"})

    assert response.status_code == 429


@pytest.mark.asyncio
async def test_successful_logins_do_not_count_toward_rate_limit_budget() -> None:
    """A successful login must not consume shared rate-limit budget --
    otherwise a legitimate login by one device could push others toward
    lockout. 10 successful logins in a row (double the 5/min budget) must
    all succeed."""
    async with await _client() as client:
        for _ in range(10):
            response = await client.post("/api/auth/login", json={"key": settings.app_key})
            assert response.status_code == 200


@pytest.mark.asyncio
async def test_failed_logins_still_rate_limited_after_a_successful_login() -> None:
    async with await _client() as client:
        ok = await client.post("/api/auth/login", json={"key": settings.app_key})
        assert ok.status_code == 200

        for _ in range(5):
            response = await client.post("/api/auth/login", json={"key": "wrong-key"})
            assert response.status_code == 401

        response = await client.post("/api/auth/login", json={"key": "wrong-key"})

    assert response.status_code == 429


@pytest.mark.asyncio
async def test_rate_limit_keyed_by_x_forwarded_for_when_present() -> None:
    """Behind nginx, `request.client.host` is always the `web` container's
    address -- `X-Forwarded-For` (set by nginx) must be used instead so
    different real clients get independent rate-limit budgets."""
    async with await _client() as client:
        for _ in range(5):
            response = await client.post(
                "/api/auth/login",
                json={"key": "wrong-key"},
                headers={"X-Forwarded-For": "203.0.113.10"},
            )
            assert response.status_code == 401

        # Same underlying test-transport "client", but a different
        # X-Forwarded-For value -- must get its own budget, not be
        # rate-limited by client-A's attempts.
        response = await client.post(
            "/api/auth/login",
            json={"key": "wrong-key"},
            headers={"X-Forwarded-For": "203.0.113.20"},
        )
        assert response.status_code == 401

        # client-A's 6th attempt is still rate-limited.
        limited = await client.post(
            "/api/auth/login",
            json={"key": "wrong-key"},
            headers={"X-Forwarded-For": "203.0.113.10"},
        )

    assert limited.status_code == 429


@pytest.mark.asyncio
async def test_client_ip_falls_back_when_x_forwarded_for_absent() -> None:
    from app.routers.auth import _client_ip

    class _FakeClient:
        host = "127.0.0.1"

    class _FakeRequest:
        headers: ClassVar[dict[str, str]] = {}
        client = _FakeClient()

    assert _client_ip(_FakeRequest()) == "127.0.0.1"


@pytest.mark.asyncio
async def test_client_ip_prefers_x_forwarded_for_and_takes_first_value() -> None:
    from app.routers.auth import _client_ip

    class _FakeClient:
        host = "10.0.0.5"  # the web container's address behind nginx

    class _FakeRequest:
        headers: ClassVar[dict[str, str]] = {"x-forwarded-for": "203.0.113.99, 10.0.0.5"}
        client = _FakeClient()

    assert _client_ip(_FakeRequest()) == "203.0.113.99"
