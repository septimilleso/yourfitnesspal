"""Read-only MCP tools for weight and gym statistics."""

from datetime import date, timedelta
from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from app.mcp.context import today, tool_scope
from app.services import gym_stats, weights


def register_stats_tools(server: MCPServer) -> None:
    @server.tool(description=(
        "Read the user's weight history for an inclusive date range. Returns start and end; days "
        "contains each date, the weight record id (id, null without a weigh-in), weight_kg "
        "(null when no weight was logged), and avg_7d_kg (the 7-day moving average). weeks "
        "contains ISO-week averages with week_start, avg_kg, number of weigh-ins (count), and "
        "change_kg versus the prior ISO week; avg_kg and change_kg are null when unavailable. "
        "Defaults to the last 30 days through today; the range may not exceed 366 days."
    ))
    async def get_weight_history(
        start: Annotated[date | None, Field(description=(
            "Inclusive start date in ISO format (YYYY-MM-DD); defaults to end minus 29 days."
        ))] = None,
        end: Annotated[date | None, Field(description=(
            "Inclusive end date in ISO format (YYYY-MM-DD); defaults to today in the app timezone."
        ))] = None,
    ) -> dict[str, Any]:
        end = end or today()
        start = start or end - timedelta(days=29)
        async with tool_scope() as scope:
            result = await weights.weight_history(scope.db, scope.user, start, end)
            return result.model_dump(mode="json")

    @server.tool(description=(
        "Read the user's gym statistics for an inclusive date range. Returns start, end, "
        "finished workout count (workouts), total completed-set volume in kg (volume_kg), "
        "average workout duration in whole minutes (avg_duration_min), and ISO-week workout "
        "counts (weeks: week_start and workouts). Defaults to the last 30 days through today; "
        "the range may not exceed 366 days. Requires the workouts.use permission."
    ))
    async def get_gym_stats(
        start: Annotated[date | None, Field(description=(
            "Inclusive start date in ISO format (YYYY-MM-DD); defaults to end minus 29 days."
        ))] = None,
        end: Annotated[date | None, Field(description=(
            "Inclusive end date in ISO format (YYYY-MM-DD); defaults to today in the app timezone."
        ))] = None,
    ) -> dict[str, Any]:
        end = end or today()
        start = start or end - timedelta(days=29)
        async with tool_scope() as scope:
            result = await gym_stats.period_stats(scope.db, scope.user, start, end)
            return result.model_dump(mode="json")

    @server.tool(description=(
        "Read one exercise's gym progression for an inclusive date range. Returns exercise_id, "
        "name and tracking type; sessions contain date, workout_id, tracking-specific metrics "
        "and formatted sets. weight_reps metrics are max_weight_kg, max_1rm_kg (Epley estimated "
        "one-rep max) and volume_kg; reps metrics are max_reps and total_reps, plus max_weight_kg "
        "and volume_kg when weighted; duration metrics are max_duration_s and total_duration_s. "
        "records contains all-time personal records with kind, value and date. Defaults to the "
        "last 90 days through today; the range may not exceed 366 days. Requires the "
        "workouts.use permission."
    ))
    async def get_exercise_progress(
        exercise_id: Annotated[int, Field(description="ID of the exercise to read.")],
        start: Annotated[date | None, Field(description=(
            "Inclusive start date in ISO format (YYYY-MM-DD); defaults to end minus 89 days."
        ))] = None,
        end: Annotated[date | None, Field(description=(
            "Inclusive end date in ISO format (YYYY-MM-DD); defaults to today in the app timezone."
        ))] = None,
    ) -> dict[str, Any]:
        end = end or today()
        start = start or end - timedelta(days=89)
        async with tool_scope() as scope:
            result = await gym_stats.exercise_progress(
                scope.db, scope.user, exercise_id, start, end
            )
            return result.model_dump(mode="json")
