"""SPA-facing consent and connection endpoints (needs Postgres)."""

from urllib.parse import parse_qs, urlsplit

import pytest
import sqlalchemy as sa
from mcp.server.auth.provider import AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull

from app.mcp.consent import load_request
from app.mcp.oauth import PostgresOAuthProvider, create_authorization_code, list_connections
from app.models.oauth import OAuthTokenPair
from app.models.user import AuditEvent, Role
from tests.factories import PASSWORD, http_client, make_user

REDIRECT = "https://claude.ai/api/mcp/auth_callback"


def query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


async def pending_request(client_id: str = "client-1") -> str:
    """Register a client and return the signed `req` the SPA receives."""
    provider = PostgresOAuthProvider()
    info = OAuthClientInformationFull(
        client_id=client_id,
        redirect_uris=[REDIRECT],
        client_name="Claude",
        token_endpoint_auth_method="none",
    )
    await provider.register_client(info)
    url = await provider.authorize(
        info,
        AuthorizationParams(
            state="st4te",
            scopes=[],
            code_challenge="c" * 43,
            redirect_uri=REDIRECT,
            redirect_uri_provided_explicitly=True,
        ),
    )
    return query(url)["req"]


async def connected_user(db, username: str = "alice"):
    """A user with mcp.access holding one live grant for client-1."""
    user = await make_user(db, username=username, permissions=["mcp.access"])
    provider = PostgresOAuthProvider()
    req = await pending_request()
    code = query(await create_authorization_code(db, user, load_request(req)))["code"]
    await db.commit()
    client = await provider.get_client("client-1")
    token = await provider.exchange_authorization_code(
        client, await provider.load_authorization_code(client, code)
    )
    return user, token


async def test_consent_requires_login(db) -> None:
    req = await pending_request()
    async with await http_client() as client:
        response = await client.get("/api/oauth/consent", params={"req": req})
    assert response.status_code == 401


async def test_consent_info(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    req = await pending_request()
    async with await http_client(db, user) as client:
        response = await client.get("/api/oauth/consent", params={"req": req})
    assert response.status_code == 200
    assert response.json() == {
        "client_name": "Claude",
        "redirect_host": "claude.ai",
        "user": {"username": "alice", "display_name": "Alice"},
        "has_permission": True,
    }


async def test_consent_info_rejects_tampered_request(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with await http_client(db, user) as client:
        response = await client.get("/api/oauth/consent", params={"req": "garbage"})
    assert response.status_code == 400


async def test_approve_returns_code_redirect_and_audits(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    req = await pending_request()
    async with await http_client(db, user) as client:
        response = await client.post("/api/oauth/consent", json={"req": req, "approve": True})
    assert response.status_code == 200, response.text
    url = response.json()["redirect_url"]
    assert url.startswith(REDIRECT)
    assert query(url)["state"] == "st4te" and query(url)["code"]
    actions = (await db.scalars(sa.select(AuditEvent.action))).all()
    assert "mcp.connect" in actions


async def test_deny_returns_access_denied(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    req = await pending_request()
    async with await http_client(db, user) as client:
        response = await client.post("/api/oauth/consent", json={"req": req, "approve": False})
    assert query(response.json()["redirect_url"])["error"] == "access_denied"


async def test_approve_without_permission_is_forbidden(db) -> None:
    user = await make_user(db, permissions=[])
    req = await pending_request()
    async with await http_client(db, user) as client:
        response = await client.post("/api/oauth/consent", json={"req": req, "approve": True})
    assert response.status_code == 403
    assert response.json()["detail"] == "mcp_access_missing"


async def test_approve_requires_csrf_header(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    req = await pending_request()
    async with await http_client(db, user, csrf=False) as client:
        response = await client.post("/api/oauth/consent", json={"req": req, "approve": True})
    assert response.status_code == 403
    assert response.json()["detail"] == "csrf"


async def test_list_and_revoke_own_connection(db) -> None:
    user, _ = await connected_user(db)
    async with await http_client(db, user) as client:
        listed = await client.get("/api/oauth/connections")
        assert [c["client_name"] for c in listed.json()] == ["Claude"]
        assert (await client.delete("/api/oauth/connections/client-1")).status_code == 204
        assert (await client.get("/api/oauth/connections")).json() == []
        assert (await client.delete("/api/oauth/connections/unknown")).status_code == 404


async def test_admin_lists_and_revokes_user_connections(db) -> None:
    user, _ = await connected_user(db)
    admin = await make_user(db, username="root", role=Role.admin)
    async with await http_client(db, admin) as client:
        listed = await client.get(f"/api/admin/users/{user.id}/mcp-connections")
        assert [c["client_id"] for c in listed.json()] == ["client-1"]
        response = await client.delete(f"/api/admin/users/{user.id}/mcp-connections")
    assert response.status_code == 204
    assert await list_connections(db, user.id) == []


@pytest.mark.parametrize("how", ["admin_sessions", "deactivate", "password"])
async def test_account_actions_revoke_oauth_tokens(db, how) -> None:
    user, _ = await connected_user(db)
    admin = await make_user(db, username="root", role=Role.admin)
    if how == "password":
        async with await http_client(db, user) as client:
            response = await client.post(
                "/api/auth/password",
                json={
                    "current_password": PASSWORD,
                    "new_password": "another long passphrase 42",
                },
            )
    else:
        async with await http_client(db, admin) as client:
            if how == "admin_sessions":
                response = await client.delete(f"/api/admin/users/{user.id}/sessions")
            else:
                response = await client.patch(
                    f"/api/admin/users/{user.id}", json={"is_active": False}
                )
    assert response.status_code in (200, 204), response.text
    live = await db.scalar(
        sa.select(sa.func.count())
        .select_from(OAuthTokenPair)
        .where(OAuthTokenPair.revoked_at.is_(None))
    )
    assert live == 0


async def test_me_exposes_mcp_url(db) -> None:
    user = await make_user(db)
    async with await http_client(db, user) as client:
        response = await client.get("/api/auth/me")
    assert response.json()["mcp_url"] == "http://localhost:6500/mcp"
