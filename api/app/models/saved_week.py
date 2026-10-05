from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.diary import Meal
from app.models.food import Food


class SavedWeek(Base):
    __tablename__ = "saved_weeks"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )
    items: Mapped[list["SavedWeekItem"]] = relationship(
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="SavedWeekItem.day_index, SavedWeekItem.meal, SavedWeekItem.position",
    )


class SavedWeekItem(Base):
    __tablename__ = "saved_week_items"
    __table_args__ = (
        sa.CheckConstraint("day_index BETWEEN 0 AND 6", name="ck_saved_week_items_day_index"),
    )

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    saved_week_id: Mapped[int] = mapped_column(
        sa.ForeignKey("saved_weeks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day_index: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    meal: Mapped[Meal] = mapped_column(
        sa.Enum(
            Meal,
            name="meal",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    food_id: Mapped[int] = mapped_column(
        sa.ForeignKey("foods.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    grams: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False)
    portion_label: Mapped[str | None] = mapped_column(sa.String(100), nullable=True)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)

    food: Mapped[Food] = relationship()
