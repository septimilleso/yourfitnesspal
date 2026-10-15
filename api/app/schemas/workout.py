"""Pydantic schemas for templates, folders and workouts."""

from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.models.workout import WorkoutStatus
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


class WorkoutSetOut(SetValues):
    id: int
    uuid: UUID
    completed_at: datetime | None
    # Same position in the last finished workout with this exercise.
    previous: SetValues | None
    # Best completed set at this position across finished workouts; None if absent or finished workout.
    max_set: SetValues | None = None


class WorkoutExerciseOut(BaseModel):
    id: int
    uuid: UUID
    exercise: ExerciseOut
    rest_seconds: int
    superset_group: int | None
    note: str | None
    sets: list[WorkoutSetOut]


class WorkoutOut(BaseModel):
    id: int
    uuid: UUID
    version: int
    name: str
    template_id: int | None
    status: WorkoutStatus
    started_at: datetime
    finished_at: datetime | None
    rest_ends_at: datetime | None
    rest_total_s: int | None
    # Server clock at response time: the SPA derives its clock offset from it,
    # so the rest countdown is right even if the phone's clock drifts.
    server_now: datetime
    exercises: list[WorkoutExerciseOut]
    # Finished workouts made from a template: readable differences from it.
    template_diff: list[str] = Field(default_factory=list)


class SnapshotExercise(BaseModel):
    """One exercise of the offline snapshot, with what Precedente and Max show for it."""

    exercise: ExerciseOut
    # Rest of the last finished appearance; null if the exercise has none.
    rest_seconds: int | None = Field(default=None, ge=0, le=600)
    # Completed sets of the last finished appearance, in order; empty if none.
    previous: list[SetValues]
    # Best completed set per position across finished workouts; empty if none.
    max: list[SetValues]


class OfflineSnapshot(BaseModel):
    """`GET /api/workouts/offline-snapshot`: the phone's Precedente and Max source."""

    # Server clock at response time, as in `WorkoutOut.server_now`.
    server_now: datetime
    exercises: list[SnapshotExercise]


# Largest value of a Postgres integer column: larger ids would fail in the database.
_MAX_INT4 = 2**31 - 1


def _two_decimals(value: float | None) -> float | None:
    """Weights are stored as Numeric(6,2): round to two decimals before comparing content."""
    if value is None:
        return None
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


class WorkoutPutSet(BaseModel):
    """A set of `PUT /api/workouts/{uuid}`. Its `uuid` pairs it with the stored row."""

    uuid: UUID
    weight_kg: float | None = Field(default=None, ge=0, le=1000)
    reps: int | None = Field(default=None, ge=0, le=1000)
    duration_s: int | None = Field(default=None, ge=0, le=36000)
    completed_at: AwareDatetime | None = None

    @field_validator("weight_kg")
    @classmethod
    def _weight_two_decimals(cls, value: float | None) -> float | None:
        return _two_decimals(value)


class WorkoutPutExercise(BaseModel):
    uuid: UUID
    exercise_id: int = Field(le=_MAX_INT4)
    rest_seconds: RestSeconds
    superset_group: int | None = None
    note: Note = None
    sets: list[WorkoutPutSet] = Field(default_factory=list, max_length=100)


class WorkoutPutIn(BaseModel):
    """Body of `PUT /api/workouts/{uuid}`: the whole workout, in order.

    `base_version` is null only for a workout the server has never seen. Times
    out of range are brought back by the server, never rejected (R6).
    """

    base_version: int | None = Field(default=None, ge=1)
    name: Name100
    template_id: int | None = Field(default=None, le=_MAX_INT4)
    status: WorkoutStatus
    started_at: AwareDatetime
    finished_at: AwareDatetime | None = None
    rest_ends_at: AwareDatetime | None = None
    rest_total_s: int | None = None
    exercises: list[WorkoutPutExercise] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def _uuids_are_unique(self) -> "WorkoutPutIn":
        # A uuid names one row: repeated in the body it would pair two sent items with one row.
        exercise_uuids = [item.uuid for item in self.exercises]
        set_uuids = [s.uuid for item in self.exercises for s in item.sets]
        if len(set(exercise_uuids)) != len(exercise_uuids):
            raise ValueError("exercise uuid repeated in the workout")
        if len(set(set_uuids)) != len(set_uuids):
            raise ValueError("set uuid repeated in the workout")
        return self

    @model_validator(mode="after")
    def _finished_at_follows_status(self) -> "WorkoutPutIn":
        if self.status is WorkoutStatus.finished and self.finished_at is None:
            raise ValueError("finished_at is required when the workout is finished")
        if self.status is WorkoutStatus.in_progress and self.finished_at is not None:
            raise ValueError("finished_at must be null while the workout is in progress")
        return self


class WorkoutStart(BaseModel):
    template_id: int | None = None


class WorkoutRename(BaseModel):
    name: Name100


class WorkoutExerciseAdd(BaseModel):
    exercise_id: int


class WorkoutExercisePatch(BaseModel):
    """Only the fields sent are changed. `exercise_id` replaces the exercise."""

    exercise_id: int | None = None
    rest_seconds: RestSeconds | None = None
    note: Note = None


class LayoutItem(BaseModel):
    id: int
    superset_group: int | None = None


class LayoutIn(BaseModel):
    """Order and superset grouping of every exercise of the workout."""

    items: list[LayoutItem]


class SetPatch(SetValues):
    """Only the fields sent are changed (`null` clears a value)."""


class RestIn(BaseModel):
    """Exactly one of: start a timer, move the running one, or skip it."""

    start_s: int | None = Field(default=None, ge=1, le=600)
    delta_s: int | None = Field(default=None, ge=-600, le=600)
    skip: bool = False

    @model_validator(mode="after")
    def _one_action(self) -> "RestIn":
        chosen = [self.start_s is not None, self.delta_s is not None, self.skip]
        if sum(chosen) != 1:
            raise ValueError("send exactly one of start_s, delta_s, skip")
        return self


class FinishIn(BaseModel):
    discard_incomplete: bool = False


class SaveAsTemplateIn(BaseModel):
    name: Name100
    folder_id: int | None = None


class HistoryExercise(BaseModel):
    name: str
    sets: int


class HistoryItem(BaseModel):
    id: int
    name: str
    started_at: datetime
    finished_at: datetime
    exercises: list[HistoryExercise]


class HistoryPage(BaseModel):
    items: list[HistoryItem]
    # Pass as `before` to get the next page; null on the last page.
    next_before: datetime | None
