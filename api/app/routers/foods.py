"""Foods API: cache-first search, recent foods, barcode lookup, custom foods.

Thin HTTP layer over `app/services/foods.py` (shared with the MCP tools).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_permission
from app.db import get_session
from app.models.food import Food
from app.models.user import User
from app.permissions import Permission
from app.schemas.food import CustomFoodCreate, FoodOut, FoodSearchResponse
from app.services import foods
from app.services.off_client import OffClient, get_off_client

router = APIRouter(prefix="/api/foods", tags=["foods"])


@router.get("/search", response_model=FoodSearchResponse)
async def search_foods(
    q: Annotated[str, Query(min_length=1)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    session: AsyncSession = Depends(get_session),
    off_client: OffClient = Depends(get_off_client),
    user: User = Depends(get_current_user),
) -> FoodSearchResponse:
    return await foods.search_foods(session, off_client, user, q, limit)


@router.get("/recent", response_model=FoodSearchResponse)
async def recent_foods(
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FoodSearchResponse:
    return await foods.recent_foods(session, user, limit)


@router.get("/barcode/{code}", response_model=FoodOut)
async def get_food_by_barcode(
    code: str,
    session: AsyncSession = Depends(get_session),
    off_client: OffClient = Depends(get_off_client),
    user: User = Depends(get_current_user),
) -> Food:
    return await foods.get_by_barcode(session, off_client, user, code)


@router.post("", response_model=FoodOut, status_code=201)
async def create_custom_food(
    payload: CustomFoodCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission(Permission.foods_custom_create)),
) -> Food:
    return await foods.create_custom_food(session, user, payload)
