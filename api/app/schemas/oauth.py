"""Request/response shapes for the SPA's OAuth consent and connection views."""

from datetime import datetime

from pydantic import BaseModel


class ConsentDecision(BaseModel):
    req: str
    approve: bool


class McpConnectionOut(BaseModel):
    client_id: str
    client_name: str
    connected_at: datetime
    last_used_at: datetime | None
