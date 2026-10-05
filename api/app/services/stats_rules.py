"""Pure rules for weight and gym statistics, shared by REST and MCP services."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from decimal import InvalidOperation as DecimalInvalidOperation
from typing import Any

from app.models.exercise import Tracking
from app.services.errors import Invalid

MAX_RANGE_DAYS = 366
WEIGHT_MIN = Decimal("20.0")
WEIGHT_MAX = Decimal("400.0")
_ONE_DECIMAL = Decimal("0.1")


def check_period(start: date, end: date) -> None:
    if end < start:
        raise Invalid("end must not be before start")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise Invalid(f"range must not exceed {MAX_RANGE_DAYS} days")


def parse_weight(value: Any) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise Invalid("weight must be a number")
    try:
        number = Decimal(str(value).replace(",", ".") if isinstance(value, str) else str(value))
        if not number.is_finite():
            raise DecimalInvalidOperation
        rounded = number.quantize(_ONE_DECIMAL, rounding=ROUND_HALF_UP)
    except (DecimalInvalidOperation, ValueError):
        raise Invalid("weight must be a number") from None
    if rounded < WEIGHT_MIN or rounded > WEIGHT_MAX:
        raise Invalid("weight must be between 20.0 and 400.0 kg")
    return rounded


def _round_one(value: Decimal | float) -> float:
    return float(Decimal(str(value)).quantize(_ONE_DECIMAL, rounding=ROUND_HALF_UP))


def epley_1rm(weight: float | Decimal | None, reps: int | None) -> float | None:
    if weight is None or reps is None or weight <= 0 or reps <= 0:
        return None
    estimate = Decimal(str(weight)) if reps == 1 else Decimal(str(weight)) * (
        Decimal(1) + Decimal(reps) / Decimal(30)
    )
    return _round_one(estimate)


def iso_weeks(start: date, end: date) -> list[date]:
    if end < start:
        return []
    monday = start - timedelta(days=start.weekday())
    last_monday = end - timedelta(days=end.weekday())
    weeks = []
    while monday <= last_monday:
        weeks.append(monday)
        monday += timedelta(days=7)
    return weeks


def weekly_frequency(
    workout_days: Sequence[date], start: date, end: date
) -> list[tuple[date, int]]:
    counts = {week: 0 for week in iso_weeks(start, end)}
    for day in workout_days:
        if start <= day <= end:
            week = day - timedelta(days=day.weekday())
            if week in counts:
                counts[week] += 1
    return list(counts.items())


def moving_average_7d(weights: dict[date, Decimal], day: date) -> float | None:
    values = [weights[d] for d in (day - timedelta(days=offset) for offset in range(7)) if d in weights]
    if not values:
        return None
    return _round_one(sum(values, Decimal(0)) / len(values))


@dataclass(frozen=True)
class WeekAverage:
    week_start: date
    avg_kg: float | None
    count: int
    change_kg: float | None


def weekly_weight_averages(
    weights: dict[date, Decimal], start: date, end: date
) -> list[WeekAverage]:
    weeks = iso_weeks(start, end)
    if not weeks:
        return []
    averages: dict[date, tuple[float | None, int]] = {}
    all_weeks = [weeks[0] - timedelta(days=7), *weeks]
    for week_start in all_weeks:
        values = [
            weights[week_start + timedelta(days=offset)]
            for offset in range(7)
            if week_start + timedelta(days=offset) in weights
        ]
        average = _round_one(sum(values, Decimal(0)) / len(values)) if values else None
        averages[week_start] = (average, len(values))

    result = []
    for week_start in weeks:
        average, count = averages[week_start]
        previous = averages[week_start - timedelta(days=7)][0]
        change = _round_one(average - previous) if average is not None and previous is not None else None
        result.append(WeekAverage(week_start, average, count, change))
    return result


@dataclass(frozen=True)
class SessionSet:
    weight_kg: float | Decimal | None
    reps: int | None
    duration_s: int | None


@dataclass(frozen=True)
class Record:
    kind: str
    value: float | int
    date: date


def _volume(sets: Sequence[SessionSet]) -> float:
    volume = sum(
        (Decimal(str(item.weight_kg)) * item.reps
         for item in sets if item.weight_kg is not None and item.reps is not None),
        Decimal(0),
    )
    return _round_one(volume)


def _maximum(values: Sequence[float | Decimal | int | None]) -> float | int | None:
    present = [value for value in values if value is not None]
    return max(present) if present else None


def _is_weighted(item: SessionSet) -> bool:
    return item.weight_kg is not None and item.weight_kg > 0


def session_metrics(tracking: Tracking, sets: Sequence[SessionSet]) -> dict[str, float | int]:
    metrics: dict[str, float | int] = {}
    if tracking is Tracking.weight_reps:
        max_weight = _maximum([item.weight_kg if _is_weighted(item) else None for item in sets])
        max_1rm = _maximum([epley_1rm(item.weight_kg, item.reps) for item in sets])
        if max_weight is not None:
            metrics["max_weight_kg"] = float(max_weight)
        if max_1rm is not None:
            metrics["max_1rm_kg"] = float(max_1rm)
        metrics["volume_kg"] = _volume(sets)
    elif tracking is Tracking.reps:
        max_reps = _maximum([item.reps for item in sets])
        total_reps = sum(item.reps for item in sets if item.reps is not None)
        if max_reps is not None:
            metrics["max_reps"] = int(max_reps)
        metrics["total_reps"] = total_reps
        if any(_is_weighted(item) for item in sets):
            max_weight = _maximum([item.weight_kg if _is_weighted(item) else None for item in sets])
            metrics["max_weight_kg"] = float(max_weight) if max_weight is not None else 0.0
            metrics["volume_kg"] = _volume(sets)
    elif tracking is Tracking.duration:
        durations = [item.duration_s for item in sets if item.duration_s is not None]
        if durations:
            metrics["max_duration_s"] = max(durations)
        metrics["total_duration_s"] = sum(durations)
    return metrics


def personal_records(
    tracking: Tracking, sessions: list[tuple[date, list[SessionSet]]]
) -> list[Record]:
    kinds = {
        Tracking.weight_reps: ("max_weight_kg", "max_1rm_kg", "max_reps"),
        Tracking.reps: ("max_reps", "max_weight_kg"),
        Tracking.duration: ("max_duration_s",),
    }[tracking]
    best: dict[str, Record] = {}
    for session_date, sets in sessions:
        metrics = session_metrics(tracking, sets)
        for kind in kinds:
            value = metrics.get(kind)
            if tracking is Tracking.weight_reps and kind == "max_reps":
                value = _maximum([item.reps for item in sets])
            if value is None:
                continue
            current = best.get(kind)
            if current is None or value > current.value or (
                value == current.value and session_date < current.date
            ):
                best[kind] = Record(kind, value, session_date)
    return [best[kind] for kind in kinds if kind in best]
