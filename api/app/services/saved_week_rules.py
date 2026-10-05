"""Pure validation and planning rules for saved diary weeks."""

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from app.models.diary import Meal
from app.services.diary import compute_day_totals, plan_copy
from app.services.errors import Invalid

ANCHOR_MONDAY = date(2001, 1, 1)


@dataclass(frozen=True)
class _DiaryItem:
    """Saved-week item adapted to the interface used by diary rules."""

    food_id: int
    meal: Meal
    grams: float
    portion_label: str | None
    nutriments_snapshot: dict[str, Any]


def clean_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned or len(cleaned) > 100:
        raise Invalid("name must be between 1 and 100 characters")
    return cleaned


def ensure_monday(start: date) -> None:
    if start.weekday() != 0:
        raise Invalid("start must be a Monday")


def normalize_days(days: Sequence[int] | None) -> list[int]:
    if days is None:
        return list(range(7))
    if not days or any(type(day) is not int or not 0 <= day <= 6 for day in days):
        raise Invalid("days must contain values from 0 to 6")
    return sorted(set(days))


def _adapt_item(item: Any) -> _DiaryItem:
    return _DiaryItem(
        food_id=item.food_id,
        meal=item.meal,
        grams=item.grams,
        portion_label=item.portion_label,
        nutriments_snapshot=item.food.nutriments,
    )


def item_day_totals(items: Iterable[Any]) -> dict[int, dict[str, Any]]:
    by_day: dict[int, list[_DiaryItem]] = defaultdict(list)
    for item in items:
        by_day[item.day_index].append(_adapt_item(item))
    return {day_index: compute_day_totals(day_items) for day_index, day_items in by_day.items()}


def week_stats(items: Sequence[Any]) -> tuple[int, float]:
    totals = item_day_totals(items)
    if not totals:
        return 0, 0.0
    avg_kcal = sum(day["total"]["kcal"] for day in totals.values()) / len(totals)
    return len(items), avg_kcal


def plan_apply(
    items: Iterable[Any],
    days: Sequence[int],
    target_start: date,
    meals: Sequence[Meal] | None,
    mode: str,
) -> dict[str, Any]:
    entries_by_source_date: dict[date, list[_DiaryItem]] = defaultdict(list)
    for day in days:
        entries_by_source_date[ANCHOR_MONDAY + timedelta(days=day)]
    for item in items:
        source_date = ANCHOR_MONDAY + timedelta(days=item.day_index)
        entries_by_source_date[source_date].append(_adapt_item(item))

    source_dates = [ANCHOR_MONDAY + timedelta(days=day) for day in days]
    return plan_copy(
        source_dates=source_dates,
        target_start=target_start,
        meals=meals,
        mode=mode,
        entries_by_source_date=entries_by_source_date,
    )
