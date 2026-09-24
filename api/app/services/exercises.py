"""Exercise catalog search and the user's custom exercises.

Shared by the REST router and the MCP tools. Catalog rows are visible to
everyone; custom rows only to their owner. Archived custom exercises are
hidden from search but still readable, because history and templates keep
referencing them.
"""

from collections.abc import Iterable
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.exercise import Exercise
from app.models.user import User
from app.permissions import Permission, ensure_permission
from app.schemas.exercise import (
    ExerciseCreate,
    ExerciseDetail,
    ExerciseList,
    ExerciseOut,
    ExercisePatch,
)
from app.services.errors import NotFound


def visible_exercise_filter(user: User) -> sa.ColumnElement[bool]:
    return sa.or_(Exercise.source == "catalog", Exercise.owner_user_id == user.id)


def exercise_out(exercise: Exercise) -> ExerciseOut:
    return ExerciseOut(
        id=exercise.id, name=exercise.name, equipment=exercise.equipment,
        primary_muscles=list(exercise.primary_muscles),
        secondary_muscles=list(exercise.secondary_muscles),
        category=exercise.category, tracking=exercise.tracking,
        custom=exercise.source == "custom",
    )


def _detail(exercise: Exercise) -> ExerciseDetail:
    return ExerciseDetail(
        **exercise_out(exercise).model_dump(), instructions=list(exercise.instructions)
    )


async def get_visible_exercises(
    db: AsyncSession, user: User, ids: Iterable[int]
) -> dict[int, Exercise]:
    ensure_permission(user, Permission.workouts)
    wanted = set(ids)
    if not wanted:
        return {}
    found = {
        exercise.id: exercise
        for exercise in (
            await db.scalars(
                sa.select(Exercise).where(Exercise.id.in_(wanted), visible_exercise_filter(user))
            )
        ).all()
    }
    if wanted - found.keys():
        raise NotFound("exercise not found")
    return found


async def search_exercises(
    db: AsyncSession,
    user: User,
    *,
    q: str = "",
    equipment: str | None = None,
    muscle: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> ExerciseList:
    ensure_permission(user, Permission.workouts)
    conditions = [visible_exercise_filter(user), Exercise.archived_at.is_(None)]
    q = q.strip()
    if q:
        conditions.append(Exercise.name.icontains(q, autoescape=True))
    if equipment:
        conditions.append(Exercise.equipment == equipment)
    if muscle:
        conditions.append(Exercise.primary_muscles.any(muscle))
    total = await db.scalar(sa.select(sa.func.count()).select_from(Exercise).where(*conditions))
    order = (
        [sa.func.similarity(Exercise.name, q).desc(), Exercise.name]
        if q
        else [sa.func.lower(Exercise.name)]
    )
    rows = (
        await db.scalars(
            sa.select(Exercise).where(*conditions).order_by(*order).limit(limit).offset(offset)
        )
    ).all()
    return ExerciseList(items=[exercise_out(e) for e in rows], total=total or 0)


async def get_exercise(db: AsyncSession, user: User, exercise_id: int) -> ExerciseDetail:
    ensure_permission(user, Permission.workouts)
    return _detail((await get_visible_exercises(db, user, [exercise_id]))[exercise_id])


async def _own_custom(db: AsyncSession, user: User, exercise_id: int) -> Exercise:
    exercise = await db.scalar(
        sa.select(Exercise).where(
            Exercise.id == exercise_id,
            Exercise.owner_user_id == user.id,
            Exercise.archived_at.is_(None),
        )
    )
    if exercise is None:
        raise NotFound("exercise not found")
    return exercise


async def create_custom_exercise(
    db: AsyncSession, user: User, payload: ExerciseCreate
) -> ExerciseDetail:
    ensure_permission(user, Permission.workouts)
    exercise = Exercise(
        source="custom", source_id=None, owner_user_id=user.id, name=payload.name,
        equipment=payload.equipment,
        primary_muscles=[payload.primary_muscle] if payload.primary_muscle else [],
        secondary_muscles=[], category=None, instructions=[], tracking=payload.tracking,
    )
    db.add(exercise)
    await db.commit()
    return _detail(exercise)


async def update_custom_exercise(
    db: AsyncSession, user: User, exercise_id: int, payload: ExercisePatch
) -> ExerciseDetail:
    ensure_permission(user, Permission.workouts)
    exercise = await _own_custom(db, user, exercise_id)
    fields = payload.model_fields_set
    if "name" in fields and payload.name is not None:
        exercise.name = payload.name
    if "equipment" in fields:
        exercise.equipment = payload.equipment
    if "primary_muscle" in fields:
        exercise.primary_muscles = [payload.primary_muscle] if payload.primary_muscle else []
    if "tracking" in fields and payload.tracking is not None:
        exercise.tracking = payload.tracking
    await db.commit()
    return _detail(exercise)


async def archive_custom_exercise(db: AsyncSession, user: User, exercise_id: int) -> None:
    ensure_permission(user, Permission.workouts)
    exercise = await _own_custom(db, user, exercise_id)
    exercise.archived_at = datetime.now(UTC)
    await db.commit()
