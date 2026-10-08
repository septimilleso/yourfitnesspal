"""The live workout session, its rest timer, finishing and history.

Every live edit loads the whole in-progress workout, changes it in memory,
commits, and answers with the full `WorkoutOut`, so the SPA can replace its
cached copy with the response. Positions are 0-based and rewritten after
every insert/delete; superset groups are renormalized after every change.
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.user import User
from app.models.workout import (
    TemplateExercise,
    TemplateSet,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutStatus,
    WorkoutTemplate,
)
from app.permissions import Permission, ensure_permission
from app.schemas.workout import (
    FinishIn,
    HistoryExercise,
    HistoryItem,
    HistoryPage,
    LayoutIn,
    RestIn,
    SaveAsTemplateIn,
    SetPatch,
    SetValues,
    TemplateOut,
    WorkoutExerciseAdd,
    WorkoutExerciseOut,
    WorkoutExercisePatch,
    WorkoutOut,
    WorkoutRename,
    WorkoutSetOut,
    WorkoutStart,
)
from app.services.errors import Invalid, NotFound
from app.services.exercises import exercise_out, get_visible_exercises
from app.services.gym_rules import (
    DEFAULT_REST_SECONDS,
    DiffExercise,
    ExerciseProgress,
    normalize_supersets,
    rest_after_completion,
    set_problem,
    template_diff,
    tracking_fields,
)
from app.services.templates import (
    find_template,
    next_template_position,
    own_folder,
    own_template,
    template_out,
)

SET_FIELDS = ("weight_kg", "reps", "duration_s")


def now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Previous:
    rest_seconds: int
    sets: list[SetValues] = field(default_factory=list)


async def load_workout(db: AsyncSession, user: User, workout_id: int) -> Workout:
    ensure_permission(user, Permission.workouts)
    workout = await db.scalar(
        sa.select(Workout)
        .where(Workout.id == workout_id, Workout.user_id == user.id)
        .options(
            selectinload(Workout.exercises).selectinload(WorkoutExercise.exercise),
            selectinload(Workout.exercises).selectinload(WorkoutExercise.sets),
        )
        .execution_options(populate_existing=True)
    )
    if workout is None:
        raise NotFound("workout not found")
    return workout


async def _load_live(db: AsyncSession, user: User, workout_id: int) -> Workout:
    workout = await load_workout(db, user, workout_id)
    if workout.status is not WorkoutStatus.in_progress:
        raise Invalid("workout is not in progress")
    return workout


def _item(workout: Workout, item_id: int) -> WorkoutExercise:
    for item in workout.exercises:
        if item.id == item_id:
            return item
    raise NotFound("exercise not found")


def _set(workout: Workout, set_id: int) -> tuple[WorkoutExercise, WorkoutSet]:
    for item in workout.exercises:
        for workout_set in item.sets:
            if workout_set.id == set_id:
                return item, workout_set
    raise NotFound("set not found")


def _renumber(workout: Workout) -> None:
    groups = normalize_supersets([item.superset_group for item in workout.exercises])
    for position, (item, group) in enumerate(zip(workout.exercises, groups, strict=True)):
        item.position = position
        item.superset_group = group
        for number, workout_set in enumerate(item.sets):
            workout_set.position = number


async def previous_sets(
    db: AsyncSession, user: User, exercise_ids: Iterable[int]
) -> dict[int, Previous]:
    """Rest and completed sets of each exercise's last finished appearance."""
    ids = set(exercise_ids)
    if not ids:
        return {}
    latest = (
        await db.execute(
            sa.select(
                WorkoutExercise.exercise_id, WorkoutExercise.id, WorkoutExercise.rest_seconds
            )
            .join(Workout, Workout.id == WorkoutExercise.workout_id)
            .where(
                Workout.user_id == user.id,
                Workout.status == WorkoutStatus.finished,
                WorkoutExercise.exercise_id.in_(ids),
            )
            .distinct(WorkoutExercise.exercise_id)
            .order_by(
                WorkoutExercise.exercise_id, Workout.finished_at.desc(), WorkoutExercise.position
            )
        )
    ).all()
    if not latest:
        return {}
    exercise_of = {item_id: exercise_id for exercise_id, item_id, _ in latest}
    result = {exercise_id: Previous(rest_seconds=rest) for exercise_id, _, rest in latest}
    rows = await db.scalars(
        sa.select(WorkoutSet)
        .where(
            WorkoutSet.workout_exercise_id.in_(exercise_of),
            WorkoutSet.completed_at.is_not(None),
        )
        .order_by(WorkoutSet.workout_exercise_id, WorkoutSet.position)
    )
    for workout_set in rows:
        result[exercise_of[workout_set.workout_exercise_id]].sets.append(
            SetValues.model_validate(workout_set)
        )
    return result


