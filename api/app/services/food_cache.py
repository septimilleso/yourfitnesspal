"""Barcode-keyed cache in front of OpenFoodFacts: look foods up locally
first, and only hit OFF (via `OffClient`) on a cache miss or when the
cached copy is stale.
"""

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.food import Food, FoodPortion
from app.services.off_client import OffClient, normalize

STALE_AFTER = timedelta(days=90)
DEFAULT_PORTION_NAME = "100 g"
DEFAULT_PORTION_GRAMS = 100


async def get_or_fetch_by_barcode(
    session: AsyncSession,
    barcode: str,
    client: OffClient | None = None,
) -> Food | None:
    """Return the `Food` row for `barcode`, fetching/refreshing it from
    OpenFoodFacts as needed.

    - Cache hit, fresh (fetched within the last 90 days): returned as-is,
      no network call.
    - Cache miss, or cache hit but stale: calls `OffClient.get_product`,
      normalizes the result, and upserts it into `foods` (creating a
      default "100 g" `food_portions` row for new foods).
    - If OFF has nothing for the barcode (404, or a payload `normalize`
      can't use), falls back to the stale cached row if one exists,
      otherwise returns None.
    """
    existing = await session.scalar(sa.select(Food).where(Food.barcode == barcode))
    if existing is not None and _is_fresh(existing):
        return existing

    owns_client = client is None
    off_client = client or OffClient()
    try:
        off_product = await off_client.get_product(barcode)
    finally:
        if owns_client:
            await off_client.aclose()

    if off_product is None:
        return existing

    normalized = normalize(off_product)
    if normalized is None:
        return existing

    if existing is not None:
        existing.name = normalized["name"]
        existing.brand = normalized["brand"]
        existing.nutriments = normalized["nutriments"]
        existing.raw = off_product
        food = existing
    else:
        food = Food(
            barcode=barcode,
            name=normalized["name"],
            brand=normalized["brand"],
            nutriments=normalized["nutriments"],
            raw=off_product,
        )
        session.add(food)
        await session.flush()  # assign food.id before creating the portion
        session.add(
            FoodPortion(
                food_id=food.id,
                name=DEFAULT_PORTION_NAME,
                grams=DEFAULT_PORTION_GRAMS,
            )
        )

    await session.commit()
    return food


def _is_fresh(food: Food) -> bool:
    """A cached food is fresh if it was created within the last 90 days.

    `Food` has no dedicated `fetched_at`/`updated_at` column (see Task 3's
    model), so `created_at` is used as a `fetched_at` proxy. Note this is
    imperfect: `created_at` is a Postgres `server_default=now()` set once
    at INSERT and is not bumped when an existing stale row is
    refreshed above, so a food will be re-fetched from OFF on every call
    once it passes the 90-day mark, even immediately after a successful
    refresh. Fixing this properly needs an `updated_at`/`fetched_at`
    column on `Food`, which is out of this task's scope (model changes
    belong to Task 3)."""
    fetched_at = food.created_at
    if fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=UTC)
    return datetime.now(UTC) - fetched_at < STALE_AFTER
