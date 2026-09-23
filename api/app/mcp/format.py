"""Compact JSON shapes the MCP tools return to the assistant.

Only the four headline macros are exposed and every number is rounded to
one decimal: the assistant needs readable totals, not the full nutriment
dict.
"""

from collections.abc import Mapping
from typing import Any

from app.models.food import Food
from app.models.goal import Goal
from app.schemas.diary import DayResponse, DiaryEntryOut, GoalOut, WeekResponse
from app.schemas.food import FoodSearchItem
from app.services.diary import scale_nutriments

MACROS = ("kcal", "protein_g", "carbs_g", "fat_g")


def _r(value: Any) -> float:
    return round(float(value or 0), 1)


def macros(values: Mapping[str, Any]) -> dict[str, float]:
    return {key: _r(values.get(key)) for key in MACROS}


def food_payload(food: Food | FoodSearchItem) -> dict:
    nutriments = food.nutriments if isinstance(food.nutriments, Mapping) else food.nutriments.model_dump()
    return {
        "food_id": food.id,
        "name": food.name,
        "brand": food.brand,
        "serving_size_g": _r(food.serving_size_g) if food.serving_size_g is not None else None,
        "per_100g": macros(nutriments),
    }


def entry_payload(entry: DiaryEntryOut) -> dict:
    name = f"{entry.food_name} ({entry.food_brand})" if entry.food_brand else entry.food_name
    return {
        "entry_id": entry.id,
        "date": entry.date.isoformat(),
        "meal": entry.meal.value,
        "food_id": entry.food_id,
        "food": name,
        "grams": _r(entry.grams),
        **macros(scale_nutriments(entry.nutriments_snapshot, float(entry.grams))),
    }


def goal_payload(goal: Goal | GoalOut | None) -> dict | None:
    if goal is None:
        return None
    return {**macros({k: getattr(goal, k) for k in MACROS}), "valid_from": goal.valid_from.isoformat()}


def day_payload(day: DayResponse) -> dict:
    return {
        "date": day.date.isoformat(),
        "meals": {meal: [entry_payload(e) for e in entries] for meal, entries in day.entries.items()},
        "meal_totals": {meal: macros(t.model_dump()) for meal, t in day.totals.by_meal.items()},
        "total": macros(day.totals.total.model_dump()),
        "goal": goal_payload(day.goal),
        # goal minus eaten: positive = room left, negative = over.
        "remaining": macros(day.delta.model_dump()) if day.delta else None,
    }


def week_payload(week: WeekResponse) -> dict:
    return {
        "start": week.start.isoformat(),
        "end": week.end.isoformat(),
        "days": [{"date": d.date.isoformat(), **macros(d.total.model_dump())} for d in week.days],
    }
