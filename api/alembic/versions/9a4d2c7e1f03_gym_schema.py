"""Gym: exercises, templates, workouts, and the workouts.use permission.

Revision ID: 9a4d2c7e1f03
Revises: 7c3e1a9b5d20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "9a4d2c7e1f03"
down_revision: str | Sequence[str] | None = "7c3e1a9b5d20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EMPTY_ARRAY = sa.text("'{}'")


def upgrade() -> None:
    bind = op.get_bind()
    tracking = postgresql.ENUM(
        "weight_reps", "reps", "duration", name="exercise_tracking", create_type=False
    )
    status = postgresql.ENUM("in_progress", "finished", name="workout_status", create_type=False)
    tracking.create(bind, checkfirst=True)
    status.create(bind, checkfirst=True)

    op.create_table(
        "exercises",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("source_id", sa.String(128), nullable=True),
        sa.Column(
            "owner_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("equipment", sa.String(32), nullable=True),
        sa.Column(
            "primary_muscles", postgresql.ARRAY(sa.String(32)), nullable=False,
            server_default=_EMPTY_ARRAY,
        ),
        sa.Column(
            "secondary_muscles", postgresql.ARRAY(sa.String(32)), nullable=False,
            server_default=_EMPTY_ARRAY,
        ),
        sa.Column("category", sa.String(32), nullable=True),
        sa.Column(
            "instructions", postgresql.ARRAY(sa.Text()), nullable=False,
            server_default=_EMPTY_ARRAY,
        ),
        sa.Column("tracking", tracking, nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(source = 'custom') = (owner_user_id IS NOT NULL)",
            name="ck_exercises_owner_only_custom",
        ),
        sa.UniqueConstraint("source", "source_id", name="uq_exercises_source_source_id"),
    )
    op.create_index("ix_exercises_owner_user_id", "exercises", ["owner_user_id"])
    op.create_index(
        "ix_exercises_name_trgm", "exercises", ["name"],
        postgresql_using="gin", postgresql_ops={"name": "gin_trgm_ops"},
    )

    op.create_table(
        "template_folders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_template_folders_user_id", "template_folders", ["user_id"])

    op.create_table(
        "workout_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "folder_id", sa.Integer(),
            sa.ForeignKey("template_folders.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_workout_templates_user_id", "workout_templates", ["user_id"])
    op.create_index("ix_workout_templates_folder_id", "workout_templates", ["folder_id"])

    op.create_table(
        "template_exercises",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "template_id", sa.Integer(),
            sa.ForeignKey("workout_templates.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("exercise_id", sa.Integer(), sa.ForeignKey("exercises.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("rest_seconds", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("superset_group", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
    )
    op.create_index("ix_template_exercises_template_id", "template_exercises", ["template_id"])
    op.create_index("ix_template_exercises_exercise_id", "template_exercises", ["exercise_id"])

    op.create_table(
        "template_sets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "template_exercise_id", sa.Integer(),
            sa.ForeignKey("template_exercises.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("weight_kg", sa.Numeric(6, 2), nullable=True),
        sa.Column("reps", sa.Integer(), nullable=True),
        sa.Column("duration_s", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_template_sets_template_exercise_id", "template_sets", ["template_exercise_id"]
    )

    op.create_table(
        "workouts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "template_id", sa.Integer(),
            sa.ForeignKey("workout_templates.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("status", status, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rest_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rest_total_s", sa.Integer(), nullable=True),
    )
    op.create_index("ix_workouts_user_id", "workouts", ["user_id"])
    op.create_index("ix_workouts_template_id", "workouts", ["template_id"])
    op.create_index("ix_workouts_user_finished", "workouts", ["user_id", "finished_at"])
    op.create_index(
        "ux_workouts_one_in_progress", "workouts", ["user_id"], unique=True,
        postgresql_where=sa.text("status = 'in_progress'"),
    )

    op.create_table(
        "workout_exercises",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "workout_id", sa.Integer(), sa.ForeignKey("workouts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("exercise_id", sa.Integer(), sa.ForeignKey("exercises.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("rest_seconds", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("superset_group", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
    )
    op.create_index("ix_workout_exercises_workout_id", "workout_exercises", ["workout_id"])
    op.create_index("ix_workout_exercises_exercise_id", "workout_exercises", ["exercise_id"])

    op.create_table(
        "workout_sets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "workout_exercise_id", sa.Integer(),
            sa.ForeignKey("workout_exercises.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("weight_kg", sa.Numeric(6, 2), nullable=True),
        sa.Column("reps", sa.Integer(), nullable=True),
        sa.Column("duration_s", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_workout_sets_workout_exercise_id", "workout_sets", ["workout_exercise_id"]
    )

    # Existing accounts get the new default permission too.
    op.execute(
        "UPDATE users SET permissions = permissions || '[\"workouts.use\"]'::jsonb "
        "WHERE NOT permissions ? 'workouts.use'"
    )


def downgrade() -> None:
    op.execute("UPDATE users SET permissions = permissions - 'workouts.use'")
    op.drop_table("workout_sets")
    op.drop_table("workout_exercises")
    op.drop_table("workouts")
    op.drop_table("template_sets")
    op.drop_table("template_exercises")
    op.drop_table("workout_templates")
    op.drop_table("template_folders")
    op.drop_table("exercises")
    bind = op.get_bind()
    postgresql.ENUM(name="workout_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="exercise_tracking").drop(bind, checkfirst=True)
