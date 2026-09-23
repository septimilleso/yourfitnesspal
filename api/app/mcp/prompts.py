"""MCP prompts: reusable conversation starters offered to the user."""

from mcp.server.mcpserver import MCPServer


def register_prompts(server: MCPServer) -> None:
    @server.prompt(description="Plan the rest of a day's meals to hit the nutrition goal.")
    def plan_my_day(date: str | None = None) -> str:
        day = date or "today"
        return (
            f"Help me plan my meals for {day}.\n"
            f"1. Call get_goal and get_day for {day} to see my goal and what I already ate.\n"
            "2. Use get_recent_foods and search_foods to pick foods I actually eat.\n"
            "3. Propose the missing meals with grams so the day lands close to my kcal and "
            "macro targets, and show the resulting totals.\n"
            "4. Wait for my confirmation, then log everything with a single "
            "add_diary_entries call."
        )
