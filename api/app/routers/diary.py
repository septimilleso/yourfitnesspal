"""Diary API: entry CRUD, day/week totals, and goals.

`nutriments_snapshot` on a `DiaryEntry` is the food's FULL per-100g
nutriment dict, copied verbatim (unscaled) at entry-creation time -- NOT
pre-scaled by `grams`. Scaling by `grams/100` happens at read time, in
`app/services/diary.py`'s `compute_day_totals`/`compute_week_totals`. This
matters because a later PATCH to `grams` must change computed totals
without rewriting the stored snapshot, and a later copy of the snapshot
(e.g. duplicating an entry) must carry the same unscaled per-100g values
regardless of the source entry's `grams`.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.diary import DiaryEntry, Meal
from app.models.food import Food
from app.models.goal import Goal
from app.schemas.diary import (
    DayResponse,
    DayTotals,
    DiaryEntryCreate,
    DiaryEntryOut,
    DiaryEntryPatch,
    GoalCreate,
    GoalDelta,
    GoalOut,
    WeekDayTotal,
    WeekResponse,
)
from app.services.diary import compute_day_totals, zero_totals

diary_router = APIRouter(prefix="/api/diary", tags=["diary"])
goals_router = APIRouter(prefix="/api/goals", tags=["goals"])


async def _active_goal(session: AsyncSession, for_date: date) -> Goal | None:
    """The `Goal` row with the largest `valid_from` that is `<= for_date`
    (goals are append-only/historized, see `app/models/goal.py`)."""
    stmt = (
        sa.select(Goal)
        .where(Goal.valid_from <= for_date)
        .order_by(Goal.valid_from.desc())
        .limit(1)
    )
    return await session.scalar(stmt)


def _goal_delta(goal: Goal | None, day_total: dict) -> GoalDelta | None:
    if goal is None:
        return None
    return GoalDelta(
        kcal=float(goal.kcal) - day_total["kcal"],
        protein_g=float(goal.protein_g) - day_total["protein_g"],
        carbs_g=float(goal.carbs_g) - day_total["carbs_g"],
        fat_g=float(goal.fat_g) - day_total["fat_g"],
    )


@diary_router.get("/day/{for_date}", response_model=DayResponse)
async def get_day(
    for_date: date,
    session: AsyncSession = Depends(get_session),
) -> DayResponse:
    stmt = (
        sa.select(DiaryEntry)
        .where(DiaryEntry.date == for_date)
        .order_by(DiaryEntry.meal, DiaryEntry.position)
    )
    entries = (await session.execute(stmt)).scalars().all()

    totals = compute_day_totals(entries)

    entries_by_meal: dict[str, list[DiaryEntry]] = {meal.value: [] for meal in Meal}
    for entry in entries:
        entries_by_meal[entry.meal.value].append(entry)

    by_meal_totals = {
        meal.value: totals["by_meal"].get(meal.value, zero_totals()) for meal in Meal
    }

    goal = await _active_goal(session, for_date)

    return DayResponse(
        date=for_date,
        entries={
            meal_key: [DiaryEntryOut.model_validate(e) for e in meal_entries]
            for meal_key, meal_entries in entries_by_meal.items()
        },
        totals=DayTotals(by_meal=by_meal_totals, total=totals["total"]),
        goal=GoalOut.model_validate(goal) if goal is not None else None,
        delta=_goal_delta(goal, totals["total"]),
    )


@diary_router.get("/week", response_model=WeekResponse)
async def get_week(
    start: Annotated[date, Query()],
    session: AsyncSession = Depends(get_session),
) -> WeekResponse:
    end = start + timedelta(days=6)
    stmt = (
        sa.select(DiaryEntry)
        .where(DiaryEntry.date >= start, DiaryEntry.date <= end)
        .order_by(DiaryEntry.date)
    )
    entries = (await session.execute(stmt)).scalars().all()

    entries_by_date: dict[date, list[DiaryEntry]] = {
        start + timedelta(days=i): [] for i in range(7)
    }
    for entry in entries:
        entries_by_date[entry.date].append(entry)

    days = [
        WeekDayTotal(date=day, total=compute_day_totals(day_entries)["total"])
        for day, day_entries in sorted(entries_by_date.items())
    ]

    return WeekResponse(start=start, end=end, days=days)


@diary_router.post("/entries", response_model=DiaryEntryOut, status_code=201)
async def create_entry(
    payload: DiaryEntryCreate,
    session: AsyncSession = Depends(get_session),
) -> DiaryEntry:
    food = await session.get(Food, payload.food_id)
    if food is None:
        raise HTTPException(status_code=404, detail="food not found")

    max_position = await session.scalar(
        sa.select(sa.func.max(DiaryEntry.position)).where(
            DiaryEntry.date == payload.date, DiaryEntry.meal == payload.meal
        )
    )
    position = 0 if max_position is None else max_position + 1

    entry = DiaryEntry(
        food_id=food.id,
        date=payload.date,
        meal=payload.meal,
        grams=payload.grams,
        portion_label=None,
        position=position,
        # Full per-100g dict, copied verbatim -- NOT scaled by grams. See
        # module docstring.
        nutriments_snapshot=dict(food.nutriments),
    )
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return entry


@diary_router.patch("/entries/{entry_id}", response_model=DiaryEntryOut)
async def patch_entry(
    entry_id: int,
    payload: DiaryEntryPatch,
    session: AsyncSession = Depends(get_session),
) -> DiaryEntry:
    entry = await session.get(DiaryEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="entry not found")

    if payload.grams is not None:
        entry.grams = payload.grams

    if payload.meal is not None and payload.meal != entry.meal:
        max_position = await session.scalar(
            sa.select(sa.func.max(DiaryEntry.position)).where(
                DiaryEntry.date == entry.date, DiaryEntry.meal == payload.meal
            )
        )
        entry.position = 0 if max_position is None else max_position + 1
        entry.meal = payload.meal

    await session.commit()
    await session.refresh(entry)
    return entry


@diary_router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: int,
    session: AsyncSession = Depends(get_session),
) -> None:
    entry = await session.get(DiaryEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="entry not found")
    await session.delete(entry)
    await session.commit()


@goals_router.get("", response_model=GoalOut)
async def get_goal(
    for_date: Annotated[date | None, Query(alias="date")] = None,
    session: AsyncSession = Depends(get_session),
) -> Goal:
    goal = await _active_goal(session, for_date or datetime.now(UTC).date())
    if goal is None:
        raise HTTPException(status_code=404, detail="no goal set")
    return goal


@goals_router.put("", response_model=GoalOut, status_code=201)
async def put_goal(
    payload: GoalCreate,
    session: AsyncSession = Depends(get_session),
) -> Goal:
    goal = Goal(
        kcal=payload.kcal,
        protein_g=payload.protein_g,
        carbs_g=payload.carbs_g,
        fat_g=payload.fat_g,
        valid_from=datetime.now(UTC).date(),
    )
    session.add(goal)
    await session.commit()
    await session.refresh(goal)
    return goal
