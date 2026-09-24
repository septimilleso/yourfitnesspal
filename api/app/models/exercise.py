import enum
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

# Values used by the free-exercise-db catalog; custom exercises must pick from these.
EQUIPMENT = (
    "bands", "barbell", "body only", "cable", "dumbbell", "e-z curl bar", "exercise ball",
    "foam roll", "kettlebells", "machine", "medicine ball", "other",
)
MUSCLES = (
    "abdominals", "abductors", "adductors", "biceps", "calves", "chest", "forearms", "glutes",
    "hamstrings", "lats", "lower back", "middle back", "neck", "quadriceps", "shoulders",
    "traps", "triceps",
)


class Tracking(str, enum.Enum):
    """What a set of this exercise records. Values map 1:1 to the Postgres enum."""

    weight_reps = "weight_reps"
    reps = "reps"
    duration = "duration"


class Exercise(Base):
    """An exercise from the bundled catalog (`source="catalog"`) or a user's own
    (`source="custom"`, `owner_user_id` set).

    Rows are never deleted: history and templates reference them. A custom
    exercise the user "deletes" gets `archived_at` and disappears from search.
    """

    __tablename__ = "exercises"
    __table_args__ = (
        sa.CheckConstraint(
            "(source = 'custom') = (owner_user_id IS NOT NULL)",
            name="ck_exercises_owner_only_custom",
        ),
        sa.UniqueConstraint("source", "source_id", name="uq_exercises_source_source_id"),
        sa.Index(
            "ix_exercises_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
    )

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    source: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    source_id: Mapped[str | None] = mapped_column(sa.String(128), nullable=True)
    owner_user_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    equipment: Mapped[str | None] = mapped_column(sa.String(32), nullable=True)
    primary_muscles: Mapped[list[str]] = mapped_column(
        ARRAY(sa.String(32)), nullable=False, server_default="{}"
    )
    secondary_muscles: Mapped[list[str]] = mapped_column(
        ARRAY(sa.String(32)), nullable=False, server_default="{}"
    )
    category: Mapped[str | None] = mapped_column(sa.String(32), nullable=True)
    instructions: Mapped[list[str]] = mapped_column(
        ARRAY(sa.Text), nullable=False, server_default="{}"
    )
    tracking: Mapped[Tracking] = mapped_column(
        sa.Enum(
            Tracking,
            name="exercise_tracking",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Exercise(id={self.id!r}, name={self.name!r})"
