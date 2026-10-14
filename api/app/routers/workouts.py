"""Workouts: the live session, finishing and history.

Thin layer over app/services/workouts.py; every live endpoint answers with
the full workout so the SPA can replace its cached copy.
"""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.user import User
from app.schemas.workout import (
    FinishIn,
    HistoryPage,
    LayoutIn,
    RestIn,
    SaveAsTemplateIn,
    SetPatch,
    TemplateOut,
    WorkoutExerciseAdd,
    WorkoutExercisePatch,
    WorkoutOut,
    WorkoutPutIn,
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


@router.get("", response_model=HistoryPage)
async def history(
    before: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> HistoryPage:
    return await workouts.list_history(session, user, before=before, limit=limit)


@router.post("", response_model=WorkoutOut, status_code=201)
async def start(
    payload: WorkoutStart,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.start_workout(session, user, payload)


@router.put("/{workout_uuid}", response_model=WorkoutOut)
async def put(
    workout_uuid: UUID,
    payload: WorkoutPutIn,
    response: Response,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    """Create (201) or replace (200) the whole workout, the offline client's save."""
    workout, created = await workouts.put_workout(session, user, workout_uuid, payload)
    response.status_code = 201 if created else 200
    return workout


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


@router.post("/{workout_id}/finish", response_model=WorkoutOut)
async def finish(
    workout_id: int,
    payload: FinishIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.finish_workout(session, user, workout_id, payload)


@router.delete("/{workout_id}", status_code=204)
async def delete(
    workout_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await workouts.delete_workout(session, user, workout_id)


@router.post("/{workout_id}/apply-to-template", response_model=TemplateOut)
async def apply_to_template(
    workout_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await workouts.apply_to_template(session, user, workout_id)


@router.post("/{workout_id}/save-as-template", response_model=TemplateOut, status_code=201)
async def save_as_template(
    workout_id: int,
    payload: SaveAsTemplateIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await workouts.save_as_template(session, user, workout_id, payload)
