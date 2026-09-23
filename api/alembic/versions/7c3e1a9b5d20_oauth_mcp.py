"""OAuth 2.1 storage for the MCP endpoint.

Revision ID: 7c3e1a9b5d20
Revises: 4f2a6d9e8b31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "7c3e1a9b5d20"
down_revision: str | Sequence[str] | None = "4f2a6d9e8b31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EMPTY_JSON = sa.text("'[]'::jsonb")


def upgrade() -> None:
    op.create_table(
        "oauth_clients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("client_id", sa.String(64), nullable=False, unique=True),
        sa.Column("client_name", sa.String(255), nullable=True),
        sa.Column("client_secret_enc", sa.Text(), nullable=True),
        sa.Column("info", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_table(
        "oauth_auth_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "client_id",
            sa.String(64),
            sa.ForeignKey("oauth_clients.client_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("redirect_uri_provided_explicitly", sa.Boolean(), nullable=False),
        sa.Column("code_challenge", sa.String(128), nullable=False),
        sa.Column("scopes", postgresql.JSONB(), nullable=False, server_default=_EMPTY_JSON),
        sa.Column("resource", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_oauth_auth_codes_client_id", "oauth_auth_codes", ["client_id"])
    op.create_index("ix_oauth_auth_codes_user_id", "oauth_auth_codes", ["user_id"])
    op.create_table(
        "oauth_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "client_id",
            sa.String(64),
            sa.ForeignKey("oauth_clients.client_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("family_id", sa.String(36), nullable=False),
        sa.Column("access_token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("refresh_token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("refresh_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scopes", postgresql.JSONB(), nullable=False, server_default=_EMPTY_JSON),
        sa.Column("auth_version", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_oauth_tokens_user_id", "oauth_tokens", ["user_id"])
    op.create_index("ix_oauth_tokens_client_id", "oauth_tokens", ["client_id"])
    op.create_index("ix_oauth_tokens_family_id", "oauth_tokens", ["family_id"])


def downgrade() -> None:
    op.drop_table("oauth_tokens")
    op.drop_table("oauth_auth_codes")
    op.drop_table("oauth_clients")
