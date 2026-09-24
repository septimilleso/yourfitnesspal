"""Workouts: the live session, finishing and history.

Thin layer over app/services/workouts.py; every live endpoint answers with
the full workout so the SPA can replace its cached copy.
"""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.user import User
from app.schemas.workout import (
    LayoutIn,
    RestIn,
    SetPatch,
    WorkoutExerciseAdd,
    WorkoutExercisePatch,
    WorkoutOut,
    WorkoutRename,
    WorkoutStart,
)
from app.services import workouts

router = APIRouter(prefix="/api/workouts", tags=["workouts"])


@router.get("/active", response_model=WorkoutOut, responses={204: {"description": "None"}})
async def active(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    workout = await workouts.get_active(session, user)
    if workout is None:
        return Response(status_code=204)
    return workout


@router.post("", response_model=WorkoutOut, status_code=201)
async def start(
    payload: WorkoutStart,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.start_workout(session, user, payload)


@router.get("/{workout_id}", response_model=WorkoutOut)
async def get_one(
    workout_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.get_workout(session, user, workout_id)


@router.patch("/{workout_id}", response_model=WorkoutOut)
async def rename(
    workout_id: int,
    payload: WorkoutRename,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.rename_workout(session, user, workout_id, payload)


@router.post("/{workout_id}/exercises", response_model=WorkoutOut)
async def add_exercise(
    workout_id: int,
    payload: WorkoutExerciseAdd,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.add_exercise(session, user, workout_id, payload)


@router.patch("/{workout_id}/exercises/{item_id}", response_model=WorkoutOut)
async def patch_exercise(
    workout_id: int,
    item_id: int,
    payload: WorkoutExercisePatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.patch_exercise(session, user, workout_id, item_id, payload)


@router.delete("/{workout_id}/exercises/{item_id}", response_model=WorkoutOut)
async def remove_exercise(
    workout_id: int,
    item_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.remove_exercise(session, user, workout_id, item_id)


@router.put("/{workout_id}/layout", response_model=WorkoutOut)
async def set_layout(
    workout_id: int,
    payload: LayoutIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.set_layout(session, user, workout_id, payload)


@router.post("/{workout_id}/exercises/{item_id}/sets", response_model=WorkoutOut)
async def add_set(
    workout_id: int,
    item_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.add_set(session, user, workout_id, item_id)


@router.patch("/{workout_id}/sets/{set_id}", response_model=WorkoutOut)
async def patch_set(
    workout_id: int,
    set_id: int,
    payload: SetPatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.patch_set(session, user, workout_id, set_id, payload)


@router.delete("/{workout_id}/sets/{set_id}", response_model=WorkoutOut)
async def delete_set(
    workout_id: int,
    set_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.delete_set(session, user, workout_id, set_id)


@router.post("/{workout_id}/sets/{set_id}/complete", response_model=WorkoutOut)
async def complete_set(
    workout_id: int,
    set_id: int,
    payload: SetPatch | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.complete_set(session, user, workout_id, set_id, payload or SetPatch())


@router.post("/{workout_id}/sets/{set_id}/uncomplete", response_model=WorkoutOut)
async def uncomplete_set(
    workout_id: int,
    set_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.uncomplete_set(session, user, workout_id, set_id)


@router.post("/{workout_id}/rest", response_model=WorkoutOut)
async def rest(
    workout_id: int,
    payload: RestIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.rest(session, user, workout_id, payload)
