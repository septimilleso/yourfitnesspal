"""Days on which each user opened the web app (streak counter).

Revision ID: d5e8a1c3f720
Revises: b81f5e3a6c42
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d5e8a1c3f720"
down_revision: str | Sequence[str] | None = "b81f5e3a6c42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_activity_days",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("day", sa.Date(), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("user_activity_days")
