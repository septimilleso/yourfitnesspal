"""Add push subscriptions and track notified rest timers.

Revision ID: e3f9b2a7c514
Revises: d5e8a1c3f720
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e3f9b2a7c514"
down_revision: str | Sequence[str] | None = "d5e8a1c3f720"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(length=200), nullable=False),
        sa.Column("auth", sa.String(length=100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("endpoint"),
    )
    op.create_index(
        "ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"], unique=False
    )
    op.add_column(
        "workouts",
        sa.Column("rest_notified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_workouts_rest_pending",
        "workouts",
        ["rest_ends_at"],
        unique=False,
        postgresql_where=sa.text("status = 'in_progress' AND rest_ends_at IS NOT NULL"),
    )
    op.execute(
        "UPDATE workouts SET rest_notified_at = rest_ends_at "
        "WHERE rest_ends_at IS NOT NULL AND rest_ends_at <= now()"
    )


def downgrade() -> None:
    op.drop_index("ix_workouts_rest_pending", table_name="workouts")
    op.drop_column("workouts", "rest_notified_at")
    op.drop_index("ix_push_subscriptions_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
