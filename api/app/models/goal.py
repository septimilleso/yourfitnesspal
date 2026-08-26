from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Goal(Base):
    """Daily nutrition targets.

    This is a single-user app (see Task 2's APP_KEY auth), so there is no
    user_id column here -- the row with the most recent `created_at` is the
    currently active goal.
    """

    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    calories: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    protein_g: Mapped[float] = mapped_column(sa.Numeric(6, 2), nullable=False)
    carbs_g: Mapped[float] = mapped_column(sa.Numeric(6, 2), nullable=False)
    fat_g: Mapped[float] = mapped_column(sa.Numeric(6, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Goal(id={self.id!r}, calories={self.calories!r})"
