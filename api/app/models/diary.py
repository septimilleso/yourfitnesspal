import enum
from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.food import Food, FoodPortion


class Meal(str, enum.Enum):
    """Meal slot a diary entry belongs to. Values map 1:1 to the Postgres enum."""

    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"


class DiaryEntry(Base):
    """A single logged food entry for a given date + meal.

    `nutriments_snapshot` freezes the nutrient values (scaled to `quantity`)
    at log time, so later edits to the referenced Food don't rewrite history.
    """

    __tablename__ = "diary_entries"
    __table_args__ = (sa.Index("ix_diary_entries_date", "date"),)

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    food_id: Mapped[int] = mapped_column(
        sa.ForeignKey("foods.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    portion_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("food_portions.id", ondelete="SET NULL"), nullable=True
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
    quantity: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=1)
    nutriments_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )

    food: Mapped["Food"] = relationship()
    portion: Mapped["FoodPortion | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"DiaryEntry(id={self.id!r}, date={self.date!r}, meal={self.meal!r})"
