from datetime import date
from typing import Any

from pydantic import BaseModel


class WeightIn(BaseModel):
    weight_kg: Any


class WeightOut(BaseModel):
    id: int
    date: date
    weight_kg: float


class WeightDayOut(BaseModel):
    date: date
    id: int | None
    weight_kg: float | None
    avg_7d_kg: float | None


class WeightWeekOut(BaseModel):
    week_start: date
    avg_kg: float | None
    count: int
    change_kg: float | None


class WeightHistoryOut(BaseModel):
    start: date
    end: date
    days: list[WeightDayOut]
    weeks: list[WeightWeekOut]
