"""MCP tools for reading and writing the user's food diary."""

import datetime as dt
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, Field

from app.mcp.context import today, tool_scope
from app.mcp.format import day_payload, entry_payload, week_payload
from app.models.diary import Meal
from app.schemas.diary import DiaryCopyRequest, DiaryEntryCreate, DiaryEntryPatch
from app.services import diary_ops

MealName = Literal["breakfast", "lunch", "dinner", "snack"]
Grams = Annotated[float, Field(gt=0, le=5000, description="Grams of food eaten")]
MEAL_HELP = "Meal: breakfast = colazione, lunch = pranzo, dinner = cena, snack = spuntino."


class EntryInput(BaseModel):
    meal: MealName
    food_id: int
    grams: Grams
    date: dt.date | None = Field(default=None, description="ISO date; defaults to today")


def _create(entry: EntryInput) -> DiaryEntryCreate:
    return DiaryEntryCreate(
        date=entry.date or today(), meal=Meal(entry.meal), food_id=entry.food_id, grams=entry.grams
    )


def register_diary_tools(server: MCPServer) -> None:
    @server.tool(description=(
        "The user's diary for one day: entries per meal (with entry_id), meal and day "
        "totals, the active goal and what remains (goal minus eaten; negative = over). "
        "Values are scaled to the logged grams."
    ))
    async def get_day(date: dt.date | None = None) -> dict[str, Any]:
        async with tool_scope() as scope:
            return day_payload(await diary_ops.get_day(scope.db, scope.user, date or today()))

    @server.tool(description="Daily totals for the Monday-to-Sunday week containing `date`.")
    async def get_week(date: dt.date | None = None) -> dict[str, Any]:
        day = date or today()
        start = day - dt.timedelta(days=day.weekday())
        async with tool_scope() as scope:
            return week_payload(await diary_ops.get_week(scope.db, scope.user, start))

    @server.tool(description=f"Log one food into the diary. {MEAL_HELP}")
    async def add_diary_entry(
        meal: MealName, food_id: int, grams: Grams, date: dt.date | None = None
    ) -> dict[str, Any]:
        payload = _create(EntryInput(meal=meal, food_id=food_id, grams=grams, date=date))
        async with tool_scope() as scope:
            entry = await diary_ops.create_entry(scope.db, scope.user, payload)
            await scope.audit("add_diary_entry", {"entry_id": entry.id})
            return entry_payload(entry)

    @server.tool(description=(
        f"Log up to 30 foods at once (e.g. a whole meal plan). All or nothing: if any "
        f"food_id is unknown, nothing is logged. {MEAL_HELP}"
    ))
    async def add_diary_entries(
        entries: Annotated[list[EntryInput], Field(min_length=1, max_length=30)],
    ) -> dict[str, Any]:
        payloads = [_create(entry) for entry in entries]
        async with tool_scope() as scope:
            created = await diary_ops.create_entries(scope.db, scope.user, payloads)
            await scope.audit("add_diary_entries", {"count": len(created)})
            return {"entries": [entry_payload(entry) for entry in created]}

    @server.tool(description=f"Change the grams and/or move a diary entry to another meal. {MEAL_HELP}")
    async def update_diary_entry(
        entry_id: int, grams: Grams | None = None, meal: MealName | None = None
    ) -> dict[str, Any]:
        if grams is None and meal is None:
            raise ToolError("Nothing to update: pass grams and/or meal")
        patch = DiaryEntryPatch(grams=grams, meal=Meal(meal) if meal else None)
        async with tool_scope() as scope:
            entry = await diary_ops.update_entry(scope.db, scope.user, entry_id, patch)
            await scope.audit("update_diary_entry", {"entry_id": entry_id})
            return entry_payload(entry)

    @server.tool(description="Delete one diary entry by entry_id.")
    async def delete_diary_entry(entry_id: int) -> dict[str, Any]:
        async with tool_scope() as scope:
            await diary_ops.delete_entry(scope.db, scope.user, entry_id)
            await scope.audit("delete_diary_entry", {"entry_id": entry_id})
            return {"deleted": True}

    @server.tool(description=(
        "Copy entries from source dates in ascending order onto consecutive days starting at "
        "target_start (source day i goes to target_start + i). mode 'append' keeps what "
        "is already there, 'replace' first clears the copied meals on the target days. "
        f"Optionally only some meals. {MEAL_HELP}"
    ))
    async def copy_days(
        source_dates: Annotated[list[dt.date], Field(min_length=1, max_length=31)],
        target_start: dt.date,
        meals: list[MealName] | None = None,
        mode: Literal["append", "replace"] = "append",
    ) -> dict[str, Any]:
        payload = DiaryCopyRequest(
            source_dates=source_dates, target_start=target_start,
            meals=[Meal(m) for m in meals] if meals else None, mode=mode,
        )
        async with tool_scope() as scope:
            result = await diary_ops.copy_days(scope.db, scope.user, payload)
            await scope.audit("copy_days", {"entries_created": result.entries_created})
            return {
                "entries_created": result.entries_created,
                "days": [
                    {"date": d.date.isoformat(), "entries_created": d.entries_created}
                    for d in result.days
                ],
            }
