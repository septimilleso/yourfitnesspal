from datetime import date

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Goal(Base):
    """Daily nutrition targets.

    This is a single-user app (see Task 2's APP_KEY auth), so there is no
    user_id column here. Goals are historized/append-only via `valid_from`:
    for a given date, the currently active goal is the row with the most
    recent `valid_from` that is `<=` that date.
    """

    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    kcal: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    protein_g: Mapped[float] = mapped_column(sa.Numeric(6, 2), nullable=False)
    carbs_g: Mapped[float] = mapped_column(sa.Numeric(6, 2), nullable=False)
    fat_g: Mapped[float] = mapped_column(sa.Numeric(6, 2), nullable=False)
    valid_from: Mapped[date] = mapped_column(sa.Date, nullable=False)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Goal(id={self.id!r}, kcal={self.kcal!r})"
