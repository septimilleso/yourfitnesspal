"""PostgresOAuthProvider, driven directly (no HTTP). Needs Postgres."""

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
import sqlalchemy as sa
from mcp.server.auth.provider import AuthorizationParams, RegistrationError, TokenError
from mcp.shared.auth import OAuthClientInformationFull

from app.mcp.consent import load_request, sign_request
from app.mcp.oauth import (
    PostgresOAuthProvider,
    create_authorization_code,
    hash_token,
    list_connections,
    revoke_user_tokens,
)
from app.models.oauth import OAuthClient, OAuthTokenPair
from app.models.user import AuditEvent
from tests.factories import make_user

REDIRECT = "https://claude.ai/api/mcp/auth_callback"


def client_info(client_id: str = "client-1", redirect: str = REDIRECT, secret: str | None = None):
    return OAuthClientInformationFull(
        client_id=client_id, client_secret=secret, redirect_uris=[redirect], client_name="Claude",
        token_endpoint_auth_method="none" if secret is None else "client_secret_post",
        grant_types=["authorization_code", "refresh_token"], response_types=["code"],
    )


def params(state: str = "st4te") -> AuthorizationParams:
    return AuthorizationParams(
        state=state, scopes=[], code_challenge="c" * 43, redirect_uri=REDIRECT,
        redirect_uri_provided_explicitly=True,
    )


def query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


async def consent_code(db, provider, user, client) -> str:
    """authorize() -> signed request -> approved consent -> raw code."""
    url = await provider.authorize(client, params())
    request = load_request(query(url)["req"])
    redirect = await create_authorization_code(db, user, request)
    await db.commit()
    return query(redirect)["code"]


async def connect(db, provider, user, client) -> tuple[str, str]:
    await provider.register_client(client)
    code = await consent_code(db, provider, user, client)
    loaded = await provider.load_authorization_code(client, code)
    token = await provider.exchange_authorization_code(client, loaded)
    return token.access_token, token.refresh_token


@pytest.fixture
def provider() -> PostgresOAuthProvider:
    return PostgresOAuthProvider()


async def test_register_rejects_plain_http_redirect(db, provider) -> None:
    with pytest.raises(RegistrationError) as info:
        await provider.register_client(client_info(redirect="http://evil.example/cb"))
    assert info.value.error == "invalid_redirect_uri"


async def test_register_accepts_loopback_http(db, provider) -> None:
    await provider.register_client(client_info(redirect="http://127.0.0.1:33418/callback"))
    assert await provider.get_client("client-1") is not None


async def test_client_secret_is_stored_encrypted(db, provider) -> None:
    await provider.register_client(client_info(secret="s3cret-value"))
    row = await db.scalar(sa.select(OAuthClient).where(OAuthClient.client_id == "client-1"))
    assert row.client_secret_enc and "s3cret-value" not in row.client_secret_enc
    assert "client_secret" not in row.info
    assert (await provider.get_client("client-1")).client_secret == "s3cret-value"


async def test_authorize_redirects_to_consent_page_with_signed_request(db, provider) -> None:
    client = client_info()
    await provider.register_client(client)
    url = await provider.authorize(client, params(state="xyz"))
    assert url.startswith("http://localhost:6500/connect?req=")
    request = load_request(query(url)["req"])
    assert request["state"] == "xyz"
    assert request["code_challenge"] == "c" * 43
    assert request["redirect_uri"] == REDIRECT


def test_load_request_rejects_tampering() -> None:
    token = sign_request({"client_id": "a"})
    assert load_request(token + "x") is None


async def test_full_flow_issues_a_valid_access_token(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    access, _ = await connect(db, provider, user, client_info())
    loaded = await provider.load_access_token(access)
    assert loaded is not None
    assert (loaded.subject, loaded.client_id) == (str(user.id), "client-1")
    row = await db.scalar(sa.select(OAuthTokenPair))
    assert row.access_token_hash == hash_token(access)


async def test_code_reuse_is_rejected_and_revokes_tokens(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    client = client_info()
    await provider.register_client(client)
    code = await consent_code(db, provider, user, client)
    token = await provider.exchange_authorization_code(
        client, await provider.load_authorization_code(client, code)
    )
    assert await provider.load_authorization_code(client, code) is None
    assert await provider.load_access_token(token.access_token) is None
    actions = (await db.scalars(sa.select(AuditEvent.action))).all()
    assert "mcp.token_reuse" in actions


async def test_exchange_fails_when_permission_removed_after_consent(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    client = client_info()
    await provider.register_client(client)
    code = await consent_code(db, provider, user, client)
    loaded = await provider.load_authorization_code(client, code)
    user.permissions = []
    await db.flush()
    with pytest.raises(TokenError) as info:
        await provider.exchange_authorization_code(client, loaded)
    assert info.value.error == "invalid_grant"


async def test_refresh_rotates_the_pair(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    client = client_info()
    access, refresh = await connect(db, provider, user, client)
    loaded = await provider.load_refresh_token(client, refresh)
    new = await provider.exchange_refresh_token(client, loaded, [])
    assert new.access_token != access and new.refresh_token != refresh
    assert await provider.load_access_token(access) is None
    assert await provider.load_access_token(new.access_token) is not None


async def test_rotated_refresh_reuse_revokes_the_family(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    client = client_info()
    _, refresh = await connect(db, provider, user, client)
    new = await provider.exchange_refresh_token(
        client, await provider.load_refresh_token(client, refresh), []
    )
    assert await provider.load_refresh_token(client, refresh) is None
    assert await provider.load_access_token(new.access_token) is None


@pytest.mark.parametrize("change", ["auth_version", "inactive", "permission"])
async def test_access_token_dies_with_the_account_state(db, provider, change) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    access, _ = await connect(db, provider, user, client_info())
    if change == "auth_version":
        user.auth_version += 1
    elif change == "inactive":
        user.is_active = False
    else:
        user.permissions = []
    await db.flush()
    assert await provider.load_access_token(access) is None


async def test_expired_access_token_is_rejected(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    access, _ = await connect(db, provider, user, client_info())
    row = await db.scalar(sa.select(OAuthTokenPair))
    row.access_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db.flush()
    assert await provider.load_access_token(access) is None


async def test_revoke_token_kills_access_and_refresh(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    client = client_info()
    access, refresh = await connect(db, provider, user, client)
    await provider.revoke_token(await provider.load_access_token(access))
    assert await provider.load_access_token(access) is None
    assert await provider.load_refresh_token(client, refresh) is None


async def test_list_and_revoke_connections(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    access, _ = await connect(db, provider, user, client_info())
    connections = await list_connections(db, user.id)
    assert [(c["client_id"], c["client_name"]) for c in connections] == [("client-1", "Claude")]
    assert await revoke_user_tokens(db, user.id, "client-1") == 1
    await db.commit()
    assert await list_connections(db, user.id) == []
    assert await provider.load_access_token(access) is None
