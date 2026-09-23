"""The MCP/OAuth HTTP surface mounted into the FastAPI app (needs Postgres).

`/mcp` itself needs the SDK session manager running (started by the app
lifespan, which ASGITransport does not run), so these tests stop at the
bearer check; tool behaviour is covered in-process by test_mcp_tools_*.
"""

import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlsplit

from app.mcp.oauth import PostgresOAuthProvider
from tests.factories import http_client, make_user

REDIRECT = "https://claude.ai/api/mcp/auth_callback"


def query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


def pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


async def register(client, redirect: str = REDIRECT):
    return await client.post(
        "/register",
        json={
            "redirect_uris": [redirect],
            "token_endpoint_auth_method": "none",
            "client_name": "Claude",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        },
    )


async def test_metadata_documents(db) -> None:
    async with await http_client() as client:
        server = await client.get("/.well-known/oauth-authorization-server")
        resource = await client.get("/.well-known/oauth-protected-resource/mcp")
    assert server.status_code == 200
    assert server.json()["issuer"] == "http://localhost:6500"
    assert server.json()["registration_endpoint"] == "http://localhost:6500/register"
    assert resource.json()["resource"] == "http://localhost:6500/mcp"


async def test_mcp_without_token_is_401_with_resource_metadata(db) -> None:
    async with await http_client() as client:
        response = await client.post("/mcp", json={})
    assert response.status_code == 401
    assert "oauth-protected-resource/mcp" in response.headers["www-authenticate"]


async def test_api_routes_still_win_over_the_mount(db) -> None:
    async with await http_client() as client:
        assert (await client.get("/api/health")).json() == {"status": "ok"}


async def test_register_rejects_non_https_redirect(db) -> None:
    async with await http_client() as client:
        response = await register(client, "http://evil.example/cb")
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_redirect_uri"


async def test_register_is_rate_limited(db) -> None:
    async with await http_client() as client:
        statuses = [(await register(client)).status_code for _ in range(11)]
    assert statuses[:10] == [201] * 10
    assert statuses[10] == 429


async def test_full_http_flow_with_refresh(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    verifier, challenge = pkce()
    async with await http_client(db, user) as client:
        client_id = (await register(client)).json()["client_id"]
        authorize = await client.get(
            "/authorize",
            params={
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": REDIRECT,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "state": "abc",
            },
        )
        assert authorize.status_code == 302
        req = query(authorize.headers["location"])["req"]

        consent = await client.post("/api/oauth/consent", json={"req": req, "approve": True})
        code = query(consent.json()["redirect_url"])["code"]

        bad = await client.post(
            "/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT,
                "client_id": client_id,
                "code_verifier": "x" * 50,
            },
        )
        assert bad.status_code == 400

        token = await client.post(
            "/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT,
                "client_id": client_id,
                "code_verifier": verifier,
            },
        )
        assert token.status_code == 200, token.text
        body = token.json()
        assert body["token_type"] == "Bearer" and body["expires_in"] == 3600

        refreshed = await client.post(
            "/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": body["refresh_token"],
                "client_id": client_id,
            },
        )
        assert refreshed.status_code == 200, refreshed.text

    provider = PostgresOAuthProvider()
    assert await provider.load_access_token(body["access_token"]) is None
    assert await provider.load_access_token(refreshed.json()["access_token"]) is not None
