"""Pure streak computation (no database)."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services import activity
from app.services.activity import Streak, compute_streak

TODAY = date(2026, 9, 25)


def days_ago(*offsets: int) -> list[date]:
    return [TODAY - timedelta(days=n) for n in offsets]


def test_local_today_uses_app_timezone(monkeypatch: pytest.MonkeyPatch) -> None:
    for timezone in ("Pacific/Kiritimati", "Pacific/Pago_Pago"):
        monkeypatch.setattr(activity.settings, "app_timezone", timezone)
        assert activity.local_today() == datetime.now(ZoneInfo(timezone)).date()


def test_no_days() -> None:
    assert compute_streak([], TODAY) == Streak(current=0, best=0)


def test_only_today() -> None:
    assert compute_streak(days_ago(0), TODAY) == Streak(current=1, best=1)


def test_run_ending_today() -> None:
    assert compute_streak(days_ago(0, 1, 2), TODAY) == Streak(current=3, best=3)


def test_run_ending_yesterday_still_counts() -> None:
    assert compute_streak(days_ago(1, 2), TODAY) == Streak(current=2, best=2)


def test_gap_before_yesterday_resets_current() -> None:
    assert compute_streak(days_ago(2, 3, 4), TODAY) == Streak(current=0, best=3)


def test_gap_splits_runs_and_best_is_longest() -> None:
    days = days_ago(0, 1, 5, 6, 7, 8)
    assert compute_streak(days, TODAY) == Streak(current=2, best=4)


def test_unsorted_duplicates_and_future_days_are_ignored() -> None:
    days = [*days_ago(1, 0, 0), TODAY + timedelta(days=1)]
    assert compute_streak(days, TODAY) == Streak(current=2, best=2)
