"""Diary API: entry CRUD, day/week/range totals, and goals.

Thin HTTP layer over `app/services/diary_ops.py` and `app/services/goals.py`
(shared with the MCP tools). Domain errors raised there are mapped to HTTP
responses by the exception handlers in `app/main.py`.
"""

from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_permission
from app.db import get_session
from app.models.goal import Goal
from app.models.user import User
from app.permissions import Permission
from app.schemas.diary import (
    DayResponse,
    DiaryCopyRequest,
    DiaryCopyResponse,
    DiaryEntryCreate,
    DiaryEntryOut,
    DiaryEntryPatch,
    GoalCreate,
    GoalOut,
    WeekResponse,
)
from app.services import diary_ops, goals

diary_router = APIRouter(prefix="/api/diary", tags=["diary"])
goals_router = APIRouter(prefix="/api/goals", tags=["goals"])


@diary_router.get("/day/{for_date}", response_model=DayResponse)
async def get_day(
    for_date: date,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> DayResponse:
    return await diary_ops.get_day(session, user, for_date)


@diary_router.get("/week", response_model=WeekResponse)
async def get_week(
    start: Annotated[date, Query()],
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WeekResponse:
    return await diary_ops.get_week(session, user, start)


@diary_router.get("/range", response_model=WeekResponse)
async def get_range(
    start: Annotated[date, Query()],
    end: Annotated[date, Query()],
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WeekResponse:
    return await diary_ops.get_range(session, user, start, end)


@diary_router.post("/entries", response_model=DiaryEntryOut, status_code=201)
async def create_entry(
    payload: DiaryEntryCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> DiaryEntryOut:
    return await diary_ops.create_entry(session, user, payload)


@diary_router.patch("/entries/{entry_id}", response_model=DiaryEntryOut)
async def patch_entry(
    entry_id: int,
    payload: DiaryEntryPatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> DiaryEntryOut:
    return await diary_ops.update_entry(session, user, entry_id, payload)


@diary_router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await diary_ops.delete_entry(session, user, entry_id)


@diary_router.post("/copy", response_model=DiaryCopyResponse)
async def copy_days(
    payload: DiaryCopyRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission(Permission.diary_copy)),
) -> DiaryCopyResponse:
    return await diary_ops.copy_days(session, user, payload)


@goals_router.get("", response_model=GoalOut)
async def get_goal(
    for_date: Annotated[date | None, Query(alias="date")] = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Goal:
    goal = await goals.active_goal(session, user.id, for_date or datetime.now(UTC).date())
    if goal is None:
        raise HTTPException(status_code=404, detail="no goal set")
    return goal


@goals_router.put("", response_model=GoalOut, status_code=201)
async def put_goal(
    payload: GoalCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission(Permission.goals_edit)),
) -> Goal:
    return await goals.set_goal(session, user, payload, datetime.now(UTC).date())
