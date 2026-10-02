from datetime import date

from pydantic import BaseModel

from app.models.exercise import Tracking


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


class PerformedExerciseOut(BaseModel):
    exercise_id: int
    name: str
    tracking: Tracking
    custom: bool
    last_date: date


class ProgressSessionOut(BaseModel):
    date: date
    workout_id: int
    metrics: dict[str, float | int]
    sets: list[str]


class RecordOut(BaseModel):
    kind: str
    value: float | int
    date: date


class ExerciseProgressOut(BaseModel):
    exercise_id: int
    name: str
    tracking: Tracking
    start: date
    end: date
    sessions: list[ProgressSessionOut]
    records: list[RecordOut]
