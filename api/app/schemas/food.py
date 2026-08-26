"""Pydantic response/request schemas for the foods endpoints."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.food import Food


class Nutriments(BaseModel):
    """The 8 per-100g nutriment fields `Food.nutriments` stores."""

    kcal: float
    protein_g: float
    carbs_g: float
    sugars_g: float
    fat_g: float
    sat_fat_g: float
    fiber_g: float
    salt_g: float


class FoodOut(BaseModel):
    """A single food row, as returned by the barcode-lookup and
    custom-food-creation endpoints.

    `source` here IS `Food.source` ("off" or "custom") -- for a single-food
    response there's no cache-vs-fresh ambiguity to represent, so it's safe
    to expose the DB column's value directly. Contrast with
    `FoodSearchItem.source` below.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    barcode: str | None
    source: Literal["off", "custom"]
    name: str
    brand: str | None
    image_url: str | None
    serving_size_g: float | None
    nutriments: Nutriments


class FoodSearchItem(BaseModel):
    """A single `GET /api/foods/search` result.

    `source` here is NOT `Food.source`. It's a request-scoped UI badge hint:
    `"cache"` if this item was served from the local `foods` table without a
    fresh OFF call during this request, `"off"` if it was just fetched from
    OFF and upserted during this request. It never overlaps with
    `Food.source` ("off"/"custom", the row's persisted origin, which never
    changes based on cache hits) -- that column is deliberately not exposed
    on this schema to avoid the two being confused.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    barcode: str | None
    name: str
    brand: str | None
    image_url: str | None
    serving_size_g: float | None
    nutriments: Nutriments
    source: Literal["cache", "off"]

    @classmethod
    def from_food(cls, food: Food, source: Literal["cache", "off"]) -> "FoodSearchItem":
        return cls(
            id=food.id,
            barcode=food.barcode,
            name=food.name,
            brand=food.brand,
            image_url=food.image_url,
            serving_size_g=food.serving_size_g,
            nutriments=food.nutriments,
            source=source,
        )


class FoodSearchResponse(BaseModel):
    results: list[FoodSearchItem]
    # True when local matches were sparse AND the OFF lookup that would have
    # filled them in failed/timed out (as opposed to OFF succeeding and
    # genuinely finding nothing) -- lets the frontend show "OpenFoodFacts
    # momentaneamente non raggiungibile" instead of implying zero matches.
    off_unavailable: bool = False


class CustomFoodCreate(BaseModel):
    """Body for `POST /api/foods`. All 8 nutriment fields are required, same
    as OFF-sourced foods -- there's no partial-nutriment representation."""

    name: str
    brand: str | None = None
    image_url: str | None = None
    serving_size_g: float | None = None
    nutriments: Nutriments
