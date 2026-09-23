"""Food lookups shared by the REST routers and the MCP tools.

Search is deliberately cache-first: it queries the local `foods` table
first, and only calls out to OpenFoodFacts (via `OffClient.search`) when
local matches are sparse, upserting whatever comes back so subsequent
identical searches are served locally too.
"""

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.diary import DiaryEntry
from app.models.food import Food
from app.models.user import User
from app.permissions import Permission, effective_permissions, ensure_permission
from app.schemas.food import CustomFoodCreate, FoodSearchItem, FoodSearchResponse
from app.services import food_cache
from app.services.diary_ops import visible_food_filter
from app.services.errors import NotFound
from app.services.off_client import OffClient, normalize

# Below this many local matches, we also query OFF to fill in the gaps.
LOCAL_MATCH_THRESHOLD = 10


async def search_foods(
    db: AsyncSession, off_client: OffClient, user: User, q: str, limit: int
) -> FoodSearchResponse:
    # Usage frequency (times a food has been logged) ranks local matches;
    # foods never logged fall back to name-similarity ordering via pg_trgm.
    usage_subq = (
        sa.select(DiaryEntry.food_id.label("food_id"), sa.func.count().label("usage_count"))
        .where(DiaryEntry.user_id == user.id)
        .group_by(DiaryEntry.food_id)
        .subquery()
    )
    usage_count = sa.func.coalesce(usage_subq.c.usage_count, 0)
    pattern = f"%{q}%"
    # Query at least LOCAL_MATCH_THRESHOLD rows so the fallback decision below
    # reflects how many local matches actually exist, not just how many fit
    # within a small `limit`. The final response is trimmed to `limit` later.
    stmt = (
        sa.select(Food)
        .outerjoin(usage_subq, usage_subq.c.food_id == Food.id)
        .where(sa.or_(Food.name.ilike(pattern), Food.brand.ilike(pattern)), visible_food_filter(user))
        .order_by(usage_count.desc(), sa.func.similarity(Food.name, q).desc())
        .limit(max(limit, LOCAL_MATCH_THRESHOLD))
    )
    local_foods = (await db.execute(stmt)).scalars().all()

    results = [FoodSearchItem.from_food(food, source="cache") for food in local_foods]
    seen_ids = {food.id for food in local_foods}
    off_unavailable = False
    off_disabled = Permission.foods_off_lookup not in effective_permissions(user)

    if len(local_foods) < LOCAL_MATCH_THRESHOLD and not off_disabled:
        off_products = await off_client.search(q, limit=limit)
        if off_products is None:
            off_unavailable = True
        else:
            upserted_any = False
            for product in off_products:
                normalized = normalize(product)
                barcode = normalized.get("barcode") if normalized else None
                if normalized is None or not barcode:
                    continue
                food = await food_cache.upsert_normalized_food(db, barcode, normalized, product)
                upserted_any = True
                if food.id in seen_ids:
                    continue
                seen_ids.add(food.id)
                results.append(FoodSearchItem.from_food(food, source="off"))
            if upserted_any:
                await db.commit()

    return FoodSearchResponse(
        results=results[:limit], off_unavailable=off_unavailable, off_disabled=off_disabled
    )


async def recent_foods(db: AsyncSession, user: User, limit: int) -> FoodSearchResponse:
    """Distinct foods logged at least once, most-recently-logged first.

    Recency is the most recent `(date, id)` pair among a food's diary
    entries; `id` breaks ties within the same day.
    """
    last_used = (
        sa.select(
            DiaryEntry.food_id.label("food_id"),
            sa.func.max(DiaryEntry.date).label("last_date"),
            sa.func.max(DiaryEntry.id).label("last_id"),
        )
        .where(DiaryEntry.user_id == user.id)
        .group_by(DiaryEntry.food_id)
        .subquery()
    )
    stmt = (
        sa.select(Food)
        .join(last_used, last_used.c.food_id == Food.id)
        .where(visible_food_filter(user))
        .order_by(last_used.c.last_date.desc(), last_used.c.last_id.desc())
        .limit(limit)
    )
    found = (await db.execute(stmt)).scalars().all()
    return FoodSearchResponse(results=[FoodSearchItem.from_food(f, source="cache") for f in found])


async def get_by_barcode(db: AsyncSession, off_client: OffClient, user: User, code: str) -> Food:
    if Permission.foods_off_lookup not in effective_permissions(user):
        # Permissionless barcode lookups are strictly cache-only.
        food = await db.scalar(sa.select(Food).where(Food.barcode == code, visible_food_filter(user)))
    else:
        food = await food_cache.get_or_fetch_by_barcode(db, code, client=off_client)
    if food is None:
        raise NotFound("food not found")
    return food


async def create_custom_food(db: AsyncSession, user: User, payload: CustomFoodCreate) -> Food:
    ensure_permission(user, Permission.foods_custom_create)
    food = Food(
        owner_user_id=user.id, source="custom", name=payload.name, brand=payload.brand,
        image_url=payload.image_url, serving_size_g=payload.serving_size_g,
        nutriments=payload.nutriments.model_dump(), raw=None, fetched_at=None,
    )
    db.add(food)
    await db.commit()
    await db.refresh(food)
    return food
