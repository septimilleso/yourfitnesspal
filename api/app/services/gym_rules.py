"""Pure gym rules shared by the services, the catalog build and the tests.

Nothing here touches the database, so every rule is unit-testable without
Postgres. Italian strings are user-facing (the SPA shows them verbatim).
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from decimal import Decimal

from app.models.exercise import Tracking
from app.models.workout import WorkoutStatus

DEFAULT_REST_SECONDS = 90
# R6: times sent by a client may be this far ahead of the server clock, and a
# rest lasts at most MAX_REST_SECONDS.
TIME_TOLERANCE = timedelta(minutes=5)
MAX_REST_SECONDS = 600

TRACKING_FIELDS = {
    Tracking.weight_reps: ("weight_kg", "reps"),
    Tracking.reps: ("reps",),
    Tracking.duration: ("duration_s",),
}


def tracking_fields(tracking: Tracking) -> tuple[str, ...]:
    return TRACKING_FIELDS[tracking]

# (weight_kg, reps, duration_s)
SetTuple = tuple[float | Decimal | None, int | None, int | None]


def derive_tracking(category: str | None, equipment: str | None) -> Tracking:
    """What a catalog exercise records, from its free-exercise-db fields."""
    if category in ("stretching", "cardio"):
        return Tracking.duration
    if equipment == "body only":
        return Tracking.reps
    return Tracking.weight_reps


def normalize_supersets(groups: Sequence[int | None]) -> list[int | None]:
    """Renumber superset groups 1..n over runs of consecutive equal values.

    A run of one exercise is not a superset and becomes None; the same value
    in two separate runs yields two distinct groups.
    """
    result: list[int | None] = [None] * len(groups)
    next_group = 1
    start = 0
    while start < len(groups):
        end = start
        if groups[start] is not None:
            while end + 1 < len(groups) and groups[end + 1] == groups[start]:
                end += 1
        if end > start:
            for index in range(start, end + 1):
                result[index] = next_group
            next_group += 1
        start = end + 1
    return result


def set_problem(
    tracking: Tracking,
    weight_kg: float | Decimal | None,
    reps: int | None,
    duration_s: int | None,
) -> str | None:
    """Why a set cannot be marked done, or None when it can."""
    if tracking is Tracking.weight_reps and (weight_kg is None or reps is None):
        return "weight and reps are required"
    if tracking is Tracking.reps and reps is None:
        return "reps are required"
    if tracking is Tracking.duration and duration_s is None:
        return "duration is required"
    return None


@dataclass(frozen=True)
class ExerciseProgress:
    rest_seconds: int
    superset_group: int | None
    set_positions: frozenset[int]
    completed_positions: frozenset[int]


def rest_after_completion(
    exercises: Sequence[ExerciseProgress], index: int, position: int
) -> int | None:
    """Seconds of rest to start after set `position` of `exercises[index]` is done.

    Outside a superset: that exercise's rest. Inside one: only once every
    exercise of the group has finished (or has no) set at that position, using
    the rest of the group's last exercise. 0 means no timer.
    """
    current = exercises[index]
    if current.superset_group is None:
        rest = current.rest_seconds
    else:
        group = [e for e in exercises if e.superset_group == current.superset_group]
        round_done = all(
            position not in e.set_positions or position in e.completed_positions for e in group
        )
        if not round_done:
            return None
        rest = group[-1].rest_seconds
    return rest or None


def format_kg(value: float | Decimal) -> str:
    text = f"{float(value):.2f}".rstrip("0").rstrip(".")
    return text.replace(".", ",")


def format_duration(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def format_set(tracking: Tracking, values: SetTuple) -> str:
    weight, reps, duration = values
    if tracking is Tracking.duration:
        return format_duration(duration or 0)
    if tracking is Tracking.reps and weight is None:
        return f"{reps or 0} rip"
    return f"{format_kg(weight or 0)} kg × {reps or 0}"


@dataclass(frozen=True)
class DiffExercise:
    exercise_id: int
    name: str
    tracking: Tracking
    rest_seconds: int
    superset_group: int | None
    sets: tuple[SetTuple, ...]


def _norm(values: SetTuple) -> tuple[float | None, ...]:
    return tuple(None if v is None else float(v) for v in values)


def _keyed(items: Sequence[DiffExercise]) -> list[tuple[tuple[int, int], DiffExercise]]:
    """Key each item by (exercise_id, occurrence), so the k-th Squat of the
    template pairs with the k-th Squat of the workout."""
    seen: dict[int, int] = {}
    keyed = []
    for item in items:
        occurrence = seen.get(item.exercise_id, 0)
        seen[item.exercise_id] = occurrence + 1
        keyed.append(((item.exercise_id, occurrence), item))
    return keyed


def _partners(keyed: list[tuple[tuple[int, int], DiffExercise]]) -> dict:
    groups: dict[int, set] = {}
    for key, item in keyed:
        if item.superset_group is not None:
            groups.setdefault(item.superset_group, set()).add(key)
    return {
        key: frozenset(groups[item.superset_group]) if item.superset_group is not None
        else frozenset()
        for key, item in keyed
    }


def _exercise_changes(old: DiffExercise, new: DiffExercise) -> list[str]:
    changes = []
    for number, (a, b) in enumerate(zip(old.sets, new.sets, strict=False), start=1):
        if _norm(a) != _norm(b):
            changes.append(
                f"{new.name}: serie {number} {format_set(new.tracking, a)} → "
                f"{format_set(new.tracking, b)}"
            )
    extra = len(new.sets) - len(old.sets)
    if extra > 0:
        changes.append(f"{new.name}: +{extra} serie")
    elif extra < 0:
        changes.append(f"{new.name}: {extra} serie")
    if old.rest_seconds != new.rest_seconds:
        changes.append(
            f"{new.name}: riposo {format_duration(old.rest_seconds)} → "
            f"{format_duration(new.rest_seconds)}"
        )
    return changes


def template_diff(
    template: Sequence[DiffExercise], workout: Sequence[DiffExercise]
) -> list[str]:
    """Readable differences between a template and the workout done from it.

    Empty list = nothing to ask the user.
    """
    before = _keyed(template)
    after = _keyed(workout)
    before_map = dict(before)
    after_map = dict(after)
    changes: list[str] = []
    for key, item in after:
        old = before_map.get(key)
        if old is None:
            changes.append(f"Aggiunto: {item.name}")
        else:
            changes.extend(_exercise_changes(old, item))
    changes.extend(f"Rimosso: {item.name}" for key, item in before if key not in after_map)

    common = before_map.keys() & after_map.keys()
    order_before = [key for key, _ in before if key in common]
    order_after = [key for key, _ in after if key in common]
    partners_before = _partners(before)
    partners_after = _partners(after)
    groups_changed = any(
        partners_before[key] & common != partners_after[key] & common for key in common
    )
    if order_before != order_after or groups_changed:
        changes.append("Ordine o superserie modificati")
    return changes


# (weight_kg, reps, duration_s) of a set that holds nothing yet.
EMPTY_SET: SetTuple = (None, None, None)


@dataclass(frozen=True)
class SetState:
    """A set as the live session edits it: its values and whether it is done."""

    weight_kg: float | Decimal | None
    reps: int | None
    duration_s: int | None
    completed: bool


class NoRestTimer(ValueError):
    """A rest change was asked while no rest timer is running."""


def next_set_values(last: SetTuple | None, previous_first: SetTuple | None) -> SetTuple:
    """Values of a set added by hand: a copy of the last set, else the first set
    of Precedente, else empty. `last` is None when the exercise has no sets."""
    if last is not None:
        return last
    if previous_first is not None:
        return previous_first
    return EMPTY_SET


def exercise_prefill(
    previous_rest: int | None, previous_sets: Sequence[SetTuple]
) -> tuple[int, list[SetTuple]]:
    """Rest and sets of an exercise added to a workout, from its last finished
    appearance. `previous_rest` is None when there is none: then the rest is the
    default and a single empty set is added (`previous_sets` is empty too)."""
    rest = DEFAULT_REST_SECONDS if previous_rest is None else previous_rest
    sets = list(previous_sets) if previous_sets else [EMPTY_SET]
    return rest, sets


def tracking_reset(tracking: Tracking, sets: Sequence[SetState]) -> list[SetState]:
    """Sets after the exercise's tracking changed: none is done any more, and the
    fields the new tracking does not use are cleared."""
    used = tracking_fields(tracking)
    return [
        SetState(
            weight_kg=s.weight_kg if "weight_kg" in used else None,
            reps=s.reps if "reps" in used else None,
            duration_s=s.duration_s if "duration_s" in used else None,
            completed=False,
        )
        for s in sets
    ]


def rest_action(
    now: datetime,
    ends_at: datetime | None,
    total_s: int | None,
    *,
    start_s: int | None = None,
    delta_s: int | None = None,
    skip: bool = False,
) -> tuple[datetime | None, int | None]:
    """New (rest_ends_at, rest_total_s) after one rest action. The request sends
    exactly one of `skip`, `start_s`, `delta_s`. Raises NoRestTimer when a change
    arrives and no timer is running (or it has already ended).
    """
    if skip:
        return None, None
    if start_s is not None:
        return now + timedelta(seconds=start_s), start_s
    if ends_at is None or ends_at <= now:
        raise NoRestTimer("no rest timer running")
    ends = ends_at + timedelta(seconds=delta_s or 0)
    if ends <= now:
        return None, None
    return ends, max(1, (total_s or 0) + (delta_s or 0))


def finish_problem(completed: Sequence[bool], discard_incomplete: bool) -> str | None:
    """Why the workout cannot be finished, given the done flag of every set (in
    workout order), or None. Undone sets need the user's confirmation."""
    if not any(completed):
        return "empty_workout"
    if not all(completed) and not discard_incomplete:
        return "incomplete_sets"
    return None


