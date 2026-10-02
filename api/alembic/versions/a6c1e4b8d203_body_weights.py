"""Add daily body-weight records.

Revision ID: a6c1e4b8d203
Revises: e3f9b2a7c514
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a6c1e4b8d203"
down_revision: str | Sequence[str] | None = "e3f9b2a7c514"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "body_weights",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("weight_kg", sa.Numeric(4, 1), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("user_id", "date", name="uq_body_weights_user_date"),
    )


def downgrade() -> None:
    op.drop_table("body_weights")
