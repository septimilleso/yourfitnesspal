"""MCP tools for the user's daily nutrition goal."""

import datetime as dt
from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from app.mcp.context import today, tool_scope
from app.mcp.format import goal_payload
from app.schemas.diary import GoalCreate
from app.services import goals

Macro = Annotated[float, Field(ge=0, le=1000)]


def register_goal_tools(server: MCPServer) -> None:
    @server.tool(description="The daily goal (kcal and macros in grams) active on `date`, or null.")
    async def get_goal(date: dt.date | None = None) -> dict[str, Any]:
        async with tool_scope() as scope:
            goal = await goals.active_goal(scope.db, scope.user.id, date or today())
            return {"goal": goal_payload(goal)}

    @server.tool(description=(
        "Set a new daily goal starting today (earlier days keep their old goal). "
        "Confirm the numbers with the user first."
    ))
    async def set_goal(
        kcal: Annotated[int, Field(ge=500, le=10000)],
        protein_g: Macro,
        carbs_g: Macro,
        fat_g: Macro,
    ) -> dict[str, Any]:
        payload = GoalCreate(kcal=kcal, protein_g=protein_g, carbs_g=carbs_g, fat_g=fat_g)
        async with tool_scope() as scope:
            goal = await goals.set_goal(scope.db, scope.user, payload, today())
            await scope.audit("set_goal", {"kcal": kcal})
            return {"goal": goal_payload(goal)}
