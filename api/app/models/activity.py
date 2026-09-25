from datetime import date

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UserActivityDay(Base):
    """One row per user per local day on which the web app was opened.

    Written by `POST /api/activity`; read to compute the "days in a row"
    streak. MCP calls never write here.
    """

    __tablename__ = "user_activity_days"

    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(sa.Date, primary_key=True)
