"""OAuth 2.1 storage behind the MCP endpoint (see `app/mcp/oauth.py`).

Codes and tokens are stored only as SHA-256 hashes, like `user_sessions`.
A confidential client's secret is stored encrypted (the MCP SDK compares
it in plaintext), public clients have none.
"""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class OAuthClient(Base):
    """A dynamically registered OAuth client (e.g. one Claude connector)."""

    __tablename__ = "oauth_clients"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    client_id: Mapped[str] = mapped_column(sa.String(64), unique=True, nullable=False)
    client_name: Mapped[str | None] = mapped_column(sa.String(255))
    client_secret_enc: Mapped[str | None] = mapped_column(sa.Text)
    # `OAuthClientInformationFull` as JSON, minus `client_secret`.
    info: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


class OAuthAuthCode(Base):
    """A one-time authorization code issued after the user's consent."""

    __tablename__ = "oauth_auth_codes"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    code_hash: Mapped[str] = mapped_column(sa.String(64), unique=True, nullable=False)
    client_id: Mapped[str] = mapped_column(
        sa.ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    redirect_uri: Mapped[str] = mapped_column(sa.Text, nullable=False)
    redirect_uri_provided_explicitly: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    code_challenge: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
    )
    resource: Mapped[str | None] = mapped_column(sa.Text)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


class OAuthTokenPair(Base):
    """One access/refresh token pair. Refreshing rotates: the old row gets
    `rotated_at` and a new row joins the same `family_id`, so reuse of a
    rotated refresh token can revoke the whole family."""

    __tablename__ = "oauth_tokens"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_id: Mapped[str] = mapped_column(
        sa.ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False, index=True
    )
    family_id: Mapped[str] = mapped_column(sa.String(36), nullable=False, index=True)
    access_token_hash: Mapped[str] = mapped_column(sa.String(64), unique=True, nullable=False)
    access_expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    refresh_token_hash: Mapped[str] = mapped_column(sa.String(64), unique=True, nullable=False)
    refresh_expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
    )
    auth_version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    rotated_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
