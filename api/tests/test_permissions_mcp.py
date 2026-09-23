"""The mcp.access permission and the generic rate-limit buckets."""

from app.auth import rate_limit
from app.models.user import Role, User
from app.permissions import (
    DEFAULT_PERMISSIONS,
    PERMISSION_LABELS,
    Permission,
    effective_permissions,
)
from tests.factories import http_client, make_user


def test_mcp_access_is_opt_in() -> None:
    assert Permission.mcp_access.value == "mcp.access"
    assert Permission.mcp_access not in DEFAULT_PERMISSIONS
    assert PERMISSION_LABELS[Permission.mcp_access] == "Connessioni AI (MCP)"


def test_admin_always_has_mcp_access() -> None:
    admin = User(username="root", display_name="Root", role=Role.admin, permissions=[])
    assert Permission.mcp_access in effective_permissions(admin)


def test_consume_limits_per_bucket_and_key() -> None:
    for _ in range(3):
        assert rate_limit.consume("t", "1.2.3.4", limit=3) is False
    assert rate_limit.consume("t", "1.2.3.4", limit=3) is True
    assert rate_limit.consume("t", "5.6.7.8", limit=3) is False
    assert rate_limit.consume("other", "1.2.3.4", limit=3) is False


async def test_admin_created_user_does_not_get_mcp_access(db) -> None:
    admin = await make_user(db, username="root", role=Role.admin)
    async with await http_client(db, admin) as client:
        response = await client.post(
            "/api/admin/users", json={"username": "bob", "display_name": "Bob", "role": "user"}
        )
    assert response.status_code == 201, response.text
    assert "mcp.access" not in response.json()["permissions"]
    assert "goals.edit" in response.json()["permissions"]