def finish_prune(completed: Sequence[Sequence[bool]]) -> list[tuple[int, list[int]]]:
    """What survives a finish: for each exercise with at least one done set, its
    index and the indexes of its done sets. Exercises without one are dropped."""
    return [
        (index, [number for number, done in enumerate(sets) if done])
        for index, sets in enumerate(completed)
        if any(sets)
    ]


@dataclass(frozen=True)
class StateSet:
    """A set as the client holds it: `completed_at` is None while it is not done."""

    weight_kg: float | Decimal | None
    reps: int | None
    duration_s: int | None
    completed_at: datetime | None


@dataclass(frozen=True)
class StateExercise:
    """An exercise of a workout. Its position is its index in the workout."""

    exercise_id: int
    rest_seconds: int
    superset_group: int | None
    note: str | None
    sets: tuple[StateSet, ...]


@dataclass(frozen=True)
class StateWorkout:
    """A whole workout, as `PUT /api/workouts/{uuid}` sends it. Times are
    timezone-aware datetimes; uuids and ids are identity, not content, so they
    are not part of the state."""

    name: str
    template_id: int | None
    status: WorkoutStatus
    started_at: datetime
    finished_at: datetime | None
    rest_ends_at: datetime | None
    rest_total_s: int | None
    exercises: tuple[StateExercise, ...]


