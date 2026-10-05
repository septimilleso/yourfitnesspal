"""DB-backed diary operations shared by the REST routers and the MCP tools.

`nutriments_snapshot` on a `DiaryEntry` is the food's FULL per-100g
nutriment dict, copied verbatim (unscaled) at entry-creation time -- NOT
pre-scaled by `grams`. Scaling by `grams/100` happens at read time, in
`app/services/diary.py`'s `compute_day_totals`/`compute_week_totals`. This
matters because a later PATCH to `grams` must change computed totals
without rewriting the stored snapshot, and a later copy of the snapshot
must carry the same unscaled per-100g values regardless of `grams`.
"""

from datetime import date, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.diary import DiaryEntry, Meal
from app.models.food import Food
from app.models.user import User
from app.permissions import Permission, ensure_permission
from app.schemas.diary import (
    DayResponse,
    DayTotals,
    DiaryCopyDayResult,
    DiaryCopyRequest,
    DiaryCopyResponse,
    DiaryEntryCreate,
    DiaryEntryOut,
    DiaryEntryPatch,
    GoalOut,
    WeekDayTotal,
    WeekResponse,
)
from app.services.diary import compute_day_totals, plan_copy, zero_totals
from app.services.errors import Invalid, NotFound
from app.services.goals import active_goal, goal_delta


def visible_food_filter(user: User) -> sa.ColumnElement[bool]:
    """Shared (OFF) foods plus the user's own custom foods."""
    return sa.or_(Food.source != "custom", Food.owner_user_id == user.id)


def entry_out(entry: DiaryEntry, food: Food | None = None) -> DiaryEntryOut:
    """Build a `DiaryEntryOut` from a row plus its `Food` (for name/brand).

    Callers either eager-load `DiaryEntry.food` and leave `food` unset, or
    pass the already-fetched `Food` explicitly.
    """
    f = food if food is not None else entry.food
    return DiaryEntryOut(
        id=entry.id, food_id=entry.food_id, food_name=f.name, food_brand=f.brand,
        date=entry.date, meal=entry.meal, grams=entry.grams,
        portion_label=entry.portion_label, position=entry.position,
        nutriments_snapshot=entry.nutriments_snapshot,
    )


async def _next_position(db: AsyncSession, user: User, for_date: date, meal: Meal) -> int:
    # Autoflush makes entries added earlier in the same transaction count too.
    max_position = await db.scalar(
        sa.select(sa.func.max(DiaryEntry.position)).where(
            DiaryEntry.user_id == user.id, DiaryEntry.date == for_date, DiaryEntry.meal == meal
        )
    )
    return 0 if max_position is None else max_position + 1


async def _own_entry(db: AsyncSession, user: User, entry_id: int) -> DiaryEntry:
    entry = await db.scalar(
        sa.select(DiaryEntry).where(DiaryEntry.id == entry_id, DiaryEntry.user_id == user.id)
    )
    if entry is None:
        raise NotFound("entry not found")
    return entry


async def get_day(db: AsyncSession, user: User, for_date: date) -> DayResponse:
    stmt = (
        sa.select(DiaryEntry)
        .where(DiaryEntry.user_id == user.id, DiaryEntry.date == for_date)
        .options(selectinload(DiaryEntry.food))
        .order_by(DiaryEntry.meal, DiaryEntry.position)
    )
    entries = (await db.execute(stmt)).scalars().all()
    totals = compute_day_totals(entries)

    entries_by_meal: dict[str, list[DiaryEntry]] = {meal.value: [] for meal in Meal}
    for entry in entries:
        entries_by_meal[entry.meal.value].append(entry)
    by_meal_totals = {
        meal.value: totals["by_meal"].get(meal.value, zero_totals()) for meal in Meal
    }
    goal = await active_goal(db, user.id, for_date)
    return DayResponse(
        date=for_date,
        entries={
            meal_key: [entry_out(e) for e in meal_entries]
            for meal_key, meal_entries in entries_by_meal.items()
        },
        totals=DayTotals(by_meal=by_meal_totals, total=totals["total"]),
        goal=GoalOut.model_validate(goal) if goal is not None else None,
        delta=goal_delta(goal, totals["total"]),
    )


MAX_RANGE_DAYS = 366


async def get_range(db: AsyncSession, user: User, start: date, end: date) -> WeekResponse:
    """Per-day totals for every day in `start..end` (inclusive), empty days
    included with zero totals."""
    if end < start:
        raise Invalid("end must not be before start")
    length = (end - start).days + 1
    if length > MAX_RANGE_DAYS:
        raise Invalid(f"range must not exceed {MAX_RANGE_DAYS} days")
    stmt = (
        sa.select(DiaryEntry)
        .where(DiaryEntry.user_id == user.id, DiaryEntry.date >= start, DiaryEntry.date <= end)
        .order_by(DiaryEntry.date)
    )
    entries = (await db.execute(stmt)).scalars().all()
    entries_by_date: dict[date, list[DiaryEntry]] = {
        start + timedelta(days=i): [] for i in range(length)
    }
    for entry in entries:
        entries_by_date[entry.date].append(entry)
    days = [
        WeekDayTotal(date=day, total=compute_day_totals(day_entries)["total"])
        for day, day_entries in sorted(entries_by_date.items())
    ]
    return WeekResponse(start=start, end=end, days=days)


