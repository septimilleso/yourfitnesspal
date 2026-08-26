from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.routers import auth, diary, foods
from app.security import verify_session_cookie
from app.services.off_client import OffClient


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # A single OffClient lives for the whole process so its rate limiters
    # (15/min product, 10/min search) and httpx connection pool are shared
    # across every request -- see CRITICAL 1 of the final-review fixes.
    # Constructing a fresh OffClient per-request made the rate limiting
    # inert in production.
    app.state.off_client = OffClient()
    try:
        yield
    finally:
        await app.state.off_client.aclose()


app = FastAPI(title="YourFitnessPal API", lifespan=lifespan)

app.include_router(auth.router)
app.include_router(foods.router)
app.include_router(diary.diary_router)
app.include_router(diary.goals_router)

# Paths reachable without a valid session cookie.
_PUBLIC_PATHS = {"/api/auth/login", "/api/health"}


@app.middleware("http")
async def require_session_cookie(request: Request, call_next):
    if request.url.path not in _PUBLIC_PATHS:
        token = request.cookies.get("session")
        if not token or not verify_session_cookie(token):
            return JSONResponse(status_code=401, content={"detail": "unauthorized"})
    return await call_next(request)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health/protected")
async def health_protected() -> dict[str, str]:
    """Dummy route used to verify the session-cookie middleware works."""
    return {"status": "ok"}
