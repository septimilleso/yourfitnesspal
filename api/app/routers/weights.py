from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.user import User
from app.schemas.weight import WeightHistoryOut, WeightIn, WeightOut
from app.services import weights

router = APIRouter(prefix="/api/weights", tags=["weights"])


@router.get("/today", response_model=WeightOut, responses={204: {"description": "No weight logged today"}})
async def read_today(
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WeightOut | Response:
    weight = await weights.get_today(db, user)
    if weight is None:
        return Response(status_code=204)
    return weight


@router.put("/today", response_model=WeightOut)
async def save_today(
    payload: WeightIn,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WeightOut:
    return await weights.log_today(db, user, payload.weight_kg)


@router.get("", response_model=WeightHistoryOut)
async def read_history(
    start: date = Query(...),
    end: date = Query(...),
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WeightHistoryOut:
    return await weights.weight_history(db, user, start, end)


@router.delete("/{weight_id}", status_code=204)
async def remove_weight(
    weight_id: int,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    await weights.delete_weight(db, user, weight_id)
    return Response(status_code=204)
