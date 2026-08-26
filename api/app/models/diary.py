import enum
from datetime import date

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.food import Food


class Meal(str, enum.Enum):
    """Meal slot a diary entry belongs to. Values map 1:1 to the Postgres enum."""

    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"


class DiaryEntry(Base):
    """A single logged food entry for a given date + meal.

    `nutriments_snapshot` freezes the nutrient values (scaled to `grams`) at
    log time, so later edits to the referenced Food don't rewrite history.
    `portion_label` similarly freezes the chosen portion's label (e.g. "1
    vasetto (125 g)") as a denormalized snapshot rather than a live FK, so it
    survives the source `FoodPortion` being edited/deleted later. `position`
    orders entries within a date+meal group.
    """

    __tablename__ = "diary_entries"
    __table_args__ = (sa.Index("ix_diary_entries_date", "date"),)

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    food_id: Mapped[int] = mapped_column(
        sa.ForeignKey("foods.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(sa.Date, nullable=False)
    meal: Mapped[Meal] = mapped_column(
        sa.Enum(
            Meal,
            name="meal",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    grams: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=1)
    portion_label: Mapped[str | None] = mapped_column(sa.String(100), nullable=True)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    nutriments_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)

    food: Mapped["Food"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"DiaryEntry(id={self.id!r}, date={self.date!r}, meal={self.meal!r})"