def _previous_at(previous: Previous | None, index: int) -> SetValues | None:
    if previous is None or index >= len(previous.sets):
        return None
    return previous.sets[index]


async def best_sets(
    db: AsyncSession, user: User, exercise_ids: Iterable[int]
) -> dict[int, list[SetValues]]:
    """Best completed set at each position across finished workouts."""
    ids = set(exercise_ids)
    if not ids:
        return {}
    ranked = (
        sa.select(
            WorkoutExercise.exercise_id.label("exercise_id"),
            sa.func.row_number()
            .over(
                partition_by=WorkoutSet.workout_exercise_id,
                order_by=WorkoutSet.position,
            )
            .label("n"),
            WorkoutSet.weight_kg.label("weight_kg"),
            WorkoutSet.reps.label("reps"),
            WorkoutSet.duration_s.label("duration_s"),
        )
        .join(WorkoutSet, WorkoutSet.workout_exercise_id == WorkoutExercise.id)
        .join(Workout, Workout.id == WorkoutExercise.workout_id)
        .where(
            Workout.user_id == user.id,
            Workout.status == WorkoutStatus.finished,
            WorkoutSet.completed_at.is_not(None),
            WorkoutExercise.exercise_id.in_(ids),
        )
        .subquery()
    )
    rows = (
        await db.execute(
            sa.select(
                ranked.c.exercise_id,
                ranked.c.n,
                ranked.c.weight_kg,
                ranked.c.reps,
                ranked.c.duration_s,
            )
            .distinct(ranked.c.exercise_id, ranked.c.n)
            .order_by(
                ranked.c.exercise_id,
                ranked.c.n,
                sa.func.coalesce(ranked.c.weight_kg, 0).desc(),
                sa.func.coalesce(ranked.c.reps, 0).desc(),
                sa.func.coalesce(ranked.c.duration_s, 0).desc(),
            )
        )
    ).all()
    result: dict[int, list[SetValues]] = {}
    for exercise_id, _, weight_kg, reps, duration_s in rows:
        result.setdefault(exercise_id, []).append(
            SetValues(weight_kg=weight_kg, reps=reps, duration_s=duration_s)
        )
    return result


def _best_at(best: list[SetValues] | None, index: int) -> SetValues | None:
    if best is None or index >= len(best):
        return None
    return best[index]


def _diff_item(item) -> DiffExercise:
    return DiffExercise(
        exercise_id=item.exercise_id, name=item.exercise.name, tracking=item.exercise.tracking,
        rest_seconds=item.rest_seconds, superset_group=item.superset_group,
        sets=tuple((s.weight_kg, s.reps, s.duration_s) for s in item.sets),
    )


async def _template_diff(db: AsyncSession, user: User, workout: Workout) -> list[str]:
    if workout.template_id is None:
        return []
    template = await find_template(db, user, workout.template_id)
    if template is None:
        return []
    return template_diff(
        [_diff_item(item) for item in template.exercises],
        [_diff_item(item) for item in workout.exercises],
    )


async def workout_out(db: AsyncSession, user: User, workout: Workout) -> WorkoutOut:
    previous: dict[int, Previous] = {}
    best: dict[int, list[SetValues]] = {}
    diff: list[str] = []
    if workout.status is WorkoutStatus.in_progress:
        exercise_ids = {item.exercise_id for item in workout.exercises}
        previous = await previous_sets(db, user, exercise_ids)
        best = await best_sets(db, user, exercise_ids)
    else:
        diff = await _template_diff(db, user, workout)
    return WorkoutOut(
        id=workout.id, name=workout.name, template_id=workout.template_id,
        status=workout.status, started_at=workout.started_at,
        finished_at=workout.finished_at, rest_ends_at=workout.rest_ends_at,
        rest_total_s=workout.rest_total_s, server_now=now(),
        exercises=[
            WorkoutExerciseOut(
                id=item.id, exercise=exercise_out(item.exercise), rest_seconds=item.rest_seconds,
                superset_group=item.superset_group, note=item.note,
                sets=[
                    WorkoutSetOut(
                        id=s.id, weight_kg=s.weight_kg, reps=s.reps, duration_s=s.duration_s,
                        completed_at=s.completed_at,
                        previous=_previous_at(previous.get(item.exercise_id), number),
                        max_set=_best_at(best.get(item.exercise_id), number),
                    )
                    for number, s in enumerate(item.sets)
                ],
            )
            for item in workout.exercises
        ],
        template_diff=diff,
    )