def _canonical_set(state: StateSet) -> StateSet:
    weight = None if state.weight_kg is None else float(state.weight_kg)
    return replace(state, weight_kg=weight)


def canonical_workout(state: StateWorkout) -> StateWorkout:
    """The workout as the server stores it. Positions are the order of the tuples;
    decimal weights become floats (as `_norm`). A finished workout keeps only the
    done sets and the exercises left with one, has no rest timer, and its
    supersets are renumbered after that pruning, so a group can shrink to a lone
    exercise (which is then no superset). In progress, nothing is dropped.
    """
    finished = state.status is WorkoutStatus.finished
    exercises = []
    for exercise in state.exercises:
        sets = tuple(
            _canonical_set(s)
            for s in exercise.sets
            if not finished or s.completed_at is not None
        )
        if finished and not sets:
            continue
        exercises.append(replace(exercise, sets=sets))
    groups = normalize_supersets([e.superset_group for e in exercises])
    return replace(
        state,
        exercises=tuple(
            replace(e, superset_group=group) for e, group in zip(exercises, groups, strict=True)
        ),
        rest_ends_at=None if finished else state.rest_ends_at,
        rest_total_s=None if finished else state.rest_total_s,
    )


def same_content(a: StateWorkout, b: StateWorkout) -> bool:
    """Whether two workouts hold the same content once canonicalized (R5)."""
    return canonical_workout(a) == canonical_workout(b)


def _clamp_time(value: datetime | None, low: datetime, high: datetime) -> datetime | None:
    if value is None:
        return None
    return max(min(value, high), low)


def clamp_times(state: StateWorkout, now: datetime) -> StateWorkout:
    """The workout with its times brought back into the plausible range around
    `now` (R6): out-of-range values are clamped, never rejected.

    Order: started_at <= now + T; finished_at within [started_at, now + T];
    each completed_at within [started_at, finished_at or now + T]; rest_ends_at
    <= now + 600 s + T; rest_total_s within [1, 600]. A rest whose two fields are
    not both present is dropped. Timestamps must be timezone-aware.
    """
    ceiling = now + TIME_TOLERANCE
    started_at = min(state.started_at, ceiling)
    finished = state.status is WorkoutStatus.finished
    finished_at = _clamp_time(state.finished_at, started_at, ceiling)
    last = finished_at if finished and finished_at is not None else ceiling
    exercises = tuple(
        replace(
            exercise,
            sets=tuple(
                replace(s, completed_at=_clamp_time(s.completed_at, started_at, last))
                for s in exercise.sets
            ),
        )
        for exercise in state.exercises
    )
    if state.rest_ends_at is None or state.rest_total_s is None:
        rest_ends_at, rest_total_s = None, None
    else:
        rest_ends_at = min(
            state.rest_ends_at, now + timedelta(seconds=MAX_REST_SECONDS) + TIME_TOLERANCE
        )
        rest_total_s = min(max(state.rest_total_s, 1), MAX_REST_SECONDS)
    return replace(
        state,
        started_at=started_at,
        finished_at=finished_at,
        rest_ends_at=rest_ends_at,
        rest_total_s=rest_total_s,
        exercises=exercises,
    )
