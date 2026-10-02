from datetime import date

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User
from app.models.workout import Workout, WorkoutExercise, WorkoutSet, WorkoutStatus
from app.permissions import Permission, ensure_permission
from app.schemas.stats import GymCountOut, GymStatsOut, GymWeekOut
from app.services.stats_rules import check_period, weekly_frequency


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
