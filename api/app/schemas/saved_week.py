from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.models.diary import Meal
from app.schemas.food import Nutriments


class SavedWeekCreate(BaseModel):
    name: str
    start: date


class SavedWeekRename(BaseModel):
    name: str


class SavedWeekApply(BaseModel):
    days: list[int] | None = None
    target_start: date
    meals: list[Meal] | None = None
    mode: Literal["append", "replace"] = "append"


class SavedWeekItemOut(BaseModel):
    id: int
    food_id: int
    food_name: str
    food_brand: str | None
    grams: float
    portion_label: str | None
    position: int


class SavedWeekSummary(BaseModel):
    id: int
    name: str
    created_at: datetime
    entries_count: int
    avg_kcal: float


class SavedWeekDayOut(BaseModel):
    day_index: int
    meals: dict[str, list[SavedWeekItemOut]]
    total: Nutriments


class SavedWeekDetail(SavedWeekSummary):
    days: list[SavedWeekDayOut]
