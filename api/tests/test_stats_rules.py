"""Pure statistics rules (DB-free)."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.models.exercise import Tracking
from app.services.errors import Invalid
from app.services.stats_rules import (
    SessionSet,
    check_period,
    epley_1rm,
    iso_weeks,
    moving_average_7d,
    parse_weight,
    personal_records,
    session_metrics,
    weekly_frequency,
    weekly_weight_averages,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [("78,4", Decimal("78.4")), (78.46, Decimal("78.5")), (20, Decimal("20.0")),
     (400, Decimal("400.0"))],
)
def test_parse_weight_valid(value, expected) -> None:
    assert parse_weight(value) == expected


@pytest.mark.parametrize("value", [19.9, 400.1])
def test_parse_weight_out_of_range(value) -> None:
    with pytest.raises(Invalid):
        parse_weight(value)


@pytest.mark.parametrize("value", ["abc", True, None])
def test_parse_weight_not_a_number(value) -> None:
    with pytest.raises(Invalid, match="weight must be a number"):
        parse_weight(value)


def test_check_period() -> None:
    start = date(2026, 1, 1)
    check_period(start, date(2027, 1, 1))  # 366 days, inclusive
    with pytest.raises(Invalid, match="end must not be before start"):
        check_period(start, start - timedelta(days=1))
    with pytest.raises(Invalid, match="range must not exceed 366 days"):
        check_period(start, date(2027, 1, 2))


@pytest.mark.parametrize(
    ("weight", "reps", "expected"),
    [(100, 5, 116.7), (105, 1, 105.0), (0, 5, None), (100, 0, None), (None, 5, None),
     (100, None, None)],
)
def test_epley_1rm(weight, reps, expected) -> None:
    assert epley_1rm(weight, reps) == expected


def test_iso_weeks_and_frequency_include_empty_weeks() -> None:
    start, end = date(2026, 9, 28), date(2026, 10, 18)
    weeks = [date(2026, 9, 28), date(2026, 10, 5), date(2026, 10, 12)]
    assert iso_weeks(start, end) == weeks
    assert weekly_frequency([date(2026, 9, 29), date(2026, 10, 1), date(2026, 10, 14)], start, end) == [
        (weeks[0], 2), (weeks[1], 0), (weeks[2], 1)
    ]


def test_moving_average_7d_uses_present_weights_inclusive_window() -> None:
    weights = {
        date(2026, 10, 1): Decimal("70.0"),
        date(2026, 10, 3): Decimal("72.0"),
        date(2026, 10, 8): Decimal("74.0"),
    }
    assert moving_average_7d(weights, date(2026, 10, 7)) == 71.0
    assert moving_average_7d(weights, date(2026, 10, 8)) == 73.0
    assert moving_average_7d(weights, date(2026, 10, 10)) == 74.0
    assert moving_average_7d(weights, date(2026, 10, 17)) is None


def test_weekly_weight_averages_use_full_iso_weeks_and_previous_week() -> None:
    weights = {
        date(2026, 9, 28): Decimal("70.0"),
        date(2026, 9, 30): Decimal("72.0"),
        date(2026, 10, 5): Decimal("73.0"),
        date(2026, 10, 12): Decimal("74.0"),
    }
    weeks = weekly_weight_averages(weights, date(2026, 10, 6), date(2026, 10, 13))
    assert [(week.week_start, week.avg_kg, week.count, week.change_kg) for week in weeks] == [
        (date(2026, 10, 5), 73.0, 1, 2.0),
        (date(2026, 10, 12), 74.0, 1, 1.0),
    ]

    no_previous = weekly_weight_averages(
        {date(2026, 10, 5): Decimal("73.0")}, date(2026, 10, 5), date(2026, 10, 11)
    )
    assert no_previous[0].change_kg is None


def _set(weight=None, reps=None, duration=None) -> SessionSet:
    return SessionSet(weight_kg=weight, reps=reps, duration_s=duration)


def test_session_metrics_for_weight_reps() -> None:
    assert session_metrics(Tracking.weight_reps, [_set(100, 5), _set(80, 8)]) == {
        "max_weight_kg": 100.0, "max_1rm_kg": 116.7, "volume_kg": 1140.0,
    }


def test_session_metrics_for_reps_and_duration() -> None:
    assert session_metrics(Tracking.reps, [_set(reps=5), _set(10, 8)]) == {
        "max_reps": 8, "total_reps": 13, "max_weight_kg": 10.0, "volume_kg": 80.0,
    }
    assert session_metrics(Tracking.reps, [_set(reps=5), _set(reps=8)]) == {
        "max_reps": 8, "total_reps": 13,
    }
    assert session_metrics(Tracking.duration, [_set(duration=60), _set(duration=90)]) == {
        "max_duration_s": 90, "total_duration_s": 150,
    }


def test_personal_records_across_tracking_and_ties_use_first_date() -> None:
    sessions = [
        (date(2026, 10, 2), [_set(100, 5), _set(80, 8)]),
        (date(2026, 10, 5), [_set(105, 1)]),
        (date(2026, 10, 9), [_set(105, 1)]),
    ]
    records = personal_records(Tracking.weight_reps, sessions)
    assert [(r.kind, r.value, r.date) for r in records] == [
        ("max_weight_kg", 105.0, date(2026, 10, 5)),
        ("max_1rm_kg", 116.7, date(2026, 10, 2)),
        ("max_reps", 8, date(2026, 10, 2)),
    ]
    assert [(r.kind, r.value, r.date) for r in personal_records(
        Tracking.reps, [(date(2026, 10, 2), [_set(reps=5), _set(10, 8)])]
    )] == [
        ("max_reps", 8, date(2026, 10, 2)), ("max_weight_kg", 10.0, date(2026, 10, 2)),
    ]
    assert [(r.kind, r.value, r.date) for r in personal_records(
        Tracking.duration, [(date(2026, 10, 2), [_set(duration=60), _set(duration=90)])]
    )] == [("max_duration_s", 90, date(2026, 10, 2))]


def test_nonpositive_weight_is_not_a_load_or_resistance() -> None:
    zero_and_negative = [_set(0, 8), _set(-5, 10)]
    weighted_metrics = session_metrics(Tracking.weight_reps, zero_and_negative)
    assert "max_weight_kg" not in weighted_metrics
    assert "max_1rm_kg" not in weighted_metrics
    assert session_metrics(Tracking.reps, zero_and_negative) == {
        "max_reps": 10, "total_reps": 18,
    }
    assert [(record.kind, record.value) for record in personal_records(
        Tracking.weight_reps, [(date(2026, 10, 2), zero_and_negative)]
    )] == [("max_reps", 10)]
    assert [(record.kind, record.value) for record in personal_records(
        Tracking.reps, [(date(2026, 10, 2), zero_and_negative)]
    )] == [("max_reps", 10)]
