"""Goal lookups and updates shared by the REST routers and the MCP tools.

Goals are append-only/historized via `valid_from` (see `app/models/goal.py`).
"""

from collections.abc import Mapping
from datetime import date

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.goal import Goal
from app.models.user import User
from app.permissions import Permission, ensure_permission
from app.schemas.diary import GoalCreate, GoalDelta


async def active_goal(db: AsyncSession, user_id: int, for_date: date) -> Goal | None:
    """The `Goal` row with the largest `valid_from` that is `<= for_date`.

    Ties on `valid_from` (a goal set twice in one day) are broken by
    `id DESC` so the most recently created row deterministically wins.
    """
    stmt = (
        sa.select(Goal)
        .where(Goal.user_id == user_id, Goal.valid_from <= for_date)
        .order_by(Goal.valid_from.desc(), Goal.id.desc())
        .limit(1)
    )
    return await db.scalar(stmt)


def goal_delta(goal: Goal | None, day_total: Mapping[str, float]) -> GoalDelta | None:
    if goal is None:
        return None
    return GoalDelta(
        kcal=float(goal.kcal) - day_total["kcal"],
        protein_g=float(goal.protein_g) - day_total["protein_g"],
        carbs_g=float(goal.carbs_g) - day_total["carbs_g"],
        fat_g=float(goal.fat_g) - day_total["fat_g"],
    )


async def set_goal(db: AsyncSession, user: User, payload: GoalCreate, valid_from: date) -> Goal:
    ensure_permission(user, Permission.goals_edit)
    goal = Goal(
        user_id=user.id, kcal=payload.kcal, protein_g=payload.protein_g,
        carbs_g=payload.carbs_g, fat_g=payload.fat_g, valid_from=valid_from,
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return goal
