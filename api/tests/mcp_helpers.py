"""In-process MCP client wired to the real server, acting as a given user.

The bearer middleware is bypassed (in-memory transport), so we set the
SDK's auth context variable directly; the server task inherits it when
`Client` starts, which is exactly what `get_access_token()` reads.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from mcp import Client
from mcp.server.auth.middleware.auth_context import auth_context_var
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
from mcp.server.auth.provider import AccessToken

from app.mcp.server import mcp_server
from app.models.user import User


@asynccontextmanager
async def mcp_client(user: User, client_id: str = "test-client") -> AsyncIterator[Client]:
    token = AccessToken(token="test", client_id=client_id, scopes=[], subject=str(user.id))
    reset = auth_context_var.set(AuthenticatedUser(token))
    try:
        async with Client(mcp_server) as client:
            yield client
    finally:
        auth_context_var.reset(reset)


async def call(client: Client, name: str, /, **args: Any) -> dict:
    # `name` is positional-only: several tools (e.g. create_custom_food) have
    # their own `name` argument, which would otherwise collide as a keyword.
    result = await client.call_tool(name, args)
    assert not result.is_error, result.content
    return result.structured_content


async def call_error(client: Client, name: str, /, **args: Any) -> str:
    result = await client.call_tool(name, args)
    assert result.is_error, result.structured_content
    return result.content[0].text


class FakeOff:
    """OffClient stand-in: OFF answers nothing, product lookups miss."""

    async def search(self, q: str, limit: int):
        return []

    async def get_product(self, barcode: str):
        return None

    async def aclose(self):
        pass


class ExplodingOff:
    async def search(self, q: str, limit: int):
        raise AssertionError("OFF must not be called")

    async def get_product(self, barcode: str):
        raise AssertionError("OFF must not be called")

    async def aclose(self):
        raise AssertionError("OFF must not be closed")
