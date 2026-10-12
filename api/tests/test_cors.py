"""CORS allowlist for the native app (R8, C11). No database needed.

The preflight carries `Access-Control-Request-Method`: Starlette only treats a
request as a preflight when that header is present.
"""

from httpx import ASGITransport, AsyncClient
from starlette.types import Receive, Scope, Send

from app.main import ApiCORSMiddleware, app

APP_ORIGIN = "capacitor://localhost"
EVIL_ORIGIN = "https://evil.example"
MCP_INSPECTOR_ORIGIN = "http://localhost:6274"
PREFLIGHT = {
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization, content-type, x-requested-with",
}
# The MCP SDK's /token policy allows only content-type (and mcp-protocol-version),
# so an OAuth preflight with authorization is rejected by the SDK itself.
OAUTH_PREFLIGHT = {
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type",
}


def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="https://test")


def _allowed(header_value: str) -> set[str]:
    return {item.strip().lower() for item in header_value.split(",")}


async def _stub_app(scope: Scope, receive: Receive, send: Send) -> None:
    # Stands in for the MCP SDK route: answers any request with ACAO "*".
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"access-control-allow-origin", b"*")],
        }
    )
    await send({"type": "http.response.body", "body": b""})


async def test_preflight_from_app_origin_is_allowed() -> None:
    async with _client() as client:
        response = await client.options(
            "/api/auth/login", headers={"Origin": APP_ORIGIN, **PREFLIGHT}
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == APP_ORIGIN
    allowed_headers = _allowed(response.headers["access-control-allow-headers"])
    assert {"authorization", "content-type", "x-requested-with"} <= allowed_headers
    assert {"x-yfp-client", "x-yfp-challenge"} <= allowed_headers
    assert "POST" in response.headers["access-control-allow-methods"]


async def test_preflight_from_foreign_origin_gets_no_allow_origin() -> None:
    async with _client() as client:
        response = await client.options(
            "/api/auth/login", headers={"Origin": EVIL_ORIGIN, **PREFLIGHT}
        )

    assert "access-control-allow-origin" not in response.headers


async def test_simple_request_from_app_origin_has_cors_header_without_credentials() -> None:
    async with _client() as client:
        response = await client.get("/api/health", headers={"Origin": APP_ORIGIN})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == APP_ORIGIN
    assert "access-control-allow-credentials" not in response.headers


async def test_api_preflight_accepts_custom_native_headers() -> None:
    headers = {
        "Origin": APP_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, x-yfp-client, x-yfp-challenge",
    }
    async with _client() as client:
        response = await client.options("/api/auth/login", headers=headers)

    assert response.status_code == 200
    allowed_headers = _allowed(response.headers["access-control-allow-headers"])
    assert {"content-type", "x-yfp-client", "x-yfp-challenge"} <= allowed_headers


async def test_oauth_preflight_is_answered_by_mcp_sdk_not_app_allowlist() -> None:
    # Real app, no DB: /token belongs to the MCP SDK, which allows any origin.
    # The app allowlist must not turn this into a 400 "Disallowed CORS origin".
    async with _client() as client:
        response = await client.options(
            "/token", headers={"Origin": MCP_INSPECTOR_ORIGIN, **OAUTH_PREFLIGHT}
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"


async def test_wrapper_passes_non_api_paths_through_unchanged() -> None:
    # Direct test of the wrapper with a stub app: a path outside /api/ must
    # reach the stub untouched, so its own ACAO "*" is the only CORS header.
    transport = ASGITransport(app=ApiCORSMiddleware(_stub_app))
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.options(
            "/token", headers={"Origin": MCP_INSPECTOR_ORIGIN, **OAUTH_PREFLIGHT}
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"


async def test_wrapper_delegates_api_paths_to_allowlist() -> None:
    # The same stub under /api/ must not answer: the allowlist decides, and an
    # origin outside it gets the CORS middleware's 400, not the stub's 200.
    transport = ASGITransport(app=ApiCORSMiddleware(_stub_app))
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.options(
            "/api/auth/login", headers={"Origin": MCP_INSPECTOR_ORIGIN, **PREFLIGHT}
        )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


async def test_csrf_rejection_still_carries_cors_header() -> None:
    # Bearer write without X-Requested-With: the csrf middleware answers 403
    # before any route runs, and CORS must still wrap that response.
    async with _client() as client:
        response = await client.post(
            "/api/auth/logout",
            headers={"Origin": APP_ORIGIN, "Authorization": "Bearer not-a-real-token"},
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "csrf"}
    assert response.headers["access-control-allow-origin"] == APP_ORIGIN
