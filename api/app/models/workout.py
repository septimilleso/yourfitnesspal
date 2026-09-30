import enum
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.exercise import Exercise


class WorkoutStatus(str, enum.Enum):
    in_progress = "in_progress"
    finished = "finished"


# FKs to `exercises` use the default NO ACTION: exercises are never deleted,
# and NO ACTION (unlike RESTRICT) is checked at statement end, so deleting a
# user cascades through their workouts and custom exercises without tripping it.


class TemplateFolder(Base):
    __tablename__ = "template_folders"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)


class WorkoutTemplate(Base):
    """A reusable workout plan ("Giorno 1"), optionally inside a folder."""

    __tablename__ = "workout_templates"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    folder_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("template_folders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
        nullable=False,
    )

    exercises: Mapped[list["TemplateExercise"]] = relationship(
        order_by="TemplateExercise.position", cascade="all, delete-orphan"
    )


class TemplateExercise(Base):
    __tablename__ = "template_exercises"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(
        sa.ForeignKey("workout_templates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exercise_id: Mapped[int] = mapped_column(
        sa.ForeignKey("exercises.id"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    rest_seconds: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=90)
    superset_group: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)

    exercise: Mapped[Exercise] = relationship()
    sets: Mapped[list["TemplateSet"]] = relationship(
        order_by="TemplateSet.position", cascade="all, delete-orphan"
    )


class TemplateSet(Base):
    __tablename__ = "template_sets"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    template_exercise_id: Mapped[int] = mapped_column(
        sa.ForeignKey("template_exercises.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    weight_kg: Mapped[float | None] = mapped_column(sa.Numeric(6, 2), nullable=True)
    reps: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    duration_s: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)


class Workout(Base):
    """A workout session: `in_progress` while live (at most one per user), then
    `finished`. `rest_ends_at` is the absolute end of the running rest timer."""

    __tablename__ = "workouts"
    __table_args__ = (
        sa.Index(
            "ux_workouts_one_in_progress",
            "user_id",
            unique=True,
            postgresql_where=sa.text("status = 'in_progress'"),
        ),
        sa.Index("ix_workouts_user_finished", "user_id", "finished_at"),
        sa.Index(
            "ix_workouts_rest_pending",
            "rest_ends_at",
            postgresql_where=sa.text("status = 'in_progress' AND rest_ends_at IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    template_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("workout_templates.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    status: Mapped[WorkoutStatus] = mapped_column(
        sa.Enum(
            WorkoutStatus,
            name="workout_status",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    rest_ends_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    # valore di `rest_ends_at` per cui è già partito il push
    rest_notified_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    rest_total_s: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)

    exercises: Mapped[list["WorkoutExercise"]] = relationship(
        order_by="WorkoutExercise.position", cascade="all, delete-orphan"
    )


class WorkoutExercise(Base):
    __tablename__ = "workout_exercises"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    workout_id: Mapped[int] = mapped_column(
        sa.ForeignKey("workouts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exercise_id: Mapped[int] = mapped_column(
        sa.ForeignKey("exercises.id"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    rest_seconds: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=90)
    superset_group: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)

    exercise: Mapped[Exercise] = relationship()
    sets: Mapped[list["WorkoutSet"]] = relationship(
        order_by="WorkoutSet.position", cascade="all, delete-orphan"
    )


class WorkoutSet(Base):
    __tablename__ = "workout_sets"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    workout_exercise_id: Mapped[int] = mapped_column(
        sa.ForeignKey("workout_exercises.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    weight_kg: Mapped[float | None] = mapped_column(sa.Numeric(6, 2), nullable=True)
    reps: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    duration_s: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
