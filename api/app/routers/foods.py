"""Foods API: cache-first search, barcode lookup, and custom-food creation.

Search is deliberately cache-first: it queries the local `foods` table
first, and only calls out to OpenFoodFacts (via `OffClient.search`) when
local matches are sparse, upserting whatever comes back so subsequent
identical searches are served locally too. Barcode lookups delegate
entirely to `food_cache.get_or_fetch_by_barcode`, which already implements
this same cache-first/staleness logic for the single-barcode case.
"""

from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.diary import DiaryEntry
from app.models.food import Food
from app.schemas.food import CustomFoodCreate, FoodOut, FoodSearchItem, FoodSearchResponse
from app.services import food_cache
from app.services.off_client import OffClient, normalize

router = APIRouter(prefix="/api/foods", tags=["foods"])

# Below this many local matches, we also query OFF to fill in the gaps.
LOCAL_MATCH_THRESHOLD = 10


@router.get("/search", response_model=FoodSearchResponse)
async def search_foods(
    q: Annotated[str, Query(min_length=1)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    session: AsyncSession = Depends(get_session),
) -> FoodSearchResponse:
    # Usage frequency (times a food has been logged) ranks local matches;
    # foods never logged (no row in the subquery, hence the outer join +
    # coalesce) fall back to name-similarity ordering via pg_trgm.
    usage_subq = (
        sa.select(
            DiaryEntry.food_id.label("food_id"),
            sa.func.count().label("usage_count"),
        )
        .group_by(DiaryEntry.food_id)
        .subquery()
    )
    usage_count = sa.func.coalesce(usage_subq.c.usage_count, 0)
    pattern = f"%{q}%"

    stmt = (
        sa.select(Food)
        .outerjoin(usage_subq, usage_subq.c.food_id == Food.id)
        .where(sa.or_(Food.name.ilike(pattern), Food.brand.ilike(pattern)))
        .order_by(usage_count.desc(), sa.func.similarity(Food.name, q).desc())
        .limit(limit)
    )
    local_foods = (await session.execute(stmt)).scalars().all()

    results = [FoodSearchItem.from_food(food, source="cache") for food in local_foods]
    seen_ids = {food.id for food in local_foods}

    if len(local_foods) < LOCAL_MATCH_THRESHOLD:
        client = OffClient()
        try:
            off_products = await client.search(q, limit=limit)
        finally:
            await client.aclose()

        upserted_any = False
        for product in off_products:
            normalized = normalize(product)
            barcode = normalized.get("barcode") if normalized else None
            if normalized is None or not barcode:
                continue

            food = await food_cache.upsert_normalized_food(session, barcode, normalized, product)
            upserted_any = True

            if food.id in seen_ids:
                continue
            seen_ids.add(food.id)
            results.append(FoodSearchItem.from_food(food, source="off"))

        if upserted_any:
            await session.commit()

    return FoodSearchResponse(results=results[:limit])


@router.get("/barcode/{code}", response_model=FoodOut)
async def get_food_by_barcode(
    code: str,
    session: AsyncSession = Depends(get_session),
) -> Food:
    food = await food_cache.get_or_fetch_by_barcode(session, code)
    if food is None:
        raise HTTPException(status_code=404, detail="food not found")
    return food


@router.post("", response_model=FoodOut, status_code=201)
async def create_custom_food(
    payload: CustomFoodCreate,
    session: AsyncSession = Depends(get_session),
) -> Food:
    food = Food(
        source="custom",
        name=payload.name,
        brand=payload.brand,
        image_url=payload.image_url,
        serving_size_g=payload.serving_size_g,
        nutriments=payload.nutriments.model_dump(),
        raw=None,
        fetched_at=None,
    )
    session.add(food)
    await session.commit()
    await session.refresh(food)
    return food
