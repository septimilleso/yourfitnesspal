from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.food import Food, FoodPortion


class MealTemplate(Base):
    """A reusable named group of foods (e.g. 'usual breakfast')."""

    __tablename__ = "meal_templates"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )

    items: Mapped[list["MealTemplateItem"]] = relationship(
        back_populates="meal_template", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"MealTemplate(id={self.id!r}, name={self.name!r})"


class MealTemplateItem(Base):
    """A single food line item within a meal template."""

    __tablename__ = "meal_template_items"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    meal_template_id: Mapped[int] = mapped_column(
        sa.ForeignKey("meal_templates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    food_id: Mapped[int] = mapped_column(
        sa.ForeignKey("foods.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    portion_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("food_portions.id", ondelete="SET NULL"), nullable=True
    )
    quantity: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=1)

    meal_template: Mapped["MealTemplate"] = relationship(back_populates="items")
    food: Mapped["Food"] = relationship()
    portion: Mapped["FoodPortion | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"MealTemplateItem(id={self.id!r}, meal_template_id={self.meal_template_id!r}, "
            f"food_id={self.food_id!r})"
        )
