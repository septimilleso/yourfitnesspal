from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import JSONResponse

from app.auth.deps import get_current_user, require_admin
from app.auth.rate_limit import client_ip, consume
from app.mcp.context import set_off_client
from app.mcp.server import mcp_http_app, mcp_server
from app.routers import (
    admin,
    auth,
    diary,
    exercises,
    foods,
    oauth,
    push,
    stats,
    templates,
    workouts,
)
from app.services.errors import Invalid, NotFound, PermissionMissing
from app.services.off_client import OffClient
from app.services.rest_notifier import RestNotifier


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # A single OffClient lives for the whole process so its rate limiters
    # (15/min product, 10/min search) and httpx connection pool are shared
    # across every request -- see CRITICAL 1 of the final-review fixes.
    # Constructing a fresh OffClient per-request made the rate limiting
    # inert in production.
    app.state.off_client = OffClient()
    set_off_client(app.state.off_client)
    app.state.rest_notifier = RestNotifier()
    try:
        await app.state.rest_notifier.start()
        # The MCP SDK's session manager owns the task group /mcp runs in.
        async with mcp_server.session_manager.run():
            yield
    finally:
        await app.state.rest_notifier.stop()
        set_off_client(None)
        await app.state.off_client.aclose()


app = FastAPI(title="YourFitnessPal API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(NotFound)
async def _not_found(request: Request, exc: NotFound) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(Invalid)
async def _invalid(request: Request, exc: Invalid) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(PermissionMissing)
async def _permission_missing(request: Request, exc: PermissionMissing) -> JSONResponse:
    # Same body as the `require_permission` dependency's 403.
    return JSONResponse(status_code=403, content={"detail": "forbidden"})


app.include_router(auth.router)
app.include_router(oauth.router)
app.include_router(foods.router, dependencies=[Depends(get_current_user)])
app.include_router(diary.diary_router, dependencies=[Depends(get_current_user)])
app.include_router(diary.goals_router, dependencies=[Depends(get_current_user)])
app.include_router(exercises.router, dependencies=[Depends(get_current_user)])
app.include_router(templates.router, dependencies=[Depends(get_current_user)])
app.include_router(workouts.router, dependencies=[Depends(get_current_user)])
app.include_router(push.router, dependencies=[Depends(get_current_user)])
app.include_router(stats.router, dependencies=[Depends(get_current_user)])
app.include_router(admin.router, dependencies=[Depends(require_admin)])


@app.middleware("http")
async def csrf_protection(request: Request, call_next):
    if (
        request.method not in {"GET", "HEAD", "OPTIONS"}
        and request.url.path.startswith("/api/")
        and request.headers.get("X-Requested-With") != "yfp"
    ):
        return JSONResponse(status_code=403, content={"detail": "csrf"})
    return await call_next(request)


# Per-IP limits (requests/minute) on the unauthenticated OAuth endpoints the
# MCP SDK serves at the root.
OAUTH_RATE_LIMITS = {"/register": 10, "/token": 30, "/authorize": 30}


@app.middleware("http")
async def oauth_rate_limit(request: Request, call_next):
    limit = OAUTH_RATE_LIMITS.get(request.url.path)
    if limit is not None and consume(
        f"oauth:{request.url.path}", client_ip(request), limit=limit
    ):
        return JSONResponse(status_code=429, content={"error": "slow_down"})
    return await call_next(request)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health/protected", dependencies=[Depends(get_current_user)])
async def health_protected() -> dict[str, str]:
    """Dummy route used to verify the session-cookie middleware works."""
    return {"status": "ok"}


@app.get("/api/openapi.json", dependencies=[Depends(require_admin)], include_in_schema=False)
async def openapi() -> dict:
    return app.openapi()


@app.get("/api/docs", dependencies=[Depends(require_admin)], include_in_schema=False)
async def docs():
    return get_swagger_ui_html(openapi_url="/api/openapi.json", title="YourFitnessPal API")


# Must stay last: a mount at "/" catches every path no route above matched.
app.mount("/", mcp_http_app)
