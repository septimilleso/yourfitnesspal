"""Pydantic schemas for templates, folders and workouts."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.exercise import ExerciseOut
from app.services.gym_rules import DEFAULT_REST_SECONDS

Name100 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
RestSeconds = Annotated[int, Field(ge=0, le=600)]
Note = Annotated[str | None, Field(max_length=500)]


class SetValues(BaseModel):
    """One set's numbers; which ones matter depends on the exercise's tracking."""

    model_config = ConfigDict(from_attributes=True)

    weight_kg: float | None = Field(default=None, ge=0, le=1000)
    reps: int | None = Field(default=None, ge=0, le=1000)
    duration_s: int | None = Field(default=None, ge=0, le=36000)


class TemplateExerciseIn(BaseModel):
    exercise_id: int
    rest_seconds: RestSeconds = DEFAULT_REST_SECONDS
    superset_group: int | None = None
    note: Note = None
    sets: list[SetValues] = Field(min_length=1, max_length=30)


class TemplateIn(BaseModel):
    """Body of `POST /api/templates` and `PUT /api/templates/{id}` (full replace)."""

    name: Name100
    folder_id: int | None = None
    exercises: list[TemplateExerciseIn] = Field(default_factory=list, max_length=40)


class TemplateExerciseOut(BaseModel):
    id: int
    exercise: ExerciseOut
    rest_seconds: int
    superset_group: int | None
    note: str | None
    sets: list[SetValues]


class TemplateOut(BaseModel):
    id: int
    name: str
    folder_id: int | None
    last_used_at: datetime | None
    exercises: list[TemplateExerciseOut]


class TemplateSummary(BaseModel):
    id: int
    name: str
    folder_id: int | None
    last_used_at: datetime | None
    exercise_names: list[str]


class FolderIn(BaseModel):
    name: Name100


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    position: int


class TemplatesResponse(BaseModel):
    folders: list[FolderOut]
    templates: list[TemplateSummary]


class TemplatePatch(BaseModel):
    """Rename and/or move to a folder. `folder_id: null` sent explicitly moves the
    template out of its folder; an omitted field is left unchanged."""

    name: Name100 | None = None
    folder_id: int | None = None
