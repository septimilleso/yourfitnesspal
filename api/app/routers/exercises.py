"""Exercise catalog + custom exercises. Thin layer over app/services/exercises.py."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.user import User
from app.schemas.exercise import (
    ExerciseCreate,
    ExerciseDetail,
    ExerciseList,
    ExercisePatch,
)
from app.services import exercises

router = APIRouter(prefix="/api/exercises", tags=["exercises"])


@router.get("", response_model=ExerciseList)
async def search(
    q: str = "",
    equipment: str | None = None,
    muscle: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ExerciseList:
    return await exercises.search_exercises(
        session, user, q=q, equipment=equipment, muscle=muscle, limit=limit, offset=offset
    )


@router.get("/{exercise_id}", response_model=ExerciseDetail)
async def get_one(
    exercise_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ExerciseDetail:
    return await exercises.get_exercise(session, user, exercise_id)


@router.post("", response_model=ExerciseDetail, status_code=201)
async def create(
    payload: ExerciseCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ExerciseDetail:
    return await exercises.create_custom_exercise(session, user, payload)


@router.patch("/{exercise_id}", response_model=ExerciseDetail)
async def update(
    exercise_id: int,
    payload: ExercisePatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ExerciseDetail:
    return await exercises.update_custom_exercise(session, user, exercise_id, payload)


@router.delete("/{exercise_id}", status_code=204)
async def archive(
    exercise_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await exercises.archive_custom_exercise(session, user, exercise_id)
