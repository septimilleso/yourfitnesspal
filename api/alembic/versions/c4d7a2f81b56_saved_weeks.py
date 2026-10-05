"""Add saved weeks and their food items.

Revision ID: c4d7a2f81b56
Revises: a6c1e4b8d203
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c4d7a2f81b56"
down_revision: str | Sequence[str] | None = "a6c1e4b8d203"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    meal_enum = postgresql.ENUM(
        "breakfast", "lunch", "dinner", "snack", name="meal", create_type=False
    )
    op.create_table(
        "saved_weeks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_saved_weeks_user_id", "saved_weeks", ["user_id"])

    op.create_table(
        "saved_week_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "saved_week_id",
            sa.Integer(),
            sa.ForeignKey("saved_weeks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("day_index", sa.Integer(), nullable=False),
        sa.Column("meal", meal_enum, nullable=False),
        sa.Column(
            "food_id",
            sa.Integer(),
            sa.ForeignKey("foods.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("grams", sa.Numeric(10, 2), nullable=False),
        sa.Column("portion_label", sa.String(length=100), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "day_index BETWEEN 0 AND 6", name="ck_saved_week_items_day_index"
        ),
    )
    op.create_index("ix_saved_week_items_saved_week_id", "saved_week_items", ["saved_week_id"])
    op.create_index("ix_saved_week_items_food_id", "saved_week_items", ["food_id"])


def downgrade() -> None:
    op.drop_table("saved_week_items")
    op.drop_table("saved_weeks")
