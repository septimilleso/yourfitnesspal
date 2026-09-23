"""Per-call plumbing for MCP tools: the token's user, a DB session, audit
logging and error translation.

Every tool body runs inside `async with tool_scope() as scope:`. The bearer
token was already validated by the SDK (via `PostgresOAuthProvider.
load_access_token`); here we load the user it belongs to, re-check access,
and turn domain errors into MCP tool errors the assistant can read.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import session_scope
from app.mcp.oauth import user_may_connect
from app.models.oauth import OAuthClient
from app.models.user import User
from app.services.audit import record
from app.services.errors import ServiceError
from app.services.off_client import OffClient

_off_client: OffClient | None = None


def set_off_client(client: OffClient | None) -> None:
    """Share the app-wide OffClient (and its rate limiters) with the tools."""
    global _off_client
    _off_client = client


def off_client() -> OffClient:
    if _off_client is None:
        raise ToolError("OpenFoodFacts is not available right now")
    return _off_client


def today() -> date:
    return datetime.now(ZoneInfo(settings.app_timezone)).date()


@dataclass
class ToolScope:
    db: AsyncSession
    user: User
    client_name: str

    async def audit(self, action: str, details: dict | None = None) -> None:
        await record(
            self.db, self.user, f"mcp.{action}", self.user.id,
            {"client": self.client_name, **(details or {})},
        )
        await self.db.commit()


@asynccontextmanager
async def tool_scope() -> AsyncIterator[ToolScope]:
    token = get_access_token()
    if token is None or token.subject is None:
        raise ToolError("Not authenticated")
    async with session_scope() as db:
        user = await db.get(User, int(token.subject))
        if user is None or not user_may_connect(user):
            raise ToolError("Access to this account has been revoked")
        client_name = await db.scalar(
            sa.select(OAuthClient.client_name).where(OAuthClient.client_id == token.client_id)
        )
        try:
            yield ToolScope(db=db, user=user, client_name=client_name or token.client_id)
        except ServiceError as exc:
            raise ToolError(str(exc)) from exc
