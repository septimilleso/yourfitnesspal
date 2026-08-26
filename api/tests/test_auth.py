import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app


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
async def test_sixth_login_attempt_within_a_minute_is_rate_limited() -> None:
    async with await _client() as client:
        for _ in range(5):
            response = await client.post("/api/auth/login", json={"key": "wrong-key"})
            assert response.status_code == 401

        response = await client.post("/api/auth/login", json={"key": "wrong-key"})

    assert response.status_code == 429
