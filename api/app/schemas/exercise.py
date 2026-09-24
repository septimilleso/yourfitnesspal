"""Pydantic schemas for the exercise catalog and custom exercises."""

from typing import Annotated

from pydantic import AfterValidator, BaseModel, StringConstraints

from app.models.exercise import EQUIPMENT, MUSCLES, Tracking

ExerciseName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


def _check_equipment(value: str | None) -> str | None:
    if value is not None and value not in EQUIPMENT:
        raise ValueError("unknown equipment")
    return value


def _check_muscle(value: str | None) -> str | None:
    if value is not None and value not in MUSCLES:
        raise ValueError("unknown muscle")
    return value


Equipment = Annotated[str | None, AfterValidator(_check_equipment)]
Muscle = Annotated[str | None, AfterValidator(_check_muscle)]


class ExerciseOut(BaseModel):
    id: int
    name: str
    equipment: str | None
    primary_muscles: list[str]
    secondary_muscles: list[str]
    category: str | None
    tracking: Tracking
    custom: bool


class ExerciseDetail(ExerciseOut):
    instructions: list[str]


class ExerciseList(BaseModel):
    items: list[ExerciseOut]
    total: int


class ExerciseCreate(BaseModel):
    name: ExerciseName
    equipment: Equipment = None
    primary_muscle: Muscle = None
    tracking: Tracking = Tracking.weight_reps


class ExercisePatch(BaseModel):
    """Only the fields sent are changed (`model_fields_set`)."""

    name: ExerciseName | None = None
    equipment: Equipment = None
    primary_muscle: Muscle = None
    tracking: Tracking | None = None