async def _save(db: AsyncSession, user: User, workout: Workout) -> WorkoutOut:
    await db.commit()
    return await workout_out(db, user, await load_workout(db, user, workout.id))


async def _active_id(db: AsyncSession, user: User) -> int | None:
    return await db.scalar(
        sa.select(Workout.id).where(
            Workout.user_id == user.id, Workout.status == WorkoutStatus.in_progress
        )
    )


async def get_active(db: AsyncSession, user: User) -> WorkoutOut | None:
    ensure_permission(user, Permission.workouts)
    workout_id = await _active_id(db, user)
    if workout_id is None:
        return None
    return await workout_out(db, user, await load_workout(db, user, workout_id))


async def get_workout(db: AsyncSession, user: User, workout_id: int) -> WorkoutOut:
    return await workout_out(db, user, await load_workout(db, user, workout_id))


async def start_workout(db: AsyncSession, user: User, payload: WorkoutStart) -> WorkoutOut:
    ensure_permission(user, Permission.workouts)
    if await _active_id(db, user) is not None:
        raise Invalid("a workout is already in progress")
    started = now()
    local_day = started.astimezone(ZoneInfo(settings.app_timezone))
    workout = Workout(
        user_id=user.id, status=WorkoutStatus.in_progress, started_at=started,
        name=f"Allenamento {local_day:%d/%m/%Y}",
    )
    if payload.template_id is not None:
        template = await own_template(db, user, payload.template_id)
        workout.template_id = template.id
        workout.name = template.name
        workout.exercises = [
            WorkoutExercise(
                exercise_id=item.exercise_id, exercise=item.exercise, position=item.position,
                rest_seconds=item.rest_seconds, superset_group=item.superset_group,
                note=item.note,
                sets=[
                    WorkoutSet(
                        position=s.position, weight_kg=s.weight_kg, reps=s.reps,
                        duration_s=s.duration_s,
                    )
                    for s in item.sets
                ],
            )
            for item in template.exercises
        ]
        template.last_used_at = started
    db.add(workout)
    try:
        return await _save(db, user, workout)
    except IntegrityError as exc:
        await db.rollback()
        raise Invalid("a workout is already in progress") from exc


async def rename_workout(
    db: AsyncSession, user: User, workout_id: int, payload: WorkoutRename
) -> WorkoutOut:
    workout = await load_workout(db, user, workout_id)
    workout.name = payload.name
    return await _save(db, user, workout)


