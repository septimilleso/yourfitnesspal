from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.routers import auth, foods
from app.security import verify_session_cookie

app = FastAPI(title="YourFitnessPal API")

app.include_router(auth.router)
app.include_router(foods.router)

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
