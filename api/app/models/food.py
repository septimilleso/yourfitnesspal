from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Food(Base):
    """A food item, sourced from Open Food Facts (by barcode) or entered manually.

    `source` is `"off"` for OFF-fetched foods or `"custom"` for manually
    entered ones. `nutriments` holds the normalized per-100g macro/micronutrient
    values used by the app (kcal, protein_g, carbs_g, sugars_g, fat_g, sat_fat_g,
    fiber_g, salt_g). `raw` retains the original OFF API payload
    for reference/debugging and is null for manually-entered foods. `fetched_at`
    records when the row was last fetched/refreshed from OFF (null for
    `source="custom"` foods).
    """

    __tablename__ = "foods"
    __table_args__ = (
        sa.CheckConstraint("source = 'custom' OR owner_user_id IS NULL", name="ck_foods_owner_only_custom"),
        sa.Index(
            "ix_foods_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
        sa.Index(
            "ix_foods_brand_trgm",
            "brand",
            postgresql_using="gin",
            postgresql_ops={"brand": "gin_trgm_ops"},
        ),
    )

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    owner_user_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    barcode: Mapped[str | None] = mapped_column(
        sa.String(64), unique=True, index=True, nullable=True
    )
    source: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    brand: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    image_url: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    serving_size_g: Mapped[float | None] = mapped_column(sa.Numeric(10, 2), nullable=True)
    nutriments: Mapped[dict] = mapped_column(JSONB, nullable=False)
    raw: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    fetched_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
        nullable=False,
    )

    portions: Mapped[list["FoodPortion"]] = relationship(
        back_populates="food", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Food(id={self.id!r}, name={self.name!r}, barcode={self.barcode!r})"


class FoodPortion(Base):
    """A named serving-size portion for a food (e.g. '1 slice' = 28g)."""

    __tablename__ = "food_portions"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    food_id: Mapped[int] = mapped_column(
        sa.ForeignKey("foods.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    grams: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False)
    is_default: Mapped[bool] = mapped_column(
        sa.Boolean, server_default=sa.false(), nullable=False, default=False
    )

    food: Mapped["Food"] = relationship(back_populates="portions")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"FoodPortion(id={self.id!r}, food_id={self.food_id!r}, label={self.label!r})"