async def get_week(db: AsyncSession, user: User, start: date) -> WeekResponse:
    return await get_range(db, user, start, start + timedelta(days=6))


async def create_entries(
    db: AsyncSession, user: User, payloads: list[DiaryEntryCreate]
) -> list[DiaryEntryOut]:
    """Log several entries in one transaction: all foods are resolved before
    anything is added, so an unknown food leaves the diary untouched."""
    food_ids = {p.food_id for p in payloads}
    foods = {
        food.id: food
        for food in (
            await db.scalars(sa.select(Food).where(Food.id.in_(food_ids), visible_food_filter(user)))
        ).all()
    }
    if food_ids - foods.keys():
        raise NotFound("food not found")

    created: list[tuple[DiaryEntry, Food]] = []
    for payload in payloads:
        food = foods[payload.food_id]
        entry = DiaryEntry(
            user_id=user.id, food_id=food.id, date=payload.date, meal=payload.meal,
            grams=payload.grams, portion_label=None,
            position=await _next_position(db, user, payload.date, payload.meal),
            # Full per-100g dict, copied verbatim -- NOT scaled by grams.
            nutriments_snapshot=dict(food.nutriments),
        )
        db.add(entry)
        created.append((entry, food))
    await db.commit()
    for entry, _ in created:
        await db.refresh(entry)
    return [entry_out(entry, food=food) for entry, food in created]


async def create_entry(db: AsyncSession, user: User, payload: DiaryEntryCreate) -> DiaryEntryOut:
    return (await create_entries(db, user, [payload]))[0]


async def update_entry(
    db: AsyncSession, user: User, entry_id: int, payload: DiaryEntryPatch
) -> DiaryEntryOut:
    entry = await _own_entry(db, user, entry_id)
    if payload.grams is not None:
        entry.grams = payload.grams
    if payload.meal is not None and payload.meal != entry.meal:
        entry.position = await _next_position(db, user, entry.date, payload.meal)
        entry.meal = payload.meal
    await db.commit()
    await db.refresh(entry)
    food = await db.get(Food, entry.food_id)
    assert food is not None  # FK is RESTRICT -- the food can't have been deleted
    return entry_out(entry, food=food)


async def delete_entry(db: AsyncSession, user: User, entry_id: int) -> None:
    entry = await _own_entry(db, user, entry_id)
    await db.delete(entry)
    await db.commit()


async def apply_copy_plan(
    db: AsyncSession, user: User, plan: dict
) -> DiaryCopyResponse:
    # Deletes first (only relevant in "replace" mode), all inserts after --
    # never interleaved per-day, which is what makes overlapping
    # source/target ranges correct.
    for target_date, meal_set in plan["deletes"]:
        await db.execute(
            sa.delete(DiaryEntry).where(
                DiaryEntry.user_id == user.id, DiaryEntry.date == target_date,
                DiaryEntry.meal.in_(meal_set),
            )
        )

    next_position: dict[tuple[date, Meal], int] = {}
    for item in plan["inserts"]:
        key = (item["date"], item["meal"])
        if key not in next_position:
            next_position[key] = await _next_position(db, user, key[0], key[1])
        position = next_position[key]
        next_position[key] += 1
        db.add(
            DiaryEntry(
                user_id=user.id, food_id=item["food_id"], date=item["date"], meal=item["meal"],
                grams=item["grams"], portion_label=item["portion_label"], position=position,
                nutriments_snapshot=item["nutriments_snapshot"],
            )
        )
    await db.commit()
    return DiaryCopyResponse(
        entries_created=len(plan["inserts"]),
        days=[DiaryCopyDayResult(**day) for day in plan["days"]],
    )


async def copy_days(db: AsyncSession, user: User, payload: DiaryCopyRequest) -> DiaryCopyResponse:
    ensure_permission(user, Permission.diary_copy)
    if not payload.source_dates:
        raise Invalid("source_dates must be non-empty")

    # Read ALL source entries into memory *before* any deletes -- required
    # so that `mode == "replace"` on a target date that's also a source
    # date (overlap) works correctly. See `plan_copy`'s docstring.
    distinct_source_dates = set(payload.source_dates)
    stmt = (
        sa.select(DiaryEntry)
        .where(DiaryEntry.user_id == user.id, DiaryEntry.date.in_(distinct_source_dates))
        .order_by(DiaryEntry.date, DiaryEntry.meal, DiaryEntry.position)
    )
    source_entries = (await db.execute(stmt)).scalars().all()
    entries_by_source_date: dict[date, list[DiaryEntry]] = {d: [] for d in distinct_source_dates}
    for entry in source_entries:
        entries_by_source_date[entry.date].append(entry)

    plan = plan_copy(
        source_dates=payload.source_dates, target_start=payload.target_start,
        meals=payload.meals, mode=payload.mode, entries_by_source_date=entries_by_source_date,
    )
    return await apply_copy_plan(db, user, plan)
