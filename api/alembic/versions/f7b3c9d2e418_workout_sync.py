"""Add uuid to workouts, exercises and sets, and version to workouts.

Revision ID: f7b3c9d2e418
Revises: c4d7a2f81b56
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f7b3c9d2e418"
down_revision: str | Sequence[str] | None = "c4d7a2f81b56"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID_TABLES = ("workouts", "workout_exercises", "workout_sets")


def upgrade() -> None:
    # gen_random_uuid() is volatile, so existing rows get a distinct value each.
    for table in UUID_TABLES:
        op.add_column(
            table,
            sa.Column(
                "uuid", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
            ),
        )
        op.create_unique_constraint(f"{table}_uuid_key", table, ["uuid"])
    op.add_column(
        "workouts", sa.Column("version", sa.Integer(), server_default="1", nullable=False)
    )


def downgrade() -> None:
    op.drop_column("workouts", "version")
    for table in reversed(UUID_TABLES):
        op.drop_constraint(f"{table}_uuid_key", table, type_="unique")
        op.drop_column(table, "uuid")
