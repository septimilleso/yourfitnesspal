from datetime import date

from pydantic import BaseModel


class StreakOut(BaseModel):
    current: int
    best: int


class GymCountOut(BaseModel):
    finished: int


class GymWeekOut(BaseModel):
    week_start: date
    workouts: int


class GymStatsOut(BaseModel):
    start: date
    end: date
    workouts: int
    volume_kg: float
    avg_duration_min: int | None
    weeks: list[GymWeekOut]