async def add_exercise(
    db: AsyncSession, user: User, workout_id: int, payload: WorkoutExerciseAdd
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    exercise = (await get_visible_exercises(db, user, [payload.exercise_id]))[payload.exercise_id]
    previous = (await previous_sets(db, user, [exercise.id])).get(exercise.id)
    values = previous.sets if previous and previous.sets else [SetValues()]
    workout.exercises.append(
        WorkoutExercise(
            exercise_id=exercise.id, exercise=exercise, position=len(workout.exercises),
            rest_seconds=previous.rest_seconds if previous else DEFAULT_REST_SECONDS,
            sets=[
                WorkoutSet(position=number, **value.model_dump())
                for number, value in enumerate(values)
            ],
        )
    )
    return await _save(db, user, workout)


async def patch_exercise(
    db: AsyncSession, user: User, workout_id: int, item_id: int, payload: WorkoutExercisePatch
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    item = _item(workout, item_id)
    fields = payload.model_fields_set
    if "exercise_id" in fields and payload.exercise_id not in (None, item.exercise_id):
        exercise = (await get_visible_exercises(db, user, [payload.exercise_id]))[
            payload.exercise_id
        ]
        old_tracking = item.exercise.tracking
        item.exercise_id = exercise.id
        item.exercise = exercise
        if exercise.tracking is not old_tracking:
            used_fields = tracking_fields(exercise.tracking)
            for workout_set in item.sets:
                workout_set.completed_at = None
                for name in SET_FIELDS:
                    if name not in used_fields:
                        setattr(workout_set, name, None)
    if "rest_seconds" in fields and payload.rest_seconds is not None:
        item.rest_seconds = payload.rest_seconds
    if "note" in fields:
        item.note = payload.note or None
    return await _save(db, user, workout)


async def remove_exercise(
    db: AsyncSession, user: User, workout_id: int, item_id: int
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    workout.exercises.remove(_item(workout, item_id))
    _renumber(workout)
    return await _save(db, user, workout)


async def set_layout(
    db: AsyncSession, user: User, workout_id: int, payload: LayoutIn
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    by_id = {item.id: item for item in workout.exercises}
    ids = [entry.id for entry in payload.items]
    if sorted(ids) != sorted(by_id):
        raise Invalid("layout must list every exercise once")
    ordered = [by_id[item_id] for item_id in ids]
    for item, entry in zip(ordered, payload.items, strict=True):
        item.superset_group = entry.superset_group
    workout.exercises[:] = ordered
    _renumber(workout)
    return await _save(db, user, workout)


async def add_set(db: AsyncSession, user: User, workout_id: int, item_id: int) -> WorkoutOut:
    """Add a set copying the last one, or the first set of last time."""
    workout = await _load_live(db, user, workout_id)
    item = _item(workout, item_id)
    if item.sets:
        last = item.sets[-1]
        values = SetValues(weight_kg=last.weight_kg, reps=last.reps, duration_s=last.duration_s)
    else:
        previous = (await previous_sets(db, user, [item.exercise_id])).get(item.exercise_id)
        values = _previous_at(previous, 0) or SetValues()
    item.sets.append(WorkoutSet(position=len(item.sets), **values.model_dump()))
    return await _save(db, user, workout)


def _apply(workout_set: WorkoutSet, payload: SetPatch) -> None:
    for name in SET_FIELDS:
        if name in payload.model_fields_set:
            setattr(workout_set, name, getattr(payload, name))


async def patch_set(
    db: AsyncSession, user: User, workout_id: int, set_id: int, payload: SetPatch
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    item, workout_set = _set(workout, set_id)
    _apply(workout_set, payload)
    if workout_set.completed_at is not None:
        problem = set_problem(
            item.exercise.tracking, workout_set.weight_kg, workout_set.reps, workout_set.duration_s
        )
        if problem:
            raise Invalid(problem)
    return await _save(db, user, workout)


async def delete_set(db: AsyncSession, user: User, workout_id: int, set_id: int) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    item, workout_set = _set(workout, set_id)
    item.sets.remove(workout_set)
    _renumber(workout)
    return await _save(db, user, workout)


def _progress(item: WorkoutExercise) -> ExerciseProgress:
    return ExerciseProgress(
        rest_seconds=item.rest_seconds, superset_group=item.superset_group,
        set_positions=frozenset(s.position for s in item.sets),
        completed_positions=frozenset(s.position for s in item.sets if s.completed_at),
    )


def _start_rest(workout: Workout, seconds: int) -> None:
    workout.rest_ends_at = now() + timedelta(seconds=seconds)
    workout.rest_total_s = seconds


def _clear_rest(workout: Workout) -> None:
    workout.rest_ends_at = None
    workout.rest_total_s = None


async def complete_set(
    db: AsyncSession, user: User, workout_id: int, set_id: int, payload: SetPatch
) -> WorkoutOut:
    """Save the values sent with the tick, mark the set done, start the rest."""
    workout = await _load_live(db, user, workout_id)
    item, workout_set = _set(workout, set_id)
    _apply(workout_set, payload)
    problem = set_problem(
        item.exercise.tracking, workout_set.weight_kg, workout_set.reps, workout_set.duration_s
    )
    if problem:
        raise Invalid(problem)
    if workout_set.completed_at is None:
        workout_set.completed_at = now()
        rest_seconds = rest_after_completion(
            [_progress(entry) for entry in workout.exercises],
            workout.exercises.index(item),
            workout_set.position,
        )
        if rest_seconds:
            _start_rest(workout, rest_seconds)
    return await _save(db, user, workout)


async def uncomplete_set(
    db: AsyncSession, user: User, workout_id: int, set_id: int
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    _, workout_set = _set(workout, set_id)
    workout_set.completed_at = None
    return await _save(db, user, workout)


async def rest(db: AsyncSession, user: User, workout_id: int, payload: RestIn) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    current = now()
    if payload.skip:
        _clear_rest(workout)
    elif payload.start_s is not None:
        _start_rest(workout, payload.start_s)
    else:
        if workout.rest_ends_at is None or workout.rest_ends_at <= current:
            raise Invalid("no rest timer running")
        ends = workout.rest_ends_at + timedelta(seconds=payload.delta_s or 0)
        if ends <= current:
            _clear_rest(workout)
        else:
            workout.rest_ends_at = ends
            workout.rest_total_s = max(1, (workout.rest_total_s or 0) + (payload.delta_s or 0))
    return await _save(db, user, workout)


async def finish_workout(
    db: AsyncSession, user: User, workout_id: int, payload: FinishIn
) -> WorkoutOut:
    """Close the session. Undone sets are only dropped when the user confirmed
    (`discard_incomplete`); exercises left without sets are dropped too."""
    workout = await _load_live(db, user, workout_id)
    all_sets = [s for item in workout.exercises for s in item.sets]
    if not any(s.completed_at is not None for s in all_sets):
        raise Invalid("empty_workout")
    if any(s.completed_at is None for s in all_sets) and not payload.discard_incomplete:
        raise Invalid("incomplete_sets")
    for item in workout.exercises:
        item.sets[:] = [s for s in item.sets if s.completed_at is not None]
    workout.exercises[:] = [item for item in workout.exercises if item.sets]
    _renumber(workout)
    workout.status = WorkoutStatus.finished
    workout.finished_at = now()
    _clear_rest(workout)
    return await _save(db, user, workout)


async def delete_workout(db: AsyncSession, user: User, workout_id: int) -> None:
    await db.delete(await load_workout(db, user, workout_id))
    await db.commit()


async def _load_finished(db: AsyncSession, user: User, workout_id: int) -> Workout:
    workout = await load_workout(db, user, workout_id)
    if workout.status is not WorkoutStatus.finished:
        raise Invalid("workout is not finished")
    return workout


def _template_exercises(workout: Workout) -> list[TemplateExercise]:
    return [
        TemplateExercise(
            exercise_id=item.exercise_id, exercise=item.exercise, position=item.position,
            rest_seconds=item.rest_seconds, superset_group=item.superset_group, note=item.note,
            sets=[
                TemplateSet(
                    position=s.position, weight_kg=s.weight_kg, reps=s.reps,
                    duration_s=s.duration_s,
                )
                for s in item.sets
            ],
        )
        for item in workout.exercises
    ]


async def apply_to_template(db: AsyncSession, user: User, workout_id: int) -> TemplateOut:
    """Make the workout's template match what was actually done."""
    workout = await _load_finished(db, user, workout_id)
    if workout.template_id is None:
        raise Invalid("workout has no template")
    template = await own_template(db, user, workout.template_id)
    template.exercises = _template_exercises(workout)
    await db.commit()
    return template_out(await own_template(db, user, template.id))


async def save_as_template(
    db: AsyncSession, user: User, workout_id: int, payload: SaveAsTemplateIn
) -> TemplateOut:
    workout = await _load_finished(db, user, workout_id)
    if payload.folder_id is not None:
        await own_folder(db, user, payload.folder_id)
    template = WorkoutTemplate(
        user_id=user.id, folder_id=payload.folder_id, name=payload.name,
        position=await next_template_position(db, user, payload.folder_id),
        last_used_at=workout.finished_at, exercises=_template_exercises(workout),
    )
    db.add(template)
    await db.flush()
    workout.template_id = template.id
    await db.commit()
    return template_out(await own_template(db, user, template.id))


async def list_history(
    db: AsyncSession, user: User, *, before: datetime | None = None, limit: int = 20
) -> HistoryPage:
    ensure_permission(user, Permission.workouts)
    stmt = (
        sa.select(Workout)
        .where(Workout.user_id == user.id, Workout.status == WorkoutStatus.finished)
        .options(
            selectinload(Workout.exercises).selectinload(WorkoutExercise.exercise),
            selectinload(Workout.exercises).selectinload(WorkoutExercise.sets),
        )
        .order_by(Workout.finished_at.desc(), Workout.id.desc())
        .limit(limit + 1)
    )
    if before is not None:
        stmt = stmt.where(Workout.finished_at < before)
    rows = (await db.scalars(stmt)).all()
    page = rows[:limit]
    return HistoryPage(
        items=[
            HistoryItem(
                id=w.id, name=w.name, started_at=w.started_at, finished_at=w.finished_at,
                exercises=[
                    HistoryExercise(name=item.exercise.name, sets=len(item.sets))
                    for item in w.exercises
                ],
            )
            for w in page
        ],
        next_before=page[-1].finished_at if len(rows) > limit else None,
    )
