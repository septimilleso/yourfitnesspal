"""Pydantic request/response schemas for the diary + goals endpoints."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.diary import Meal
from app.schemas.food import Nutriments


class DiaryEntryCreate(BaseModel):
    """Body for `POST /api/diary/entries`."""

    date: date
    meal: Meal
    food_id: int
    grams: float


class DiaryEntryPatch(BaseModel):
    """Body for `PATCH /api/diary/entries/{id}`. Both fields optional --
    only the ones supplied are updated."""

    grams: float | None = None
    meal: Meal | None = None


class DiaryEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    food_id: int
    date: date
    meal: Meal
    grams: float
    portion_label: str | None
    position: int
    nutriments_snapshot: dict


class DayTotals(BaseModel):
    by_meal: dict[str, Nutriments]
    total: Nutriments


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kcal: int
    protein_g: float
    carbs_g: float
    fat_g: float
    valid_from: date


class GoalDelta(BaseModel):
    """`goal - day_total` for the 4 fields `Goal` tracks. Positive means
    under goal (room left), negative means over."""

    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


class DayResponse(BaseModel):
    date: date
    entries: dict[str, list[DiaryEntryOut]]
    totals: DayTotals
    goal: GoalOut | None
    delta: GoalDelta | None


class WeekDayTotal(BaseModel):
    date: date
    total: Nutriments


class WeekResponse(BaseModel):
    start: date
    end: date
    days: list[WeekDayTotal]


class DiaryCopyRequest(BaseModel):
    """Body for `POST /api/diary/copy`.

    `source_dates` must be non-empty (validated in the router, 400
    otherwise -- kept out of pydantic validation so the error shape matches
    the rest of this router's 400s rather than a 422). Overlapping
    `source_dates`/target range is allowed -- see `plan_copy` in
    `app/services/diary.py` for how that's handled correctly.
    """

    source_dates: list[date]
    target_start: date
    meals: list[Meal] | None = None
    mode: Literal["append", "replace"] = "append"


class DiaryCopyDayResult(BaseModel):
    date: date
    entries_created: int


class DiaryCopyResponse(BaseModel):
    entries_created: int
    days: list[DiaryCopyDayResult]


class GoalCreate(BaseModel):
    """Body for `PUT /api/goals`. `valid_from` is always today -- goals are
    append-only/historized, never mutated in place, so the caller doesn't
    supply it."""

    kcal: int
    protein_g: float
    carbs_g: float
    fat_g: float
