"""Endpoints the SPA uses to finish an MCP OAuth authorization and to
manage the user's AI connections.

The OAuth protocol endpoints themselves (/authorize, /token, ...) are
served by the MCP SDK; `/authorize` redirects the browser to the SPA's
`/connect` page, which calls these endpoints with the normal session
cookie (and the CSRF header, enforced by `app.main`).
"""

from typing import Annotated
from urllib.parse import urlsplit

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.rate_limit import client_ip, consume
from app.db import get_session
from app.mcp.consent import load_request
from app.mcp.oauth import (
    create_authorization_code,
    denied_redirect,
    list_connections,
    revoke_user_tokens,
    user_may_connect,
)
from app.models.oauth import OAuthClient
from app.models.user import User
from app.schemas.oauth import ConsentDecision, McpConnectionOut
from app.services.audit import record

router = APIRouter(prefix="/api/oauth", tags=["oauth"])
Db = Annotated[AsyncSession, Depends(get_session)]
Current = Annotated[User, Depends(get_current_user)]


async def _pending(db: AsyncSession, req: str) -> tuple[dict, OAuthClient]:
    data = load_request(req)
    client = None
    if data is not None:
        client = await db.scalar(
            sa.select(OAuthClient).where(OAuthClient.client_id == data["client_id"])
        )
    if data is None or client is None:
        raise HTTPException(400, "richiesta scaduta")
    return data, client


@router.get("/consent")
async def consent_info(req: str, db: Db, user: Current):
    data, client = await _pending(db, req)
    return {
        "client_name": client.client_name or "Client MCP",
        "redirect_host": urlsplit(data["redirect_uri"]).hostname,
        "user": {"username": user.username, "display_name": user.display_name},
        "has_permission": user_may_connect(user),
    }


@router.post("/consent")
async def consent(payload: ConsentDecision, request: Request, db: Db, user: Current):
    if consume("oauth-consent", client_ip(request), limit=20):
        raise HTTPException(429, "too many attempts")
    data, client = await _pending(db, payload.req)
    if not payload.approve:
        return {"redirect_url": denied_redirect(data)}
    if not user_may_connect(user):
        raise HTTPException(403, "mcp_access_missing")
    redirect_url = await create_authorization_code(db, user, data)
    await record(
        db,
        user,
        "mcp.connect",
        user.id,
        {"client": client.client_name or client.client_id},
        request,
    )
    await db.commit()
    return {"redirect_url": redirect_url}


@router.get("/connections", response_model=list[McpConnectionOut])
async def connections(db: Db, user: Current):
    return await list_connections(db, user.id)


@router.delete("/connections/{client_id}", status_code=204)
async def revoke_connection(client_id: str, request: Request, db: Db, user: Current):
    if not await revoke_user_tokens(db, user.id, client_id):
        raise HTTPException(404, "connection not found")
    await record(db, user, "mcp.revoke", user.id, {"client_id": client_id}, request)
    await db.commit()
