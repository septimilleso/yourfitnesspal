"""MCP tools for finding foods and creating custom ones."""

from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from app.mcp.context import off_client, tool_scope
from app.mcp.format import food_payload
from app.schemas.food import CustomFoodCreate, Nutriments
from app.services import foods

Per100g = Annotated[float, Field(ge=0, le=1000)]
Grams100 = Annotated[float, Field(ge=0, le=100)]


def register_food_tools(server: MCPServer) -> None:
    @server.tool(description=(
        "Search foods by name or brand. Looks at the user's own history and the local "
        "cache first, then OpenFoodFacts. Use the returned food_id with add_diary_entry. "
        "Nutrient values are per 100 g."
    ))
    async def search_foods(
        query: Annotated[str, Field(min_length=1, max_length=100)],
        limit: Annotated[int, Field(ge=1, le=20)] = 10,
    ) -> dict[str, Any]:
        async with tool_scope() as scope:
            result = await foods.search_foods(scope.db, off_client(), scope.user, query, limit)
            return {
                "results": [food_payload(item) for item in result.results],
                "openfoodfacts_unavailable": result.off_unavailable,
                "openfoodfacts_disabled": result.off_disabled,
            }

    @server.tool(description="Look up a packaged food by its EAN/UPC barcode. Nutrients per 100 g.")
    async def get_food_by_barcode(
        barcode: Annotated[str, Field(pattern=r"^\d{6,14}$")],
    ) -> dict[str, Any]:
        async with tool_scope() as scope:
            return food_payload(
                await foods.get_by_barcode(scope.db, off_client(), scope.user, barcode)
            )

    @server.tool(description=(
        "Foods the user logged recently, most recent first. Good starting point for "
        "habitual meals. Nutrients per 100 g."
    ))
    async def get_recent_foods(limit: Annotated[int, Field(ge=1, le=20)] = 10) -> dict[str, Any]:
        async with tool_scope() as scope:
            result = await foods.recent_foods(scope.db, scope.user, limit)
            return {"results": [food_payload(item) for item in result.results]}

    @server.tool(description=(
        "Create a private custom food from a nutrition label. All values are per 100 g. "
        "Only use when search_foods cannot find the food."
    ))
    async def create_custom_food(
        name: Annotated[str, Field(min_length=1, max_length=255)],
        kcal: Per100g,
        protein_g: Grams100,
        carbs_g: Grams100,
        fat_g: Grams100,
        brand: Annotated[str | None, Field(max_length=255)] = None,
        sugars_g: Grams100 = 0,
        sat_fat_g: Grams100 = 0,
        fiber_g: Grams100 = 0,
        salt_g: Grams100 = 0,
    ) -> dict[str, Any]:
        payload = CustomFoodCreate(
            name=name,
            brand=brand,
            nutriments=Nutriments(
                kcal=kcal,
                protein_g=protein_g,
                carbs_g=carbs_g,
                sugars_g=sugars_g,
                fat_g=fat_g,
                sat_fat_g=sat_fat_g,
                fiber_g=fiber_g,
                salt_g=salt_g,
            ),
        )
        async with tool_scope() as scope:
            food = await foods.create_custom_food(scope.db, scope.user, payload)
            await scope.audit("create_custom_food", {"food_id": food.id})
            return food_payload(food)
