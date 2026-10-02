from datetime import date

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.exercise import Exercise
from app.models.user import User
from app.models.workout import Workout, WorkoutExercise, WorkoutSet, WorkoutStatus
from app.permissions import Permission, ensure_permission
from app.schemas.stats import (
    ExerciseProgressOut,
    GymCountOut,
    GymStatsOut,
    GymWeekOut,
    PerformedExerciseOut,
    ProgressSessionOut,
    RecordOut,
)
from app.services import exercises as exercise_service
from app.services.gym_rules import SetTuple, format_set
from app.services.stats_rules import (
    SessionSet,
    check_period,
    personal_records,
    session_metrics,
    weekly_frequency,
)


def local_day(column):
    return sa.func.date(sa.func.timezone(settings.app_timezone, column))


async def count_finished(db: AsyncSession, user: User) -> GymCountOut:
    ensure_permission(user, Permission.workouts)
    finished = await db.scalar(
        sa.select(sa.func.count())
        .select_from(Workout)
        .where(Workout.user_id == user.id, Workout.status == WorkoutStatus.finished)
    )
    return GymCountOut(finished=finished or 0)


async def period_stats(
    db: AsyncSession, user: User, start: date, end: date
) -> GymStatsOut:
    ensure_permission(user, Permission.workouts)
    check_period(start, end)

    day_column = local_day(Workout.started_at)
    workout_rows = (
        await db.execute(
            sa.select(
                Workout.id,
                day_column.label("day"),
                Workout.started_at,
                Workout.finished_at,
            ).where(
                Workout.user_id == user.id,
                Workout.status == WorkoutStatus.finished,
                day_column >= start,
                day_column <= end,
            )
        )
    ).all()

    volume = await db.scalar(
        sa.select(sa.func.coalesce(sa.func.sum(WorkoutSet.weight_kg * WorkoutSet.reps), 0))
        .select_from(WorkoutSet)
        .join(WorkoutExercise, WorkoutExercise.id == WorkoutSet.workout_exercise_id)
        .join(Workout, Workout.id == WorkoutExercise.workout_id)
        .where(
            Workout.user_id == user.id,
            Workout.status == WorkoutStatus.finished,
            local_day(Workout.started_at) >= start,
            local_day(Workout.started_at) <= end,
            WorkoutSet.completed_at.is_not(None),
            WorkoutSet.weight_kg.is_not(None),
            WorkoutSet.reps.is_not(None),
        )
    )

    workout_count = len(workout_rows)
    avg_duration = None
    if workout_rows:
        duration_seconds = sum(
            (row.finished_at - row.started_at).total_seconds() for row in workout_rows
        )
        avg_duration = round(duration_seconds / workout_count / 60)

    return GymStatsOut(
        start=start,
        end=end,
        workouts=workout_count,
        volume_kg=float(volume or 0),
        avg_duration_min=avg_duration,
        weeks=[
            GymWeekOut(week_start=week_start, workouts=count)
            for week_start, count in weekly_frequency(
                [row.day for row in workout_rows], start, end
            )
        ],
    )


async def performed_exercises(
    db: AsyncSession, user: User
) -> list[PerformedExerciseOut]:
    ensure_permission(user, Permission.workouts)
    day_column = local_day(Workout.started_at)
    rows = (
        await db.execute(
            sa.select(
                Exercise.id,
                Exercise.name,
                Exercise.tracking,
                Exercise.source,
                sa.func.max(Workout.started_at).label("latest_started"),
                sa.func.max(day_column).label("last_date"),
            )
            .join(WorkoutExercise, WorkoutExercise.exercise_id == Exercise.id)
            .join(Workout, Workout.id == WorkoutExercise.workout_id)
            .where(
                Workout.user_id == user.id,
                Workout.status == WorkoutStatus.finished,
                sa.or_(Exercise.source == "catalog", Exercise.owner_user_id == user.id),
            )
            .group_by(Exercise.id)
            .order_by(sa.func.max(Workout.started_at).desc(), Exercise.name)
        )
    ).all()
    return [
        PerformedExerciseOut(
            exercise_id=row.id,
            name=row.name,
            tracking=row.tracking,
            custom=row.source == "custom",
            last_date=row.last_date,
        )
        for row in rows
    ]


async def exercise_progress(
    db: AsyncSession, user: User, exercise_id: int, start: date, end: date
) -> ExerciseProgressOut:
    ensure_permission(user, Permission.workouts)
    check_period(start, end)
    exercise = (await exercise_service.get_visible_exercises(db, user, [exercise_id]))[
        exercise_id
    ]
    day_column = local_day(Workout.started_at)
    rows = (
        await db.execute(
            sa.select(
                day_column.label("day"),
                Workout.id.label("workout_id"),
                WorkoutExercise.position.label("exercise_position"),
                WorkoutSet.position.label("set_position"),
                WorkoutSet.weight_kg,
                WorkoutSet.reps,
                WorkoutSet.duration_s,
            )
            .select_from(WorkoutSet)
            .join(WorkoutExercise, WorkoutExercise.id == WorkoutSet.workout_exercise_id)
            .join(Workout, Workout.id == WorkoutExercise.workout_id)
            .where(
                Workout.user_id == user.id,
                Workout.status == WorkoutStatus.finished,
                WorkoutExercise.exercise_id == exercise_id,
                WorkoutSet.completed_at.is_not(None),
            )
            .order_by(day_column, Workout.id, WorkoutExercise.position, WorkoutSet.position)
        )
    ).all()

    sessions: dict[int, tuple[date, list[SessionSet], list[str]]] = {}
    for row in rows:
        if row.workout_id not in sessions:
            sessions[row.workout_id] = (row.day, [], [])
        _, sets, formatted = sessions[row.workout_id]
        sets.append(SessionSet(row.weight_kg, row.reps, row.duration_s))
        values: SetTuple = (row.weight_kg, row.reps, row.duration_s)
        formatted.append(format_set(exercise.tracking, values))

    all_sessions = [
        (session_date, workout_id, sets, formatted)
        for workout_id, (session_date, sets, formatted) in sessions.items()
    ]
    records = personal_records(
        exercise.tracking,
        [(session_date, sets) for session_date, _, sets, _ in all_sessions],
    )
    period_sessions = [
        (session_date, workout_id, sets, formatted)
        for session_date, workout_id, sets, formatted in all_sessions
        if start <= session_date <= end
    ]
    period_sessions.sort(key=lambda session: (session[0], session[1]), reverse=True)

    return ExerciseProgressOut(
        exercise_id=exercise.id,
        name=exercise.name,
        tracking=exercise.tracking,
        start=start,
        end=end,
        sessions=[
            ProgressSessionOut(
                date=session_date,
                workout_id=workout_id,
                metrics=session_metrics(exercise.tracking, sets),
                sets=formatted,
            )
            for session_date, workout_id, sets, formatted in period_sessions
        ],
        records=[RecordOut(kind=record.kind, value=record.value, date=record.date) for record in records],
    )
