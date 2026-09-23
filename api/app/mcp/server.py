"""The MCP server: tools over the user's diary, behind OAuth 2.1.

`mcp_http_app` is a Starlette app serving `/mcp` plus the OAuth endpoints
at the root; `app.main` mounts it at "/" (after every FastAPI route, so
`/api/*` keeps working) and runs `mcp_server.session_manager` in its
lifespan.
"""

from urllib.parse import urlsplit

from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

from app.config import settings
from app.mcp.oauth import PostgresOAuthProvider
from app.mcp.tools.foods import register_food_tools

INSTRUCTIONS = """\
YourFitnessPal is the user's personal food diary. Every tool acts only on the
signed-in user's own data.

- To log food: find it first (search_foods, get_recent_foods or
  get_food_by_barcode), then pass its food_id to add_diary_entry or, for a
  whole meal, add_diary_entries. Quantities are grams of food eaten.
- Nutrient values from food tools are per 100 g; diary tools return values
  already scaled to the logged grams.
- Meals: breakfast = colazione, lunch = pranzo, dinner = cena, snack = spuntino.
- Dates are ISO (YYYY-MM-DD); when omitted they default to today in the
  user's timezone.
- Before writing several entries, copying days or changing the goal, confirm
  the plan with the user.
"""


def _transport_security() -> TransportSecuritySettings:
    parts = urlsplit(settings.public_base_url)
    origin = f"{parts.scheme}://{parts.netloc}"
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[parts.netloc],
        allowed_origins=[origin, "https://claude.ai", "https://chatgpt.com"],
    )


def build_server() -> MCPServer:
    server = MCPServer(
        name="YourFitnessPal",
        instructions=INSTRUCTIONS,
        auth_server_provider=PostgresOAuthProvider(),
        auth=AuthSettings(
            issuer_url=settings.public_base_url.rstrip("/"),
            resource_server_url=settings.mcp_resource_url,
            client_registration_options=ClientRegistrationOptions(enabled=True),
            revocation_options=RevocationOptions(enabled=True),
            # Tokens are opaque rows only this server issues, for this one
            # resource; load_access_token already pins `resource`.
            validate_token_resource=False,
        ),
    )
    register_food_tools(server)
    return server


mcp_server = build_server()
mcp_http_app = mcp_server.streamable_http_app(
    streamable_http_path="/mcp",
    stateless_http=True,
    json_response=True,
    transport_security=_transport_security(),
    host="0.0.0.0",
)
