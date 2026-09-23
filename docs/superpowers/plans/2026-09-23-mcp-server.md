# Server MCP con OAuth 2.1 per utente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ogni utente abilitato (`mcp.access`) collega Claude.ai / ChatGPT a `https://<dominio>/mcp` con login password+TOTP e consenso, e l'assistente usa via MCP tutte le funzioni utente dell'app (alimenti, diario, copia giorni, obiettivi).

**Architecture:** SDK MCP ufficiale Python **v2** (`mcp>=2.2,<3`, classe `MCPServer` — *non* `FastMCP`, rimosso in v2) montato dentro l'app FastAPI esistente. L'SDK serve `/mcp` (streamable HTTP, stateless, JSON) e gli endpoint OAuth (`/register`, `/authorize`, `/token`, `/revoke`, `/.well-known/...`); noi implementiamo `PostgresOAuthProvider` (storage su 3 tabelle nuove) e la pagina di consenso nella SPA. La logica oggi nei router viene estratta in `app/services/` e condivisa tra REST e tool MCP.

**Tech Stack:** FastAPI, SQLAlchemy async + asyncpg, Alembic, Postgres 16, `mcp` 2.2 (`MCPServer`, `mcp.Client` in-memory per i test), pytest + pytest-asyncio; React 18 + TS, react-query, react-router 7, vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-mcp-server-design.md`

## Global Constraints

- Python ≥ 3.12; `ruff` con `line-length = 100` (config in `api/pyproject.toml`). Nuove dipendenze API: `mcp>=2.2,<3`, `tzdata>=2024.1` (necessaria per `zoneinfo` su Windows). Nessun container nuovo.
- API SDK MCP v2 (verificate su `mcp==2.2.0`): `from mcp.server.mcpserver import MCPServer`; `from mcp.server.mcpserver.exceptions import ToolError`; `from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions`; `from mcp.server.auth.provider import AccessToken, AuthorizationCode, AuthorizationParams, RefreshToken, RegistrationError, TokenError, construct_redirect_uri`; `from mcp.shared.auth import OAuthClientInformationFull, OAuthToken`; `from mcp.server.auth.middleware.auth_context import auth_context_var, get_access_token`; `from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser`; `from mcp.server.transport_security import TransportSecuritySettings`; `from mcp import Client`. I tool che restituiscono un oggetto devono essere annotati `-> dict[str, Any]` (con `-> dict` nudo `structured_content` è `None`). Un `ToolError("x")` arriva al client come `is_error=True` con testo `"Error executing tool <nome>: x"`.
- Nomi DB: tabelle `oauth_clients`, `oauth_auth_codes`, `oauth_tokens`; modelli `OAuthClient`, `OAuthAuthCode`, `OAuthTokenPair` (non `OAuthToken`, per non collidere con `mcp.shared.auth.OAuthToken`).
- Permesso: `Permission.mcp_access = "mcp.access"`, label `"Connessioni AI (MCP)"`, escluso da `DEFAULT_PERMISSIONS`.
- Nuove env: `PUBLIC_BASE_URL` (default `http://localhost:6500`), `APP_TIMEZONE` (default `Europe/Rome`), `OAUTH_ACCESS_TOKEN_MINUTES` (default `60`), `OAUTH_REFRESH_TOKEN_DAYS` (default `30`). URL risorsa MCP = `PUBLIC_BASE_URL` senza `/` finale + `/mcp`.
- Le route REST esistenti mantengono esattamente status code e `detail` attuali (`"food not found"`, `"entry not found"`, `"source_dates must be non-empty"`, `"no goal set"`, `"forbidden"`); i test REST esistenti passano **senza modifiche**.
- Tool MCP: nomi, argomenti e descrizioni in inglese; operano solo sull'utente del token (nessun argomento `user_id`). Testi UI in italiano.
- Codici e token OAuth salvati solo come hash SHA-256. Il `client_secret` dei client confidenziali è salvato **cifrato** con `app.auth.totp.encrypt_secret` (l'SDK confronta il secret in chiaro, quindi un hash non basta).
- Test API DB-backed: servono Postgres raggiungibile via `DATABASE_URL` con migrazioni applicate (vedi Task 0). I comandi API si lanciano da `api/` con il venv `api/.venv` attivo; su Windows: `.venv\Scripts\python -m pytest ...`.
- Web: comandi da `web/`: `npm test`, `npm run build`, `npx eslint src`.
- Commit piccoli, uno per task, messaggi Conventional Commits in inglese, che terminano con la riga di attribuzione indicata dall'orchestratore.

---

## File Structure

**API — nuovi**
- `api/app/services/errors.py` — eccezioni di dominio `ServiceError`, `NotFound`, `Invalid`, `PermissionMissing`.
- `api/app/services/diary_ops.py` — operazioni DB sul diario (giorno, settimana, CRUD entry, copia) condivise REST/MCP.
- `api/app/services/goals.py` — obiettivo attivo, delta, `set_goal`.
- `api/app/services/foods.py` — ricerca, recenti, barcode, alimento custom.
- `api/app/models/oauth.py` — `OAuthClient`, `OAuthAuthCode`, `OAuthTokenPair`.
- `api/alembic/versions/7c3e1a9b5d20_oauth_mcp.py` — migration.
- `api/app/mcp/__init__.py` — package.
- `api/app/mcp/consent.py` — firma/verifica della richiesta di autorizzazione pendente.
- `api/app/mcp/oauth.py` — `PostgresOAuthProvider` + funzioni grant (emissione, revoca, elenco connessioni, pulizia).
- `api/app/mcp/context.py` — `tool_scope()` (utente del token, sessione DB, audit, errori), `today()`, OFF client.
- `api/app/mcp/format.py` — forme JSON compatte restituite dai tool.
- `api/app/mcp/tools/__init__.py`, `api/app/mcp/tools/foods.py`, `api/app/mcp/tools/diary.py`, `api/app/mcp/tools/goals.py` — tool.
- `api/app/mcp/prompts.py` — prompt `plan_my_day`.
- `api/app/mcp/server.py` — `build_server()`, `mcp_server`, `mcp_http_app`.
- `api/app/routers/oauth.py` — consenso + connessioni per la SPA.
- `api/tests/conftest.py`, `api/tests/factories.py`, `api/tests/mcp_helpers.py` — fixture e builder condivisi dai nuovi test.

**API — modificati**
- `api/pyproject.toml`, `api/app/config.py`, `api/app/db.py`, `.env.example`
- `api/app/permissions.py`, `api/app/auth/rate_limit.py`
- `api/app/routers/diary.py`, `api/app/routers/foods.py` — diventano sottili, delegano ai servizi.
- `api/app/routers/admin.py`, `api/app/routers/auth.py` — revoca token, `mcp_url`, endpoint connessioni admin.
- `api/app/main.py` — exception handler di dominio, router oauth, rate limit OAuth, mount MCP, lifespan.
- `api/app/models/__init__.py`, `api/app/cli.py`
- `web/nginx.conf`

**Web — nuovi**
- `web/src/api/oauth.ts`, `web/src/lib/safeNext.ts`, `web/src/lib/redirect.ts`, `web/src/lib/format.ts`
- `web/src/pages/ConnectPage.tsx` (+ test), `web/src/components/McpConnectionsSection.tsx` (+ test), `web/src/pages/admin/UserAccessPanel.tsx` (+ test), `web/src/lib/safeNext.test.ts`

**Web — modificati**
- `web/src/App.tsx`, `web/src/pages/LoginPage.tsx` (+ test), `web/src/pages/AccountPage.tsx`, `web/src/pages/admin/AdminUsersPage.tsx`, `web/src/api/auth.ts`, `web/src/api/admin.ts`, `web/src/lib/permissions.ts`, `web/vite.config.ts`

**Docs**: `README.md`, spec (emendamenti in Task 14).

---

### Task 0: Ambiente di test (prerequisito, nessun commit)

Su questa macchina non ci sono né Docker né Postgres. Senza un Postgres i test DB-backed (la maggior parte) non possono girare.

- [ ] **Step 1: Verifica un Postgres raggiungibile**

Una delle due strade (a scelta dell'utente):
- Docker: `docker compose up -d db` più una mappatura porta temporanea `5432:5432`, *oppure*
- Postgres 16 installato localmente.

Crea il DB di test ed estensione trigram:

```bash
psql -U postgres -h localhost -c "CREATE DATABASE yfp_test;"
psql -U postgres -h localhost -d yfp_test -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

- [ ] **Step 2: Migra e lancia la baseline**

```bash
cd api
set DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/yfp_test   # PowerShell: $env:DATABASE_URL="..."
.venv\Scripts\python -m alembic upgrade head
.venv\Scripts\python -m pytest -q
cd ../web && npm test
```

Expected: tutti i test verdi. Annota il numero di test API passati: è la baseline per il vincolo "test REST invariati".

Se non è possibile avere un Postgres: **STOP** e riferisci all'orchestratore. Non procedere scrivendo codice DB-backed non testato.

---

### Task 1: Dipendenze, configurazione e infrastruttura di test

**Files:**
- Modify: `api/pyproject.toml`
- Modify: `api/app/config.py`
- Modify: `api/app/db.py`
- Modify: `.env.example`
- Create: `api/tests/conftest.py`
- Create: `api/tests/factories.py`
- Test: `api/tests/test_config.py`

**Interfaces:**
- Produces: `settings.public_base_url: str`, `settings.app_timezone: str`, `settings.oauth_access_token_minutes: int`, `settings.oauth_refresh_token_days: int`, proprietà `settings.mcp_resource_url -> str`.
- Produces: `app.db.session_scope()` (async context manager → `AsyncSession`), `app.db.override_session_scope(session: AsyncSession | None) -> None`.
- Produces (test): fixture `db` (sessione con rollback, cablata sia su `get_session` sia su `session_scope`); in `tests/factories.py`: `PASSWORD`, `NUTRIMENTS`, `make_user(db, *, username="alice", role=Role.user, permissions=None) -> User`, `make_food(db, *, name="Pasta", brand=None, owner=None) -> Food`, `http_client(db=None, user=None, *, csrf=True) -> AsyncClient`.

- [ ] **Step 1: Aggiungi le dipendenze**

In `api/pyproject.toml`, dentro `dependencies = [...]`, dopo `"cryptography>=43",` aggiungi:

```toml
    "mcp>=2.2,<3",
    "tzdata>=2024.1",
```

Installa:

```bash
cd api
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m pip show mcp
```

Expected: `Version: 2.2.x` (o 2.x successiva). Verifica che `fastapi`, `starlette` e `pydantic` restino compatibili: `.venv\Scripts\python -c "import app.main"` deve completare senza errori.

- [ ] **Step 2: Scrivi il test che fallisce**

`api/tests/test_config.py`:

```python
"""Settings derived values and the out-of-DI session hook (no database needed)."""

from app.config import Settings
from app.db import override_session_scope, session_scope


def test_mcp_resource_url_strips_trailing_slash() -> None:
    settings = Settings(public_base_url="https://fit.example.com/")
    assert settings.mcp_resource_url == "https://fit.example.com/mcp"


def test_new_settings_defaults() -> None:
    settings = Settings()
    assert settings.app_timezone == "Europe/Rome"
    assert settings.oauth_access_token_minutes == 60
    assert settings.oauth_refresh_token_days == 30


async def test_session_scope_yields_override() -> None:
    sentinel = object()
    override_session_scope(sentinel)  # type: ignore[arg-type]
    try:
        async with session_scope() as session:
            assert session is sentinel
    finally:
        override_session_scope(None)
```

- [ ] **Step 3: Esegui e verifica che fallisca**

Run: `.venv\Scripts\python -m pytest tests/test_config.py -v`
Expected: FAIL (`ImportError: cannot import name 'override_session_scope'` / attributi mancanti).

- [ ] **Step 4: Implementa**

In `api/app/config.py`, dentro `class Settings`, dopo `user_lockout_minutes: int = 15` aggiungi:

```python
    # Public origin users reach the app at (the Cloudflare Tunnel hostname in
    # production). It is the OAuth issuer and the base of the MCP resource URL,
    # so it must match what MCP clients are given, scheme included.
    public_base_url: str = "http://localhost:6500"
    # Timezone used by the MCP tools to resolve "today" for the user.
    app_timezone: str = "Europe/Rome"
    oauth_access_token_minutes: int = 60
    oauth_refresh_token_days: int = 30

    @property
    def mcp_resource_url(self) -> str:
        return f"{self.public_base_url.rstrip('/')}/mcp"
```

Sostituisci `api/app/db.py` con:

```python
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)

AsyncSessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False)

_session_override: AsyncSession | None = None


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a database session."""
    async with AsyncSessionLocal() as session:
        yield session


def override_session_scope(session: AsyncSession | None) -> None:
    """Test hook: make `session_scope()` yield `session` instead of a fresh one."""
    global _session_override
    _session_override = session


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """A session for code outside FastAPI dependency injection (the MCP tools
    and the OAuth provider the MCP SDK calls)."""
    if _session_override is not None:
        yield _session_override
        return
    async with AsyncSessionLocal() as session:
        yield session
```

In `.env.example`, in fondo aggiungi:

```
# Public HTTPS origin of the app (the Cloudflare Tunnel hostname). Used as the
# OAuth issuer and to build the MCP URL users paste into Claude:
# <PUBLIC_BASE_URL>/mcp. Must match exactly what users open in the browser.
PUBLIC_BASE_URL=https://fit.example.com

# Timezone the MCP tools use to decide what "today" is.
#APP_TIMEZONE=Europe/Rome
# Lifetime of MCP access/refresh tokens.
#OAUTH_ACCESS_TOKEN_MINUTES=60
#OAUTH_REFRESH_TOKEN_DAYS=30
```

- [ ] **Step 5: Crea fixture e builder condivisi**

`api/tests/conftest.py`:

```python
"""Fixtures shared by the MCP/OAuth test modules.

Older modules define their own `session` fixture; this one is named `db`
so it never shadows them. It wires the same rolled-back session into both
FastAPI's `get_session` dependency and `app.db.session_scope()` (used by
the MCP tools and the OAuth provider), so every code path in a test sees
the same uncommitted data.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, get_session, override_session_scope
from app.main import app


@pytest.fixture
async def db():
    async with engine.connect() as connection:
        trans = await connection.begin()
        async with AsyncSession(bind=connection, expire_on_commit=False) as sess:
            app.dependency_overrides[get_session] = lambda: sess
            override_session_scope(sess)
            try:
                yield sess
            finally:
                override_session_scope(None)
                app.dependency_overrides.pop(get_session, None)
        await trans.rollback()
```

`api/tests/factories.py`:

```python
"""Test data builders shared by the MCP/OAuth test modules."""

from typing import ClassVar

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.passwords import hash_password
from app.auth.sessions import create_session
from app.main import app
from app.models.food import Food
from app.models.user import Role, User

PASSWORD = "correct horse battery staple"

NUTRIMENTS = {
    "kcal": 200.0,
    "protein_g": 20.0,
    "carbs_g": 10.0,
    "sugars_g": 5.0,
    "fat_g": 8.0,
    "sat_fat_g": 2.0,
    "fiber_g": 1.0,
    "salt_g": 0.5,
}


class _FakeRequest:
    headers: ClassVar[dict] = {}
    client = None


async def make_user(
    db: AsyncSession,
    *,
    username: str = "alice",
    role: Role = Role.user,
    permissions: list[str] | None = None,
) -> User:
    user = User(
        username=username, display_name=username.title(), role=role,
        permissions=permissions if permissions is not None else [],
        password_hash=hash_password(PASSWORD), must_change_password=False, totp_enabled=True,
    )
    db.add(user)
    await db.flush()
    return user


async def make_food(
    db: AsyncSession, *, name: str = "Pasta", brand: str | None = None, owner: User | None = None
) -> Food:
    food = Food(
        source="custom" if owner else "off", owner_user_id=owner.id if owner else None,
        name=name, brand=brand, nutriments=dict(NUTRIMENTS), raw=None,
    )
    db.add(food)
    await db.flush()
    return food


async def http_client(
    db: AsyncSession | None = None, user: User | None = None, *, csrf: bool = True
) -> AsyncClient:
    """An https client for the ASGI app, optionally logged in as `user`.

    `csrf=False` sends a wrong `X-Requested-With`, to exercise the CSRF gate.
    """
    client = AsyncClient(
        transport=ASGITransport(app=app), base_url="https://test",
        headers={"X-Requested-With": "yfp" if csrf else "nope"},
    )
    if user is not None:
        assert db is not None
        client.cookies.set("session", await create_session(db, user, _FakeRequest()))
    return client
```

- [ ] **Step 6: Esegui i test**

Run: `.venv\Scripts\python -m pytest tests/test_config.py -v` → PASS.
Run: `.venv\Scripts\python -m pytest -q` → stessa baseline del Task 0, tutto verde.

- [ ] **Step 7: Commit**

```bash
git add api/pyproject.toml api/app/config.py api/app/db.py .env.example api/tests/conftest.py api/tests/factories.py api/tests/test_config.py
git commit -m "chore(api): add mcp dependency, public URL settings and shared test fixtures"
```

---

### Task 2: Estrazione servizi diario e obiettivi

**Files:**
- Create: `api/app/services/errors.py`
- Create: `api/app/services/goals.py`
- Create: `api/app/services/diary_ops.py`
- Modify: `api/app/permissions.py` (aggiunge `ensure_permission`)
- Modify: `api/app/routers/diary.py` (intero file)
- Modify: `api/app/main.py` (exception handler)
- Test: `api/tests/test_diary_ops.py`

**Interfaces:**
- Consumes: fixture `db`, `make_user`, `make_food` (Task 1).
- Produces:
  - `app.services.errors`: `ServiceError(Exception)`, `NotFound(ServiceError)`, `Invalid(ServiceError)`, `PermissionMissing(ServiceError)` con attributo `permission: str`. Il messaggio è `str(exc)`.
  - `app.permissions.ensure_permission(user: User, permission: Permission) -> None` (solleva `PermissionMissing`).
  - `app.services.goals`: `async active_goal(db, user_id: int, for_date: date) -> Goal | None`; `goal_delta(goal: Goal | None, day_total: Mapping[str, float]) -> GoalDelta | None`; `async set_goal(db, user: User, payload: GoalCreate, valid_from: date) -> Goal`.
  - `app.services.diary_ops`: `visible_food_filter(user)`; `entry_out(entry, food=None) -> DiaryEntryOut`; `async get_day(db, user, for_date) -> DayResponse`; `async get_week(db, user, start) -> WeekResponse`; `async create_entries(db, user, payloads: list[DiaryEntryCreate]) -> list[DiaryEntryOut]` (tutto-o-niente); `async create_entry(db, user, payload) -> DiaryEntryOut`; `async update_entry(db, user, entry_id: int, payload: DiaryEntryPatch) -> DiaryEntryOut`; `async delete_entry(db, user, entry_id: int) -> None`; `async copy_days(db, user, payload: DiaryCopyRequest) -> DiaryCopyResponse`.

- [ ] **Step 1: Scrivi i test che falliscono**

`api/tests/test_diary_ops.py`:

```python
"""Diary/goal service functions shared by REST and MCP (needs Postgres)."""

from datetime import date

import pytest

from app.models.diary import Meal
from app.schemas.diary import DiaryCopyRequest, DiaryEntryCreate, DiaryEntryPatch, GoalCreate
from app.services import diary_ops, goals
from app.services.errors import Invalid, NotFound, PermissionMissing
from tests.factories import make_food, make_user

D = date(2026, 3, 2)


def _entry(food_id: int, grams: float = 80, meal: Meal = Meal.lunch) -> DiaryEntryCreate:
    return DiaryEntryCreate(date=D, meal=meal, food_id=food_id, grams=grams)


async def test_create_entries_assigns_increasing_positions(db) -> None:
    user = await make_user(db)
    food = await make_food(db)
    created = await diary_ops.create_entries(db, user, [_entry(food.id), _entry(food.id, 20)])
    assert [e.position for e in created] == [0, 1]
    assert created[0].food_name == "Pasta"


async def test_create_entries_is_all_or_nothing(db) -> None:
    user = await make_user(db)
    food = await make_food(db)
    with pytest.raises(NotFound, match="food not found"):
        await diary_ops.create_entries(db, user, [_entry(food.id), _entry(999_999)])
    day = await diary_ops.get_day(db, user, D)
    assert day.entries["lunch"] == []


async def test_other_users_custom_food_is_not_found(db) -> None:
    alice = await make_user(db, username="alice")
    bob = await make_user(db, username="bob")
    bobs_food = await make_food(db, name="Bob's", owner=bob)
    with pytest.raises(NotFound, match="food not found"):
        await diary_ops.create_entry(db, alice, _entry(bobs_food.id))


async def test_update_and_delete_other_users_entry_is_not_found(db) -> None:
    alice = await make_user(db, username="alice")
    bob = await make_user(db, username="bob")
    food = await make_food(db)
    entry = await diary_ops.create_entry(db, bob, _entry(food.id))
    with pytest.raises(NotFound, match="entry not found"):
        await diary_ops.update_entry(db, alice, entry.id, DiaryEntryPatch(grams=10))
    with pytest.raises(NotFound, match="entry not found"):
        await diary_ops.delete_entry(db, alice, entry.id)


async def test_update_entry_moves_meal_to_end(db) -> None:
    user = await make_user(db)
    food = await make_food(db)
    await diary_ops.create_entry(db, user, _entry(food.id, meal=Meal.dinner))
    entry = await diary_ops.create_entry(db, user, _entry(food.id))
    moved = await diary_ops.update_entry(db, user, entry.id, DiaryEntryPatch(meal=Meal.dinner, grams=5))
    assert (moved.meal, moved.position, moved.grams) == (Meal.dinner, 1, 5)


async def test_copy_days_requires_permission(db) -> None:
    user = await make_user(db, permissions=[])
    payload = DiaryCopyRequest(source_dates=[D], target_start=date(2026, 3, 9))
    with pytest.raises(PermissionMissing) as info:
        await diary_ops.copy_days(db, user, payload)
    assert info.value.permission == "diary.copy"


async def test_copy_days_rejects_empty_sources(db) -> None:
    user = await make_user(db, permissions=["diary.copy"])
    with pytest.raises(Invalid, match="source_dates must be non-empty"):
        await diary_ops.copy_days(db, user, DiaryCopyRequest(source_dates=[], target_start=D))


async def test_set_goal_requires_permission(db) -> None:
    user = await make_user(db, permissions=[])
    with pytest.raises(PermissionMissing):
        await goals.set_goal(db, user, GoalCreate(kcal=2000, protein_g=150, carbs_g=200, fat_g=70), D)


async def test_set_goal_uses_given_valid_from(db) -> None:
    user = await make_user(db, permissions=["goals.edit"])
    goal = await goals.set_goal(
        db, user, GoalCreate(kcal=2000, protein_g=150, carbs_g=200, fat_g=70), D
    )
    assert goal.valid_from == D
    assert (await goals.active_goal(db, user.id, D)).id == goal.id
    assert await goals.active_goal(db, user.id, date(2026, 3, 1)) is None
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `.venv\Scripts\python -m pytest tests/test_diary_ops.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'app.services.diary_ops'`.

- [ ] **Step 3: Crea gli errori di dominio e `ensure_permission`**

`api/app/services/errors.py`:

```python
"""Domain errors shared by the REST routers and the MCP tools.

Services raise these instead of `HTTPException` so the same code can serve
both transports: `app.main` maps them to HTTP responses (keeping the exact
status codes and `detail` strings the REST API always had), and
`app.mcp.context.tool_scope` turns them into MCP tool errors.
"""


class ServiceError(Exception):
    """Base class; `str(exc)` is a safe, user-facing message."""


class NotFound(ServiceError):
    """The entity does not exist or belongs to another user (never distinguished)."""


class Invalid(ServiceError):
    """The request is well-formed but not acceptable."""


class PermissionMissing(ServiceError):
    """The user lacks a permission from `app.permissions.Permission`."""

    def __init__(self, permission: str) -> None:
        super().__init__(f"Permission {permission} is not enabled for this account")
        self.permission = permission
```

In `api/app/permissions.py` aggiungi in cima agli import `from app.services.errors import PermissionMissing` e in fondo al file:

```python
def ensure_permission(user: User, permission: Permission) -> None:
    """Raise `PermissionMissing` unless `user` effectively holds `permission`."""
    if permission not in effective_permissions(user):
        raise PermissionMissing(permission.value)
```

(`app/services/errors.py` non importa nulla da `app`, quindi non c'è ciclo.)

- [ ] **Step 4: Crea `app/services/goals.py`**

```python
"""Goal lookups and updates shared by the REST routers and the MCP tools.

Goals are append-only/historized via `valid_from` (see `app/models/goal.py`).
"""

from collections.abc import Mapping
from datetime import date

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.goal import Goal
from app.models.user import User
from app.permissions import Permission, ensure_permission
from app.schemas.diary import GoalCreate, GoalDelta


async def active_goal(db: AsyncSession, user_id: int, for_date: date) -> Goal | None:
    """The `Goal` row with the largest `valid_from` that is `<= for_date`.

    Ties on `valid_from` (a goal set twice in one day) are broken by
    `id DESC` so the most recently created row deterministically wins.
    """
    stmt = (
        sa.select(Goal)
        .where(Goal.user_id == user_id, Goal.valid_from <= for_date)
        .order_by(Goal.valid_from.desc(), Goal.id.desc())
        .limit(1)
    )
    return await db.scalar(stmt)


def goal_delta(goal: Goal | None, day_total: Mapping[str, float]) -> GoalDelta | None:
    if goal is None:
        return None
    return GoalDelta(
        kcal=float(goal.kcal) - day_total["kcal"],
        protein_g=float(goal.protein_g) - day_total["protein_g"],
        carbs_g=float(goal.carbs_g) - day_total["carbs_g"],
        fat_g=float(goal.fat_g) - day_total["fat_g"],
    )


async def set_goal(db: AsyncSession, user: User, payload: GoalCreate, valid_from: date) -> Goal:
    ensure_permission(user, Permission.goals_edit)
    goal = Goal(
        user_id=user.id, kcal=payload.kcal, protein_g=payload.protein_g,
        carbs_g=payload.carbs_g, fat_g=payload.fat_g, valid_from=valid_from,
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return goal
```

- [ ] **Step 5: Crea `app/services/diary_ops.py`**

La logica è quella attuale di `app/routers/diary.py`, spostata e resa indipendente da HTTP.

```python
"""DB-backed diary operations shared by the REST routers and the MCP tools.

`nutriments_snapshot` on a `DiaryEntry` is the food's FULL per-100g
nutriment dict, copied verbatim (unscaled) at entry-creation time -- NOT
pre-scaled by `grams`. Scaling by `grams/100` happens at read time, in
`app/services/diary.py`'s `compute_day_totals`/`compute_week_totals`. This
matters because a later PATCH to `grams` must change computed totals
without rewriting the stored snapshot, and a later copy of the snapshot
must carry the same unscaled per-100g values regardless of `grams`.
"""

from datetime import date, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.diary import DiaryEntry, Meal
from app.models.food import Food
from app.models.user import User
from app.permissions import Permission, ensure_permission
from app.schemas.diary import (
    DayResponse,
    DayTotals,
    DiaryCopyDayResult,
    DiaryCopyRequest,
    DiaryCopyResponse,
    DiaryEntryCreate,
    DiaryEntryOut,
    DiaryEntryPatch,
    GoalOut,
    WeekDayTotal,
    WeekResponse,
)
from app.services.diary import compute_day_totals, plan_copy, zero_totals
from app.services.errors import Invalid, NotFound
from app.services.goals import active_goal, goal_delta


def visible_food_filter(user: User) -> sa.ColumnElement[bool]:
    """Shared (OFF) foods plus the user's own custom foods."""
    return sa.or_(Food.source != "custom", Food.owner_user_id == user.id)


def entry_out(entry: DiaryEntry, food: Food | None = None) -> DiaryEntryOut:
    """Build a `DiaryEntryOut` from a row plus its `Food` (for name/brand).

    Callers either eager-load `DiaryEntry.food` and leave `food` unset, or
    pass the already-fetched `Food` explicitly.
    """
    f = food if food is not None else entry.food
    return DiaryEntryOut(
        id=entry.id, food_id=entry.food_id, food_name=f.name, food_brand=f.brand,
        date=entry.date, meal=entry.meal, grams=entry.grams,
        portion_label=entry.portion_label, position=entry.position,
        nutriments_snapshot=entry.nutriments_snapshot,
    )


async def _next_position(db: AsyncSession, user: User, for_date: date, meal: Meal) -> int:
    # Autoflush makes entries added earlier in the same transaction count too.
    max_position = await db.scalar(
        sa.select(sa.func.max(DiaryEntry.position)).where(
            DiaryEntry.user_id == user.id, DiaryEntry.date == for_date, DiaryEntry.meal == meal
        )
    )
    return 0 if max_position is None else max_position + 1


async def _own_entry(db: AsyncSession, user: User, entry_id: int) -> DiaryEntry:
    entry = await db.scalar(
        sa.select(DiaryEntry).where(DiaryEntry.id == entry_id, DiaryEntry.user_id == user.id)
    )
    if entry is None:
        raise NotFound("entry not found")
    return entry


async def get_day(db: AsyncSession, user: User, for_date: date) -> DayResponse:
    stmt = (
        sa.select(DiaryEntry)
        .where(DiaryEntry.user_id == user.id, DiaryEntry.date == for_date)
        .options(selectinload(DiaryEntry.food))
        .order_by(DiaryEntry.meal, DiaryEntry.position)
    )
    entries = (await db.execute(stmt)).scalars().all()
    totals = compute_day_totals(entries)

    entries_by_meal: dict[str, list[DiaryEntry]] = {meal.value: [] for meal in Meal}
    for entry in entries:
        entries_by_meal[entry.meal.value].append(entry)
    by_meal_totals = {
        meal.value: totals["by_meal"].get(meal.value, zero_totals()) for meal in Meal
    }
    goal = await active_goal(db, user.id, for_date)
    return DayResponse(
        date=for_date,
        entries={
            meal_key: [entry_out(e) for e in meal_entries]
            for meal_key, meal_entries in entries_by_meal.items()
        },
        totals=DayTotals(by_meal=by_meal_totals, total=totals["total"]),
        goal=GoalOut.model_validate(goal) if goal is not None else None,
        delta=goal_delta(goal, totals["total"]),
    )


async def get_week(db: AsyncSession, user: User, start: date) -> WeekResponse:
    end = start + timedelta(days=6)
    stmt = (
        sa.select(DiaryEntry)
        .where(DiaryEntry.user_id == user.id, DiaryEntry.date >= start, DiaryEntry.date <= end)
        .order_by(DiaryEntry.date)
    )
    entries = (await db.execute(stmt)).scalars().all()
    entries_by_date: dict[date, list[DiaryEntry]] = {
        start + timedelta(days=i): [] for i in range(7)
    }
    for entry in entries:
        entries_by_date[entry.date].append(entry)
    days = [
        WeekDayTotal(date=day, total=compute_day_totals(day_entries)["total"])
        for day, day_entries in sorted(entries_by_date.items())
    ]
    return WeekResponse(start=start, end=end, days=days)


async def create_entries(
    db: AsyncSession, user: User, payloads: list[DiaryEntryCreate]
) -> list[DiaryEntryOut]:
    """Log several entries in one transaction: all foods are resolved before
    anything is added, so an unknown food leaves the diary untouched."""
    food_ids = {p.food_id for p in payloads}
    foods = {
        food.id: food
        for food in (
            await db.scalars(sa.select(Food).where(Food.id.in_(food_ids), visible_food_filter(user)))
        ).all()
    }
    if food_ids - foods.keys():
        raise NotFound("food not found")

    created: list[tuple[DiaryEntry, Food]] = []
    for payload in payloads:
        food = foods[payload.food_id]
        entry = DiaryEntry(
            user_id=user.id, food_id=food.id, date=payload.date, meal=payload.meal,
            grams=payload.grams, portion_label=None,
            position=await _next_position(db, user, payload.date, payload.meal),
            # Full per-100g dict, copied verbatim -- NOT scaled by grams.
            nutriments_snapshot=dict(food.nutriments),
        )
        db.add(entry)
        created.append((entry, food))
    await db.commit()
    for entry, _ in created:
        await db.refresh(entry)
    return [entry_out(entry, food=food) for entry, food in created]


async def create_entry(db: AsyncSession, user: User, payload: DiaryEntryCreate) -> DiaryEntryOut:
    return (await create_entries(db, user, [payload]))[0]


async def update_entry(
    db: AsyncSession, user: User, entry_id: int, payload: DiaryEntryPatch
) -> DiaryEntryOut:
    entry = await _own_entry(db, user, entry_id)
    if payload.grams is not None:
        entry.grams = payload.grams
    if payload.meal is not None and payload.meal != entry.meal:
        entry.position = await _next_position(db, user, entry.date, payload.meal)
        entry.meal = payload.meal
    await db.commit()
    await db.refresh(entry)
    food = await db.get(Food, entry.food_id)
    assert food is not None  # FK is RESTRICT -- the food can't have been deleted
    return entry_out(entry, food=food)


async def delete_entry(db: AsyncSession, user: User, entry_id: int) -> None:
    entry = await _own_entry(db, user, entry_id)
    await db.delete(entry)
    await db.commit()


async def copy_days(db: AsyncSession, user: User, payload: DiaryCopyRequest) -> DiaryCopyResponse:
    ensure_permission(user, Permission.diary_copy)
    if not payload.source_dates:
        raise Invalid("source_dates must be non-empty")

    # Read ALL source entries into memory *before* any deletes -- required
    # so that `mode == "replace"` on a target date that's also a source
    # date (overlap) works correctly. See `plan_copy`'s docstring.
    distinct_source_dates = set(payload.source_dates)
    stmt = (
        sa.select(DiaryEntry)
        .where(DiaryEntry.user_id == user.id, DiaryEntry.date.in_(distinct_source_dates))
        .order_by(DiaryEntry.date, DiaryEntry.meal, DiaryEntry.position)
    )
    source_entries = (await db.execute(stmt)).scalars().all()
    entries_by_source_date: dict[date, list[DiaryEntry]] = {d: [] for d in distinct_source_dates}
    for entry in source_entries:
        entries_by_source_date[entry.date].append(entry)

    plan = plan_copy(
        source_dates=payload.source_dates, target_start=payload.target_start,
        meals=payload.meals, mode=payload.mode, entries_by_source_date=entries_by_source_date,
    )

    # Deletes first (only relevant in "replace" mode), all inserts after --
    # never interleaved per-day, which is what makes overlapping
    # source/target ranges correct.
    for target_date, meal_set in plan["deletes"]:
        await db.execute(
            sa.delete(DiaryEntry).where(
                DiaryEntry.user_id == user.id, DiaryEntry.date == target_date,
                DiaryEntry.meal.in_(meal_set),
            )
        )

    next_position: dict[tuple[date, Meal], int] = {}
    for item in plan["inserts"]:
        key = (item["date"], item["meal"])
        if key not in next_position:
            next_position[key] = await _next_position(db, user, key[0], key[1])
        position = next_position[key]
        next_position[key] += 1
        db.add(
            DiaryEntry(
                user_id=user.id, food_id=item["food_id"], date=item["date"], meal=item["meal"],
                grams=item["grams"], portion_label=item["portion_label"], position=position,
                nutriments_snapshot=item["nutriments_snapshot"],
            )
        )
    await db.commit()
    return DiaryCopyResponse(
        entries_created=len(plan["inserts"]),
        days=[DiaryCopyDayResult(**day) for day in plan["days"]],
    )
```

Nota: in `copy_days`, come nel codice originale, la posizione massima viene letta dal DB solo alla prima occorrenza di ogni chiave `(date, meal)` e poi incrementata in memoria, quindi il comportamento resta identico. `tests/test_diary_copy.py` lo verifica.

- [ ] **Step 6: Riscrivi `app/routers/diary.py` come strato sottile**

Sostituisci l'intero file con:

```python
"""Diary API: entry CRUD, day/week totals, and goals.

Thin HTTP layer over `app/services/diary_ops.py` and `app/services/goals.py`
(shared with the MCP tools). Domain errors raised there are mapped to HTTP
responses by the exception handlers in `app/main.py`.
"""

from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_permission
from app.db import get_session
from app.models.goal import Goal
from app.models.user import User
from app.permissions import Permission
from app.schemas.diary import (
    DayResponse,
    DiaryCopyRequest,
    DiaryCopyResponse,
    DiaryEntryCreate,
    DiaryEntryOut,
    DiaryEntryPatch,
    GoalCreate,
    GoalOut,
    WeekResponse,
)
from app.services import diary_ops, goals

diary_router = APIRouter(prefix="/api/diary", tags=["diary"])
goals_router = APIRouter(prefix="/api/goals", tags=["goals"])


@diary_router.get("/day/{for_date}", response_model=DayResponse)
async def get_day(
    for_date: date,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> DayResponse:
    return await diary_ops.get_day(session, user, for_date)


@diary_router.get("/week", response_model=WeekResponse)
async def get_week(
    start: Annotated[date, Query()],
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WeekResponse:
    return await diary_ops.get_week(session, user, start)


@diary_router.post("/entries", response_model=DiaryEntryOut, status_code=201)
async def create_entry(
    payload: DiaryEntryCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> DiaryEntryOut:
    return await diary_ops.create_entry(session, user, payload)


@diary_router.patch("/entries/{entry_id}", response_model=DiaryEntryOut)
async def patch_entry(
    entry_id: int,
    payload: DiaryEntryPatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> DiaryEntryOut:
    return await diary_ops.update_entry(session, user, entry_id, payload)


@diary_router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await diary_ops.delete_entry(session, user, entry_id)


@diary_router.post("/copy", response_model=DiaryCopyResponse)
async def copy_days(
    payload: DiaryCopyRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission(Permission.diary_copy)),
) -> DiaryCopyResponse:
    return await diary_ops.copy_days(session, user, payload)


@goals_router.get("", response_model=GoalOut)
async def get_goal(
    for_date: Annotated[date | None, Query(alias="date")] = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Goal:
    goal = await goals.active_goal(session, user.id, for_date or datetime.now(UTC).date())
    if goal is None:
        raise HTTPException(status_code=404, detail="no goal set")
    return goal


@goals_router.put("", response_model=GoalOut, status_code=201)
async def put_goal(
    payload: GoalCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission(Permission.goals_edit)),
) -> Goal:
    return await goals.set_goal(session, user, payload, datetime.now(UTC).date())
```

Prima di sostituire, controlla con `grep -rn "_active_goal\|_entry_out\|_goal_delta" api/app` se altri moduli (es. `routers/admin.py`) importano gli helper privati del vecchio router; se sì, aggiorna quegli import a `app.services.goals.active_goal` / `app.services.diary_ops.entry_out` / `app.services.goals.goal_delta`.

- [ ] **Step 7: Mappa gli errori di dominio su HTTP**

In `api/app/main.py` aggiungi l'import:

```python
from app.services.errors import Invalid, NotFound, PermissionMissing
```

e, subito dopo la creazione di `app = FastAPI(...)`:

```python
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
```

- [ ] **Step 8: Esegui i test**

Run: `.venv\Scripts\python -m pytest tests/test_diary_ops.py -v` → PASS.
Run: `.venv\Scripts\python -m pytest -q` → tutto verde, stesso numero di test REST della baseline più i nuovi. Nessun file di test esistente modificato.
Run: `.venv\Scripts\python -m ruff check app tests` → nessun errore.

- [ ] **Step 9: Commit**

```bash
git add api/app/services/errors.py api/app/services/goals.py api/app/services/diary_ops.py api/app/permissions.py api/app/routers/diary.py api/app/main.py api/tests/test_diary_ops.py
git commit -m "refactor(api): move diary and goal logic into services shared by REST and MCP"
```

---

### Task 3: Estrazione servizio alimenti

**Files:**
- Create: `api/app/services/foods.py`
- Modify: `api/app/routers/foods.py` (intero file)
- Test: `api/tests/test_foods_service.py`

**Interfaces:**
- Consumes: `NotFound`, `ensure_permission` (Task 2); `visible_food_filter` (Task 2).
- Produces (`app.services.foods`): `LOCAL_MATCH_THRESHOLD = 10`; `async search_foods(db, off_client, user, q: str, limit: int) -> FoodSearchResponse`; `async recent_foods(db, user, limit: int) -> FoodSearchResponse`; `async get_by_barcode(db, off_client, user, code: str) -> Food` (solleva `NotFound("food not found")`); `async create_custom_food(db, user, payload: CustomFoodCreate) -> Food` (richiede `foods.custom_create`). `off_client` è qualsiasi oggetto con `async search(q, limit) -> list[dict] | None` e compatibile con `food_cache.get_or_fetch_by_barcode`.

- [ ] **Step 1: Scrivi i test che falliscono**

`api/tests/test_foods_service.py`:

```python
"""Food service functions shared by REST and MCP (needs Postgres)."""

import pytest

from app.schemas.food import CustomFoodCreate, Nutriments
from app.services import foods
from app.services.errors import NotFound, PermissionMissing
from tests.factories import NUTRIMENTS, make_food, make_user


class ExplodingOff:
    """Fails the test if OpenFoodFacts is contacted."""

    async def search(self, q: str, limit: int):
        raise AssertionError("OFF must not be called")


class DownOff:
    async def search(self, q: str, limit: int):
        return None


async def test_search_without_off_permission_is_cache_only(db) -> None:
    user = await make_user(db, permissions=[])
    await make_food(db, name="Pasta integrale")
    result = await foods.search_foods(db, ExplodingOff(), user, "pasta", 10)
    assert result.off_disabled is True
    assert [item.name for item in result.results] == ["Pasta integrale"]


async def test_search_reports_off_outage(db) -> None:
    user = await make_user(db, permissions=["foods.off_lookup"])
    result = await foods.search_foods(db, DownOff(), user, "zzzz-nothing", 10)
    assert result.off_unavailable is True
    assert result.results == []


async def test_search_hides_other_users_custom_foods(db) -> None:
    alice = await make_user(db, username="alice")
    bob = await make_user(db, username="bob")
    await make_food(db, name="Torta di Bob", owner=bob)
    result = await foods.search_foods(db, ExplodingOff(), alice, "torta", 10)
    assert result.results == []


async def test_barcode_without_permission_is_cache_only(db) -> None:
    user = await make_user(db, permissions=[])
    with pytest.raises(NotFound, match="food not found"):
        await foods.get_by_barcode(db, ExplodingOff(), user, "8001234567890")


async def test_create_custom_food_requires_permission(db) -> None:
    user = await make_user(db, permissions=[])
    payload = CustomFoodCreate(name="Mio piatto", nutriments=Nutriments(**NUTRIMENTS))
    with pytest.raises(PermissionMissing):
        await foods.create_custom_food(db, user, payload)


async def test_create_custom_food_is_owned_by_user(db) -> None:
    user = await make_user(db, permissions=["foods.custom_create"])
    payload = CustomFoodCreate(name="Mio piatto", nutriments=Nutriments(**NUTRIMENTS))
    food = await foods.create_custom_food(db, user, payload)
    assert (food.source, food.owner_user_id, food.name) == ("custom", user.id, "Mio piatto")
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `.venv\Scripts\python -m pytest tests/test_foods_service.py -v`
Expected: FAIL con `ImportError: cannot import name 'foods' from 'app.services'`.

- [ ] **Step 3: Crea `app/services/foods.py`**

```python
"""Food lookups shared by the REST routers and the MCP tools.

Search is deliberately cache-first: it queries the local `foods` table
first, and only calls out to OpenFoodFacts (via `OffClient.search`) when
local matches are sparse, upserting whatever comes back so subsequent
identical searches are served locally too.
"""

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.diary import DiaryEntry
from app.models.food import Food
from app.models.user import User
from app.permissions import Permission, effective_permissions, ensure_permission
from app.schemas.food import CustomFoodCreate, FoodSearchItem, FoodSearchResponse
from app.services import food_cache
from app.services.diary_ops import visible_food_filter
from app.services.errors import NotFound
from app.services.off_client import OffClient, normalize

# Below this many local matches, we also query OFF to fill in the gaps.
LOCAL_MATCH_THRESHOLD = 10


async def search_foods(
    db: AsyncSession, off_client: OffClient, user: User, q: str, limit: int
) -> FoodSearchResponse:
    # Usage frequency (times a food has been logged) ranks local matches;
    # foods never logged fall back to name-similarity ordering via pg_trgm.
    usage_subq = (
        sa.select(DiaryEntry.food_id.label("food_id"), sa.func.count().label("usage_count"))
        .where(DiaryEntry.user_id == user.id)
        .group_by(DiaryEntry.food_id)
        .subquery()
    )
    usage_count = sa.func.coalesce(usage_subq.c.usage_count, 0)
    pattern = f"%{q}%"
    # Query at least LOCAL_MATCH_THRESHOLD rows so the fallback decision below
    # reflects how many local matches actually exist, not just how many fit
    # within a small `limit`. The final response is trimmed to `limit` later.
    stmt = (
        sa.select(Food)
        .outerjoin(usage_subq, usage_subq.c.food_id == Food.id)
        .where(sa.or_(Food.name.ilike(pattern), Food.brand.ilike(pattern)), visible_food_filter(user))
        .order_by(usage_count.desc(), sa.func.similarity(Food.name, q).desc())
        .limit(max(limit, LOCAL_MATCH_THRESHOLD))
    )
    local_foods = (await db.execute(stmt)).scalars().all()

    results = [FoodSearchItem.from_food(food, source="cache") for food in local_foods]
    seen_ids = {food.id for food in local_foods}
    off_unavailable = False
    off_disabled = Permission.foods_off_lookup not in effective_permissions(user)

    if len(local_foods) < LOCAL_MATCH_THRESHOLD and not off_disabled:
        off_products = await off_client.search(q, limit=limit)
        if off_products is None:
            off_unavailable = True
        else:
            upserted_any = False
            for product in off_products:
                normalized = normalize(product)
                barcode = normalized.get("barcode") if normalized else None
                if normalized is None or not barcode:
                    continue
                food = await food_cache.upsert_normalized_food(db, barcode, normalized, product)
                upserted_any = True
                if food.id in seen_ids:
                    continue
                seen_ids.add(food.id)
                results.append(FoodSearchItem.from_food(food, source="off"))
            if upserted_any:
                await db.commit()

    return FoodSearchResponse(
        results=results[:limit], off_unavailable=off_unavailable, off_disabled=off_disabled
    )


async def recent_foods(db: AsyncSession, user: User, limit: int) -> FoodSearchResponse:
    """Distinct foods logged at least once, most-recently-logged first.

    Recency is the most recent `(date, id)` pair among a food's diary
    entries; `id` breaks ties within the same day.
    """
    last_used = (
        sa.select(
            DiaryEntry.food_id.label("food_id"),
            sa.func.max(DiaryEntry.date).label("last_date"),
            sa.func.max(DiaryEntry.id).label("last_id"),
        )
        .where(DiaryEntry.user_id == user.id)
        .group_by(DiaryEntry.food_id)
        .subquery()
    )
    stmt = (
        sa.select(Food)
        .join(last_used, last_used.c.food_id == Food.id)
        .where(visible_food_filter(user))
        .order_by(last_used.c.last_date.desc(), last_used.c.last_id.desc())
        .limit(limit)
    )
    found = (await db.execute(stmt)).scalars().all()
    return FoodSearchResponse(results=[FoodSearchItem.from_food(f, source="cache") for f in found])


async def get_by_barcode(db: AsyncSession, off_client: OffClient, user: User, code: str) -> Food:
    if Permission.foods_off_lookup not in effective_permissions(user):
        # Permissionless barcode lookups are strictly cache-only.
        food = await db.scalar(sa.select(Food).where(Food.barcode == code, visible_food_filter(user)))
    else:
        food = await food_cache.get_or_fetch_by_barcode(db, code, client=off_client)
    if food is None:
        raise NotFound("food not found")
    return food


async def create_custom_food(db: AsyncSession, user: User, payload: CustomFoodCreate) -> Food:
    ensure_permission(user, Permission.foods_custom_create)
    food = Food(
        owner_user_id=user.id, source="custom", name=payload.name, brand=payload.brand,
        image_url=payload.image_url, serving_size_g=payload.serving_size_g,
        nutriments=payload.nutriments.model_dump(), raw=None, fetched_at=None,
    )
    db.add(food)
    await db.commit()
    await db.refresh(food)
    return food
```

- [ ] **Step 4: Riscrivi `app/routers/foods.py`**

```python
"""Foods API: cache-first search, recent foods, barcode lookup, custom foods.

Thin HTTP layer over `app/services/foods.py` (shared with the MCP tools).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_permission
from app.db import get_session
from app.models.food import Food
from app.models.user import User
from app.permissions import Permission
from app.schemas.food import CustomFoodCreate, FoodOut, FoodSearchResponse
from app.services import foods
from app.services.off_client import OffClient, get_off_client

router = APIRouter(prefix="/api/foods", tags=["foods"])


@router.get("/search", response_model=FoodSearchResponse)
async def search_foods(
    q: Annotated[str, Query(min_length=1)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    session: AsyncSession = Depends(get_session),
    off_client: OffClient = Depends(get_off_client),
    user: User = Depends(get_current_user),
) -> FoodSearchResponse:
    return await foods.search_foods(session, off_client, user, q, limit)


@router.get("/recent", response_model=FoodSearchResponse)
async def recent_foods(
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FoodSearchResponse:
    return await foods.recent_foods(session, user, limit)


@router.get("/barcode/{code}", response_model=FoodOut)
async def get_food_by_barcode(
    code: str,
    session: AsyncSession = Depends(get_session),
    off_client: OffClient = Depends(get_off_client),
    user: User = Depends(get_current_user),
) -> Food:
    return await foods.get_by_barcode(session, off_client, user, code)


@router.post("", response_model=FoodOut, status_code=201)
async def create_custom_food(
    payload: CustomFoodCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission(Permission.foods_custom_create)),
) -> Food:
    return await foods.create_custom_food(session, user, payload)
```

Prima di sostituire: `grep -rn "LOCAL_MATCH_THRESHOLD" api/` — se un test importa la costante dal router, lascia nel router anche `from app.services.foods import LOCAL_MATCH_THRESHOLD  # noqa: F401  (re-export for tests)`.

- [ ] **Step 5: Esegui i test**

Run: `.venv\Scripts\python -m pytest tests/test_foods_service.py tests/test_foods_router.py -v` → PASS.
Run: `.venv\Scripts\python -m pytest -q` e `.venv\Scripts\python -m ruff check app tests` → verdi.

- [ ] **Step 6: Commit**

```bash
git add api/app/services/foods.py api/app/routers/foods.py api/tests/test_foods_service.py
git commit -m "refactor(api): move food search, barcode and custom-food logic into a service"
```

---

### Task 4: Permesso `mcp.access` e rate limit a bucket

**Files:**
- Modify: `api/app/permissions.py`
- Modify: `api/app/auth/rate_limit.py`
- Modify: `api/tests/conftest.py` (fixture autouse di reset)
- Modify: `web/src/lib/permissions.ts`
- Test: `api/tests/test_permissions_mcp.py`

**Interfaces:**
- Produces: `Permission.mcp_access`; `DEFAULT_PERMISSIONS` senza `mcp_access`; `rate_limit.consume(bucket: str, key: str, *, limit: int, window_seconds: int = 60) -> bool` (True = oltre il limite, la richiesta va rifiutata); `rate_limit.reset_all() -> None`.
- Produces (web): tipo `Permission` include `"mcp.access"`.

- [ ] **Step 1: Scrivi i test che falliscono**

`api/tests/test_permissions_mcp.py`:

```python
"""The mcp.access permission and the generic rate-limit buckets."""

from app.auth import rate_limit
from app.models.user import Role, User
from app.permissions import (
    DEFAULT_PERMISSIONS,
    PERMISSION_LABELS,
    Permission,
    effective_permissions,
)
from tests.factories import http_client, make_user


def test_mcp_access_is_opt_in() -> None:
    assert Permission.mcp_access.value == "mcp.access"
    assert Permission.mcp_access not in DEFAULT_PERMISSIONS
    assert PERMISSION_LABELS[Permission.mcp_access] == "Connessioni AI (MCP)"


def test_admin_always_has_mcp_access() -> None:
    admin = User(username="root", display_name="Root", role=Role.admin, permissions=[])
    assert Permission.mcp_access in effective_permissions(admin)


def test_consume_limits_per_bucket_and_key() -> None:
    for _ in range(3):
        assert rate_limit.consume("t", "1.2.3.4", limit=3) is False
    assert rate_limit.consume("t", "1.2.3.4", limit=3) is True
    assert rate_limit.consume("t", "5.6.7.8", limit=3) is False
    assert rate_limit.consume("other", "1.2.3.4", limit=3) is False


async def test_admin_created_user_does_not_get_mcp_access(db) -> None:
    admin = await make_user(db, username="root", role=Role.admin)
    async with await http_client(db, admin) as client:
        response = await client.post(
            "/api/admin/users", json={"username": "bob", "display_name": "Bob", "role": "user"}
        )
    assert response.status_code == 201, response.text
    assert "mcp.access" not in response.json()["permissions"]
    assert "goals.edit" in response.json()["permissions"]
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `.venv\Scripts\python -m pytest tests/test_permissions_mcp.py -v`
Expected: FAIL con `AttributeError: mcp_access`.

- [ ] **Step 3: Implementa il permesso**

In `api/app/permissions.py`:

```python
class Permission(str, enum.Enum):
    foods_off_lookup = "foods.off_lookup"
    foods_custom_create = "foods.custom_create"
    diary_copy = "diary.copy"
    goals_edit = "goals.edit"
    mcp_access = "mcp.access"


PERMISSION_LABELS: dict[Permission, str] = {
    Permission.foods_off_lookup: "Ricerca su OpenFoodFacts",
    Permission.foods_custom_create: "Crea alimenti personalizzati",
    Permission.diary_copy: "Copia giorni del diario",
    Permission.goals_edit: "Modifica gli obiettivi",
    Permission.mcp_access: "Connessioni AI (MCP)",
}
# AI connections are opt-in: an administrator grants them explicitly.
DEFAULT_PERMISSIONS = frozenset(Permission) - {Permission.mcp_access}
```

- [ ] **Step 4: Implementa i bucket di rate limit**

In `api/app/auth/rate_limit.py`, dopo `_login_attempts: ...` aggiungi:

```python
_buckets: dict[tuple[str, str], list[float]] = defaultdict(list)
```

e dopo `record_attempt`:

```python
def consume(bucket: str, key: str, *, limit: int, window_seconds: int = 60) -> bool:
    """Count one hit for `key` in `bucket`; return True when it is over `limit`.

    Separate from the login limiter above so OAuth/MCP traffic can never lock
    people out of the web login (and vice versa).
    """
    now = time.monotonic()
    hits = _buckets[(bucket, key)]
    cutoff = now - window_seconds
    while hits and hits[0] < cutoff:
        hits.pop(0)
    if len(hits) >= limit:
        return True
    hits.append(now)
    return False


def reset_all() -> None:
    """Test hook: forget every recorded attempt."""
    _login_attempts.clear()
    _buckets.clear()
```

In `api/tests/conftest.py` aggiungi l'import `from app.auth import rate_limit` e in fondo:

```python
@pytest.fixture(autouse=True)
def _reset_rate_limits():
    rate_limit.reset_all()
    yield
    rate_limit.reset_all()
```

- [ ] **Step 5: Aggiorna il tipo web**

`web/src/lib/permissions.ts`:

```ts
export type Permission = "foods.off_lookup" | "foods.custom_create" | "diary.copy" | "goals.edit" | "mcp.access";

export const PERMISSIONS: Permission[] = ["foods.off_lookup", "foods.custom_create", "diary.copy", "goals.edit", "mcp.access"];
```

- [ ] **Step 6: Esegui i test**

Run: `.venv\Scripts\python -m pytest tests/test_permissions_mcp.py -v` → PASS; `.venv\Scripts\python -m pytest -q` → verde.
Run (da `web/`): `npm test` e `npm run build` → verdi.

- [ ] **Step 7: Commit**

```bash
git add api/app/permissions.py api/app/auth/rate_limit.py api/tests/conftest.py api/tests/test_permissions_mcp.py web/src/lib/permissions.ts
git commit -m "feat(api): add opt-in mcp.access permission and generic rate-limit buckets"
```

---

### Task 5: Modelli e migration OAuth

**Files:**
- Create: `api/app/models/oauth.py`
- Modify: `api/app/models/__init__.py`
- Create: `api/alembic/versions/7c3e1a9b5d20_oauth_mcp.py`
- Test: `api/tests/test_oauth_models.py`

**Interfaces:**
- Produces: modelli `OAuthClient(id, client_id, client_name, client_secret_enc, info, created_at)`, `OAuthAuthCode(id, code_hash, client_id, user_id, redirect_uri, redirect_uri_provided_explicitly, code_challenge, scopes, resource, expires_at, used_at, created_at)`, `OAuthTokenPair(id, user_id, client_id, family_id, access_token_hash, access_expires_at, refresh_token_hash, refresh_expires_at, scopes, auth_version, created_at, last_used_at, rotated_at, revoked_at)`. `client_id` delle tabelle figlie è FK su `oauth_clients.client_id` (stringa).

- [ ] **Step 1: Scrivi il test che fallisce**

`api/tests/test_oauth_models.py`:

```python
"""OAuth storage tables (needs Postgres with migrations applied)."""

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.models.oauth import OAuthAuthCode, OAuthClient, OAuthTokenPair
from app.models.user import User
from tests.factories import make_user


async def test_deleting_a_user_cascades_codes_and_tokens(db) -> None:
    user = await make_user(db)
    now = datetime.now(UTC)
    db.add(OAuthClient(client_id="client-1", client_name="Claude", info={"redirect_uris": []}))
    await db.flush()
    db.add(OAuthAuthCode(
        code_hash="a" * 64, client_id="client-1", user_id=user.id,
        redirect_uri="https://claude.ai/cb", redirect_uri_provided_explicitly=True,
        code_challenge="c" * 43, scopes=[], expires_at=now + timedelta(minutes=5),
    ))
    db.add(OAuthTokenPair(
        user_id=user.id, client_id="client-1", family_id="f1",
        access_token_hash="b" * 64, access_expires_at=now + timedelta(hours=1),
        refresh_token_hash="d" * 64, refresh_expires_at=now + timedelta(days=30),
        scopes=[], auth_version=user.auth_version,
    ))
    await db.flush()

    await db.execute(sa.delete(User).where(User.id == user.id))

    assert await db.scalar(sa.select(sa.func.count()).select_from(OAuthAuthCode)) == 0
    assert await db.scalar(sa.select(sa.func.count()).select_from(OAuthTokenPair)) == 0
    assert await db.scalar(sa.select(sa.func.count()).select_from(OAuthClient)) == 1
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `.venv\Scripts\python -m pytest tests/test_oauth_models.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'app.models.oauth'`.

- [ ] **Step 3: Crea i modelli**

`api/app/models/oauth.py`:

```python
"""OAuth 2.1 storage behind the MCP endpoint (see `app/mcp/oauth.py`).

Codes and tokens are stored only as SHA-256 hashes, like `user_sessions`.
A confidential client's secret is stored encrypted (the MCP SDK compares
it in plaintext), public clients have none.
"""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class OAuthClient(Base):
    """A dynamically registered OAuth client (e.g. one Claude connector)."""

    __tablename__ = "oauth_clients"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    client_id: Mapped[str] = mapped_column(sa.String(64), unique=True, nullable=False)
    client_name: Mapped[str | None] = mapped_column(sa.String(255))
    client_secret_enc: Mapped[str | None] = mapped_column(sa.Text)
    # `OAuthClientInformationFull` as JSON, minus `client_secret`.
    info: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


class OAuthAuthCode(Base):
    """A one-time authorization code issued after the user's consent."""

    __tablename__ = "oauth_auth_codes"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    code_hash: Mapped[str] = mapped_column(sa.String(64), unique=True, nullable=False)
    client_id: Mapped[str] = mapped_column(
        sa.ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    redirect_uri: Mapped[str] = mapped_column(sa.Text, nullable=False)
    redirect_uri_provided_explicitly: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    code_challenge: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default=sa.text("'[]'::jsonb"))
    resource: Mapped[str | None] = mapped_column(sa.Text)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


class OAuthTokenPair(Base):
    """One access/refresh token pair. Refreshing rotates: the old row gets
    `rotated_at` and a new row joins the same `family_id`, so reuse of a
    rotated refresh token can revoke the whole family."""

    __tablename__ = "oauth_tokens"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_id: Mapped[str] = mapped_column(
        sa.ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False, index=True
    )
    family_id: Mapped[str] = mapped_column(sa.String(36), nullable=False, index=True)
    access_token_hash: Mapped[str] = mapped_column(sa.String(64), unique=True, nullable=False)
    access_expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    refresh_token_hash: Mapped[str] = mapped_column(sa.String(64), unique=True, nullable=False)
    refresh_expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default=sa.text("'[]'::jsonb"))
    auth_version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    rotated_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
```

In `api/app/models/__init__.py` aggiungi `from app.models.oauth import OAuthAuthCode, OAuthClient, OAuthTokenPair` e i tre nomi in `__all__` (ordine alfabetico).

- [ ] **Step 4: Scrivi la migration a mano**

`api/alembic/versions/7c3e1a9b5d20_oauth_mcp.py`:

```python
"""OAuth 2.1 storage for the MCP endpoint.

Revision ID: 7c3e1a9b5d20
Revises: 4f2a6d9e8b31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "7c3e1a9b5d20"
down_revision: str | Sequence[str] | None = "4f2a6d9e8b31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EMPTY_JSON = sa.text("'[]'::jsonb")


def upgrade() -> None:
    op.create_table(
        "oauth_clients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("client_id", sa.String(64), nullable=False, unique=True),
        sa.Column("client_name", sa.String(255), nullable=True),
        sa.Column("client_secret_enc", sa.Text(), nullable=True),
        sa.Column("info", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "oauth_auth_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("client_id", sa.String(64), sa.ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("redirect_uri_provided_explicitly", sa.Boolean(), nullable=False),
        sa.Column("code_challenge", sa.String(128), nullable=False),
        sa.Column("scopes", postgresql.JSONB(), nullable=False, server_default=_EMPTY_JSON),
        sa.Column("resource", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_oauth_auth_codes_client_id", "oauth_auth_codes", ["client_id"])
    op.create_index("ix_oauth_auth_codes_user_id", "oauth_auth_codes", ["user_id"])
    op.create_table(
        "oauth_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", sa.String(64), sa.ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False),
        sa.Column("family_id", sa.String(36), nullable=False),
        sa.Column("access_token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("refresh_token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("refresh_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scopes", postgresql.JSONB(), nullable=False, server_default=_EMPTY_JSON),
        sa.Column("auth_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_oauth_tokens_user_id", "oauth_tokens", ["user_id"])
    op.create_index("ix_oauth_tokens_client_id", "oauth_tokens", ["client_id"])
    op.create_index("ix_oauth_tokens_family_id", "oauth_tokens", ["family_id"])


def downgrade() -> None:
    op.drop_table("oauth_tokens")
    op.drop_table("oauth_auth_codes")
    op.drop_table("oauth_clients")
```

(Il file è lungo più di 100 colonne in alcune righe: se `ruff check` segnala `E501` sulla cartella `alembic`, spezza le righe; la config attuale di ruff lo controlla solo se la cartella è inclusa — verifica con `ruff check alembic`.)

- [ ] **Step 5: Applica la migration e verifica il round-trip**

```bash
.venv\Scripts\python -m alembic upgrade head
.venv\Scripts\python -m alembic downgrade -1
.venv\Scripts\python -m alembic upgrade head
```

Expected: nessun errore.

- [ ] **Step 6: Esegui i test**

Run: `.venv\Scripts\python -m pytest tests/test_oauth_models.py -v` → PASS; `.venv\Scripts\python -m pytest -q` → verde.

- [ ] **Step 7: Commit**

```bash
git add api/app/models/oauth.py api/app/models/__init__.py api/alembic/versions/7c3e1a9b5d20_oauth_mcp.py api/tests/test_oauth_models.py
git commit -m "feat(api): add OAuth client, code and token tables for MCP"
```

---
### Task 6: Provider OAuth su Postgres

**Files:**
- Create: `api/app/mcp/__init__.py`
- Create: `api/app/mcp/consent.py`
- Create: `api/app/mcp/oauth.py`
- Test: `api/tests/test_mcp_oauth_provider.py`

**Interfaces:**
- Consumes: modelli OAuth (Task 5), `session_scope` (Task 1), `Permission.mcp_access` (Task 4), `encrypt_secret/decrypt_secret` (`app/auth/totp.py`), `record` (`app/services/audit.py`).
- Produces (`app.mcp.consent`): `sign_request(data: dict) -> str`, `load_request(token: str) -> dict | None` (validità 600 s, salt `oauth-authorize`). Il dict ha le chiavi `client_id`, `redirect_uri`, `redirect_uri_provided_explicitly`, `code_challenge`, `state`, `scopes`, `resource`.
- Produces (`app.mcp.oauth`):
  - `hash_token(value: str) -> str`, `redirect_uri_allowed(uri: str) -> bool`, `user_may_connect(user: User) -> bool`
  - `async create_authorization_code(db, user, request: dict) -> str` (URL di redirect con `code` e `state`; **non** fa commit)
  - `denied_redirect(request: dict) -> str`
  - `async issue_tokens(db, user, client_id: str, scopes: list[str], family_id: str | None = None) -> OAuthToken` (fa commit)
  - `async revoke_user_tokens(db, user_id: int, client_id: str | None = None) -> int` (non fa commit)
  - `async list_connections(db, user_id: int) -> list[dict]` (chiavi `client_id`, `client_name`, `connected_at`, `last_used_at`)
  - `async purge_expired(db, now: datetime | None = None) -> tuple[int, int]` (fa commit; usata dal Task 11)
  - `class PostgresOAuthProvider` con i metodi del protocollo `OAuthAuthorizationServerProvider`.

- [ ] **Step 1: Scrivi i test che falliscono**

`api/tests/test_mcp_oauth_provider.py`:

```python
"""PostgresOAuthProvider, driven directly (no HTTP). Needs Postgres."""

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
import sqlalchemy as sa
from mcp.server.auth.provider import AuthorizationParams, RegistrationError, TokenError
from mcp.shared.auth import OAuthClientInformationFull

from app.mcp.consent import load_request, sign_request
from app.mcp.oauth import (
    PostgresOAuthProvider,
    create_authorization_code,
    hash_token,
    list_connections,
    revoke_user_tokens,
)
from app.models.oauth import OAuthClient, OAuthTokenPair
from app.models.user import AuditEvent
from tests.factories import make_user

REDIRECT = "https://claude.ai/api/mcp/auth_callback"


def client_info(client_id: str = "client-1", redirect: str = REDIRECT, secret: str | None = None):
    return OAuthClientInformationFull(
        client_id=client_id, client_secret=secret, redirect_uris=[redirect], client_name="Claude",
        token_endpoint_auth_method="none" if secret is None else "client_secret_post",
        grant_types=["authorization_code", "refresh_token"], response_types=["code"],
    )


def params(state: str = "st4te") -> AuthorizationParams:
    return AuthorizationParams(
        state=state, scopes=[], code_challenge="c" * 43, redirect_uri=REDIRECT,
        redirect_uri_provided_explicitly=True,
    )


def query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


async def consent_code(db, provider, user, client) -> str:
    """authorize() -> signed request -> approved consent -> raw code."""
    url = await provider.authorize(client, params())
    request = load_request(query(url)["req"])
    redirect = await create_authorization_code(db, user, request)
    await db.commit()
    return query(redirect)["code"]


async def connect(db, provider, user, client) -> tuple[str, str]:
    await provider.register_client(client)
    code = await consent_code(db, provider, user, client)
    loaded = await provider.load_authorization_code(client, code)
    token = await provider.exchange_authorization_code(client, loaded)
    return token.access_token, token.refresh_token


@pytest.fixture
def provider() -> PostgresOAuthProvider:
    return PostgresOAuthProvider()


async def test_register_rejects_plain_http_redirect(db, provider) -> None:
    with pytest.raises(RegistrationError) as info:
        await provider.register_client(client_info(redirect="http://evil.example/cb"))
    assert info.value.error == "invalid_redirect_uri"


async def test_register_accepts_loopback_http(db, provider) -> None:
    await provider.register_client(client_info(redirect="http://127.0.0.1:33418/callback"))
    assert await provider.get_client("client-1") is not None


async def test_client_secret_is_stored_encrypted(db, provider) -> None:
    await provider.register_client(client_info(secret="s3cret-value"))
    row = await db.scalar(sa.select(OAuthClient).where(OAuthClient.client_id == "client-1"))
    assert row.client_secret_enc and "s3cret-value" not in row.client_secret_enc
    assert "client_secret" not in row.info
    assert (await provider.get_client("client-1")).client_secret == "s3cret-value"


async def test_authorize_redirects_to_consent_page_with_signed_request(db, provider) -> None:
    client = client_info()
    await provider.register_client(client)
    url = await provider.authorize(client, params(state="xyz"))
    assert url.startswith("http://localhost:6500/connect?req=")
    request = load_request(query(url)["req"])
    assert request["state"] == "xyz"
    assert request["code_challenge"] == "c" * 43
    assert request["redirect_uri"] == REDIRECT


def test_load_request_rejects_tampering() -> None:
    token = sign_request({"client_id": "a"})
    assert load_request(token + "x") is None


async def test_full_flow_issues_a_valid_access_token(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    access, _ = await connect(db, provider, user, client_info())
    loaded = await provider.load_access_token(access)
    assert loaded is not None
    assert (loaded.subject, loaded.client_id) == (str(user.id), "client-1")
    row = await db.scalar(sa.select(OAuthTokenPair))
    assert row.access_token_hash == hash_token(access)


async def test_code_reuse_is_rejected_and_revokes_tokens(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    client = client_info()
    await provider.register_client(client)
    code = await consent_code(db, provider, user, client)
    token = await provider.exchange_authorization_code(
        client, await provider.load_authorization_code(client, code)
    )
    assert await provider.load_authorization_code(client, code) is None
    assert await provider.load_access_token(token.access_token) is None
    actions = (await db.scalars(sa.select(AuditEvent.action))).all()
    assert "mcp.token_reuse" in actions


async def test_exchange_fails_when_permission_removed_after_consent(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    client = client_info()
    await provider.register_client(client)
    code = await consent_code(db, provider, user, client)
    loaded = await provider.load_authorization_code(client, code)
    user.permissions = []
    await db.flush()
    with pytest.raises(TokenError) as info:
        await provider.exchange_authorization_code(client, loaded)
    assert info.value.error == "invalid_grant"


async def test_refresh_rotates_the_pair(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    client = client_info()
    access, refresh = await connect(db, provider, user, client)
    loaded = await provider.load_refresh_token(client, refresh)
    new = await provider.exchange_refresh_token(client, loaded, [])
    assert new.access_token != access and new.refresh_token != refresh
    assert await provider.load_access_token(access) is None
    assert await provider.load_access_token(new.access_token) is not None


async def test_rotated_refresh_reuse_revokes_the_family(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    client = client_info()
    _, refresh = await connect(db, provider, user, client)
    new = await provider.exchange_refresh_token(
        client, await provider.load_refresh_token(client, refresh), []
    )
    assert await provider.load_refresh_token(client, refresh) is None
    assert await provider.load_access_token(new.access_token) is None


@pytest.mark.parametrize("change", ["auth_version", "inactive", "permission"])
async def test_access_token_dies_with_the_account_state(db, provider, change) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    access, _ = await connect(db, provider, user, client_info())
    if change == "auth_version":
        user.auth_version += 1
    elif change == "inactive":
        user.is_active = False
    else:
        user.permissions = []
    await db.flush()
    assert await provider.load_access_token(access) is None


async def test_expired_access_token_is_rejected(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    access, _ = await connect(db, provider, user, client_info())
    row = await db.scalar(sa.select(OAuthTokenPair))
    row.access_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db.flush()
    assert await provider.load_access_token(access) is None


async def test_revoke_token_kills_access_and_refresh(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    client = client_info()
    access, refresh = await connect(db, provider, user, client)
    await provider.revoke_token(await provider.load_access_token(access))
    assert await provider.load_access_token(access) is None
    assert await provider.load_refresh_token(client, refresh) is None


async def test_list_and_revoke_connections(db, provider) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    access, _ = await connect(db, provider, user, client_info())
    connections = await list_connections(db, user.id)
    assert [(c["client_id"], c["client_name"]) for c in connections] == [("client-1", "Claude")]
    assert await revoke_user_tokens(db, user.id, "client-1") == 1
    await db.commit()
    assert await list_connections(db, user.id) == []
    assert await provider.load_access_token(access) is None
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `.venv\Scripts\python -m pytest tests/test_mcp_oauth_provider.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'app.mcp'`.

- [ ] **Step 3: Crea il package e il firmatario della richiesta**

`api/app/mcp/__init__.py`:

```python
"""MCP server: OAuth 2.1 provider, tools and HTTP app mounted by `app.main`."""
```

`api/app/mcp/consent.py`:

```python
"""Signed, short-lived carrier for a pending /authorize request.

`PostgresOAuthProvider.authorize` cannot finish on its own: the user must
log in (password + TOTP) and approve in the SPA first. The validated
authorization parameters travel to `/connect` and back to
`POST /api/oauth/consent` inside this signed token, so nothing is stored
server-side until the user approves.
"""

from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.config import settings

MAX_AGE_SECONDS = 600


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.app_key, salt="oauth-authorize")


def sign_request(data: dict) -> str:
    return _serializer().dumps(data)


def load_request(token: str) -> dict | None:
    """The request dict, or None when tampered with or older than 10 minutes."""
    try:
        return _serializer().loads(token, max_age=MAX_AGE_SECONDS)
    except BadSignature:  # SignatureExpired is a subclass
        return None
```

- [ ] **Step 4: Crea il provider**

`api/app/mcp/oauth.py`:

```python
"""OAuth 2.1 authorization server storage and policy for the MCP endpoint.

The MCP SDK serves the protocol endpoints (/register, /authorize, /token,
/revoke and the metadata documents) and calls `PostgresOAuthProvider` for
storage. Every access-token check re-validates the account (active, same
`auth_version`, still holding `mcp.access`), so password/TOTP resets,
deactivation and permission removal cut MCP access immediately.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlsplit

import sqlalchemy as sa
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.totp import decrypt_secret, encrypt_secret
from app.config import settings
from app.db import session_scope
from app.mcp.consent import sign_request
from app.models.oauth import OAuthAuthCode, OAuthClient, OAuthTokenPair
from app.models.user import User
from app.permissions import Permission, effective_permissions
from app.services.audit import record

AUTH_CODE_TTL = timedelta(minutes=5)
LAST_USED_RESOLUTION = timedelta(minutes=5)


def _now() -> datetime:
    return datetime.now(UTC)


def hash_token(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def redirect_uri_allowed(uri: str) -> bool:
    """https anywhere; plain http only for loopback (desktop/CLI clients)."""
    parts = urlsplit(uri)
    if parts.scheme == "https":
        return bool(parts.hostname)
    return parts.scheme == "http" and parts.hostname in {"localhost", "127.0.0.1"}


def user_may_connect(user: User) -> bool:
    return user.is_active and Permission.mcp_access in effective_permissions(user)


def _grant_valid(row: OAuthTokenPair, user: User) -> bool:
    return row.auth_version == user.auth_version and user_may_connect(user)


class StoredAuthCode(AuthorizationCode):
    row_id: int
    user_id: int


class StoredRefreshToken(RefreshToken):
    row_id: int
    family_id: str


async def issue_tokens(
    db: AsyncSession, user: User, client_id: str, scopes: list[str], family_id: str | None = None
) -> OAuthToken:
    access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    now = _now()
    db.add(OAuthTokenPair(
        user_id=user.id, client_id=client_id, family_id=family_id or str(uuid.uuid4()),
        access_token_hash=hash_token(access),
        access_expires_at=now + timedelta(minutes=settings.oauth_access_token_minutes),
        refresh_token_hash=hash_token(refresh),
        refresh_expires_at=now + timedelta(days=settings.oauth_refresh_token_days),
        scopes=list(scopes), auth_version=user.auth_version, created_at=now,
    ))
    await db.commit()
    return OAuthToken(
        access_token=access, expires_in=settings.oauth_access_token_minutes * 60,
        refresh_token=refresh, scope=" ".join(scopes) or None,
    )


async def revoke_user_tokens(db: AsyncSession, user_id: int, client_id: str | None = None) -> int:
    """Revoke every live token pair of a user (optionally for one client). No commit."""
    stmt = (
        sa.update(OAuthTokenPair)
        .where(OAuthTokenPair.user_id == user_id, OAuthTokenPair.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    if client_id is not None:
        stmt = stmt.where(OAuthTokenPair.client_id == client_id)
    return (await db.execute(stmt)).rowcount


async def _revoke_family(db: AsyncSession, family_id: str) -> None:
    await db.execute(
        sa.update(OAuthTokenPair)
        .where(OAuthTokenPair.family_id == family_id, OAuthTokenPair.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


async def _record_reuse(db: AsyncSession, user_id: int, client_id: str, kind: str) -> None:
    user = await db.get(User, user_id)
    await record(db, user, "mcp.token_reuse", user_id, {"client_id": client_id, "kind": kind})


async def list_connections(db: AsyncSession, user_id: int) -> list[dict]:
    """Clients holding a live (not revoked, not rotated, refreshable) grant."""
    last_used = sa.func.max(
        sa.func.coalesce(OAuthTokenPair.last_used_at, OAuthTokenPair.created_at)
    )
    rows = await db.execute(
        sa.select(OAuthClient.client_id, OAuthClient.client_name, OAuthClient.created_at, last_used)
        .join(OAuthTokenPair, OAuthTokenPair.client_id == OAuthClient.client_id)
        .where(
            OAuthTokenPair.user_id == user_id,
            OAuthTokenPair.revoked_at.is_(None),
            OAuthTokenPair.rotated_at.is_(None),
            OAuthTokenPair.refresh_expires_at > _now(),
        )
        .group_by(OAuthClient.client_id, OAuthClient.client_name, OAuthClient.created_at)
        .order_by(OAuthClient.created_at.desc())
    )
    return [
        {"client_id": cid, "client_name": name or "Client MCP", "connected_at": created,
         "last_used_at": used}
        for cid, name, created, used in rows
    ]


async def create_authorization_code(db: AsyncSession, user: User, request: dict) -> str:
    """Persist a one-time code for an approved consent and return the client
    redirect URL carrying it. The caller commits."""
    now = _now()
    # Opportunistic cleanup of long-dead codes.
    await db.execute(
        sa.delete(OAuthAuthCode).where(OAuthAuthCode.expires_at < now - timedelta(days=1))
    )
    code = secrets.token_urlsafe(32)
    db.add(OAuthAuthCode(
        code_hash=hash_token(code), client_id=request["client_id"], user_id=user.id,
        redirect_uri=request["redirect_uri"],
        redirect_uri_provided_explicitly=request["redirect_uri_provided_explicitly"],
        code_challenge=request["code_challenge"], scopes=request["scopes"],
        resource=request["resource"], expires_at=now + AUTH_CODE_TTL,
    ))
    return construct_redirect_uri(request["redirect_uri"], code=code, state=request["state"])


def denied_redirect(request: dict) -> str:
    return construct_redirect_uri(
        request["redirect_uri"], error="access_denied",
        error_description="The user denied the request", state=request["state"],
    )


async def purge_expired(db: AsyncSession, now: datetime | None = None) -> tuple[int, int]:
    """Delete dead codes (>1 day) and dead token rows (refresh expired, or
    revoked/rotated more than 30 days ago). Returns (codes, tokens) deleted."""
    now = now or _now()
    codes = await db.execute(sa.delete(OAuthAuthCode).where(sa.or_(
        OAuthAuthCode.expires_at < now - timedelta(days=1),
        OAuthAuthCode.used_at < now - timedelta(days=1),
    )))
    tokens = await db.execute(sa.delete(OAuthTokenPair).where(sa.or_(
        OAuthTokenPair.refresh_expires_at < now,
        OAuthTokenPair.revoked_at < now - timedelta(days=30),
        OAuthTokenPair.rotated_at < now - timedelta(days=30),
    )))
    await db.commit()
    return codes.rowcount, tokens.rowcount


class PostgresOAuthProvider:
    """`OAuthAuthorizationServerProvider` backed by Postgres."""

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with session_scope() as db:
            row = await db.scalar(sa.select(OAuthClient).where(OAuthClient.client_id == client_id))
        if row is None:
            return None
        data = dict(row.info)
        data["client_secret"] = (
            decrypt_secret(row.client_secret_enc) if row.client_secret_enc else None
        )
        return OAuthClientInformationFull.model_validate(data)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        uris = [str(uri) for uri in client_info.redirect_uris or []]
        if not uris or not all(redirect_uri_allowed(uri) for uri in uris):
            raise RegistrationError(
                "invalid_redirect_uri", "redirect URIs must use https (or http on localhost)"
            )
        async with session_scope() as db:
            db.add(OAuthClient(
                client_id=client_info.client_id,
                client_name=(client_info.client_name or "")[:255] or None,
                client_secret_enc=(
                    encrypt_secret(client_info.client_secret) if client_info.client_secret else None
                ),
                info=client_info.model_dump(mode="json", exclude={"client_secret"}, exclude_none=True),
            ))
            await db.commit()

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        request = {
            "client_id": client.client_id,
            "redirect_uri": str(params.redirect_uri),
            "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
            "code_challenge": params.code_challenge,
            "state": params.state,
            "scopes": params.scopes or [],
            "resource": params.resource,
        }
        base = settings.public_base_url.rstrip("/")
        return f"{base}/connect?{urlencode({'req': sign_request(request)})}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> StoredAuthCode | None:
        async with session_scope() as db:
            row = await db.scalar(sa.select(OAuthAuthCode).where(
                OAuthAuthCode.code_hash == hash_token(authorization_code),
                OAuthAuthCode.client_id == client.client_id,
            ))
            if row is None:
                return None
            if row.used_at is not None:
                # A replayed code means it leaked: kill what it produced.
                await revoke_user_tokens(db, row.user_id, row.client_id)
                await _record_reuse(db, row.user_id, row.client_id, "authorization_code")
                await db.commit()
                return None
            return StoredAuthCode(
                code=authorization_code, scopes=list(row.scopes),
                expires_at=row.expires_at.timestamp(), client_id=row.client_id,
                code_challenge=row.code_challenge, redirect_uri=row.redirect_uri,
                redirect_uri_provided_explicitly=row.redirect_uri_provided_explicitly,
                resource=row.resource, subject=str(row.user_id), row_id=row.id,
                user_id=row.user_id,
            )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: StoredAuthCode
    ) -> OAuthToken:
        async with session_scope() as db:
            used = await db.execute(
                sa.update(OAuthAuthCode)
                .where(
                    OAuthAuthCode.id == authorization_code.row_id,
                    OAuthAuthCode.used_at.is_(None),
                )
                .values(used_at=_now())
            )
            if used.rowcount != 1:
                raise TokenError("invalid_grant", "authorization code already used")
            user = await db.get(User, authorization_code.user_id)
            if user is None or not user_may_connect(user):
                await db.commit()
                raise TokenError("invalid_grant", "access to this account is not allowed")
            return await issue_tokens(db, user, client.client_id, authorization_code.scopes)

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> StoredRefreshToken | None:
        async with session_scope() as db:
            found = (await db.execute(
                sa.select(OAuthTokenPair, User)
                .join(User, User.id == OAuthTokenPair.user_id)
                .where(
                    OAuthTokenPair.refresh_token_hash == hash_token(refresh_token),
                    OAuthTokenPair.client_id == client.client_id,
                )
            )).one_or_none()
            if found is None:
                return None
            row, user = found
            if row.rotated_at is not None and row.revoked_at is None:
                # A rotated refresh token came back: it leaked. Kill the family.
                await _revoke_family(db, row.family_id)
                await _record_reuse(db, row.user_id, row.client_id, "refresh_token")
                await db.commit()
                return None
            if row.revoked_at is not None or row.refresh_expires_at <= _now():
                return None
            if not _grant_valid(row, user):
                return None
            return StoredRefreshToken(
                token=refresh_token, client_id=row.client_id, scopes=list(row.scopes),
                expires_at=int(row.refresh_expires_at.timestamp()),
                resource=settings.mcp_resource_url, subject=str(user.id),
                row_id=row.id, family_id=row.family_id,
            )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: StoredRefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        async with session_scope() as db:
            rotated = await db.execute(
                sa.update(OAuthTokenPair)
                .where(
                    OAuthTokenPair.id == refresh_token.row_id,
                    OAuthTokenPair.rotated_at.is_(None),
                    OAuthTokenPair.revoked_at.is_(None),
                )
                .values(rotated_at=_now())
            )
            if rotated.rowcount != 1:
                raise TokenError("invalid_grant", "refresh token is no longer valid")
            user = await db.get(User, int(refresh_token.subject))
            if user is None:
                raise TokenError("invalid_grant", "refresh token is no longer valid")
            granted = (
                [s for s in scopes if s in refresh_token.scopes] if scopes else refresh_token.scopes
            )
            return await issue_tokens(
                db, user, client.client_id, granted, family_id=refresh_token.family_id
            )

    async def load_access_token(self, token: str) -> AccessToken | None:
        async with session_scope() as db:
            found = (await db.execute(
                sa.select(OAuthTokenPair, User)
                .join(User, User.id == OAuthTokenPair.user_id)
                .where(OAuthTokenPair.access_token_hash == hash_token(token))
            )).one_or_none()
            if found is None:
                return None
            row, user = found
            now = _now()
            if (
                row.revoked_at is not None
                or row.rotated_at is not None
                or row.access_expires_at <= now
                or not _grant_valid(row, user)
            ):
                return None
            if row.last_used_at is None or row.last_used_at <= now - LAST_USED_RESOLUTION:
                row.last_used_at = now
                await db.commit()
            return AccessToken(
                token=token, client_id=row.client_id, scopes=list(row.scopes),
                expires_at=int(row.access_expires_at.timestamp()),
                resource=settings.mcp_resource_url, subject=str(user.id),
            )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        async with session_scope() as db:
            digest = hash_token(token.token)
            row = await db.scalar(sa.select(OAuthTokenPair).where(sa.or_(
                OAuthTokenPair.access_token_hash == digest,
                OAuthTokenPair.refresh_token_hash == digest,
            )))
            if row is None:
                return
            await _revoke_family(db, row.family_id)
            await db.commit()
```

Nota sui test: nel fixture `db` gli oggetti `User` stanno nella identity map della stessa sessione usata dal provider, quindi le modifiche fatte dal test (es. `user.auth_version += 1` + `flush`) sono viste dal provider. In produzione ogni chiamata usa una sessione nuova.

Nota su `update(...)` + oggetti già in sessione: dopo un `sa.update` bulk, gli oggetti `OAuthTokenPair` già caricati nella identity map possono avere attributi vecchi. Le query del provider selezionano sempre di nuovo con `sa.select`, e SQLAlchemy 2 aggiorna gli attributi delle righe riselezionate solo se scaduti. Se un test vede valori vecchi (es. `revoked_at` ancora `None` dopo una revoca), aggiungi `.execution_options(synchronize_session="fetch")` agli `sa.update` in `revoke_user_tokens`, `_revoke_family`, `exchange_authorization_code` ed `exchange_refresh_token`, oppure `populate_existing=True` nelle select del provider.

- [ ] **Step 5: Esegui i test**

Run: `.venv\Scripts\python -m pytest tests/test_mcp_oauth_provider.py -v` → PASS.
Run: `.venv\Scripts\python -m pytest -q` e `.venv\Scripts\python -m ruff check app tests` → verdi.

- [ ] **Step 6: Commit**

```bash
git add api/app/mcp/__init__.py api/app/mcp/consent.py api/app/mcp/oauth.py api/tests/test_mcp_oauth_provider.py
git commit -m "feat(api): Postgres-backed OAuth 2.1 provider for the MCP endpoint"
```

---

### Task 7: API di consenso e connessioni, revoche collegate, `mcp_url`

**Files:**
- Create: `api/app/schemas/oauth.py`
- Create: `api/app/routers/oauth.py`
- Modify: `api/app/main.py` (include router)
- Modify: `api/app/routers/admin.py`
- Modify: `api/app/routers/auth.py`
- Test: `api/tests/test_oauth_router.py`

**Interfaces:**
- Consumes: `load_request`, `create_authorization_code`, `denied_redirect`, `user_may_connect`, `list_connections`, `revoke_user_tokens`, `PostgresOAuthProvider` (Task 6); `consume`, `client_ip` (Task 4 / esistente).
- Produces (HTTP):
  - `GET /api/oauth/consent?req=` → `{client_name, redirect_host, user: {username, display_name}, has_permission}`; 400 `"richiesta scaduta"` se `req` non è valido.
  - `POST /api/oauth/consent` body `{req, approve}` → `{redirect_url}`; 403 `"mcp_access_missing"`; 400 come sopra; 429 oltre 20/min per IP.
  - `GET /api/oauth/connections` → lista connessioni; `DELETE /api/oauth/connections/{client_id}` → 204, oppure 404 `"connection not found"`.
  - `GET /api/admin/users/{id}/mcp-connections`, `DELETE /api/admin/users/{id}/mcp-connections` (204).
  - `GET /api/auth/me` aggiunge `mcp_url`.
  - `DELETE /api/admin/users/{id}/sessions`, disattivazione utente e `POST /api/auth/password` revocano anche i token OAuth.
- Audit: `mcp.connect` (consenso approvato, details `{"client": nome}`), `mcp.revoke` (details `{"client_id": ...}` oppure `{"source": "admin"}`).

- [ ] **Step 1: Scrivi i test che falliscono**

`api/tests/test_oauth_router.py`:

```python
"""SPA-facing consent and connection endpoints (needs Postgres)."""

from urllib.parse import parse_qs, urlsplit

import pytest
import sqlalchemy as sa
from mcp.server.auth.provider import AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull

from app.mcp.consent import load_request
from app.mcp.oauth import PostgresOAuthProvider, create_authorization_code, list_connections
from app.models.oauth import OAuthTokenPair
from app.models.user import AuditEvent, Role
from tests.factories import PASSWORD, http_client, make_user

REDIRECT = "https://claude.ai/api/mcp/auth_callback"


def query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


async def pending_request(client_id: str = "client-1") -> str:
    """Register a client and return the signed `req` the SPA receives."""
    provider = PostgresOAuthProvider()
    info = OAuthClientInformationFull(
        client_id=client_id, redirect_uris=[REDIRECT], client_name="Claude",
        token_endpoint_auth_method="none",
    )
    await provider.register_client(info)
    url = await provider.authorize(info, AuthorizationParams(
        state="st4te", scopes=[], code_challenge="c" * 43, redirect_uri=REDIRECT,
        redirect_uri_provided_explicitly=True,
    ))
    return query(url)["req"]


async def connected_user(db, username: str = "alice"):
    """A user with mcp.access holding one live grant for client-1."""
    user = await make_user(db, username=username, permissions=["mcp.access"])
    provider = PostgresOAuthProvider()
    req = await pending_request()
    code = query(await create_authorization_code(db, user, load_request(req)))["code"]
    await db.commit()
    client = await provider.get_client("client-1")
    token = await provider.exchange_authorization_code(
        client, await provider.load_authorization_code(client, code)
    )
    return user, token


async def test_consent_requires_login(db) -> None:
    req = await pending_request()
    async with await http_client() as client:
        response = await client.get("/api/oauth/consent", params={"req": req})
    assert response.status_code == 401


async def test_consent_info(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    req = await pending_request()
    async with await http_client(db, user) as client:
        response = await client.get("/api/oauth/consent", params={"req": req})
    assert response.status_code == 200
    assert response.json() == {
        "client_name": "Claude", "redirect_host": "claude.ai",
        "user": {"username": "alice", "display_name": "Alice"}, "has_permission": True,
    }


async def test_consent_info_rejects_tampered_request(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with await http_client(db, user) as client:
        response = await client.get("/api/oauth/consent", params={"req": "garbage"})
    assert response.status_code == 400


async def test_approve_returns_code_redirect_and_audits(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    req = await pending_request()
    async with await http_client(db, user) as client:
        response = await client.post("/api/oauth/consent", json={"req": req, "approve": True})
    assert response.status_code == 200, response.text
    url = response.json()["redirect_url"]
    assert url.startswith(REDIRECT)
    assert query(url)["state"] == "st4te" and query(url)["code"]
    actions = (await db.scalars(sa.select(AuditEvent.action))).all()
    assert "mcp.connect" in actions


async def test_deny_returns_access_denied(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    req = await pending_request()
    async with await http_client(db, user) as client:
        response = await client.post("/api/oauth/consent", json={"req": req, "approve": False})
    assert query(response.json()["redirect_url"])["error"] == "access_denied"


async def test_approve_without_permission_is_forbidden(db) -> None:
    user = await make_user(db, permissions=[])
    req = await pending_request()
    async with await http_client(db, user) as client:
        response = await client.post("/api/oauth/consent", json={"req": req, "approve": True})
    assert response.status_code == 403
    assert response.json()["detail"] == "mcp_access_missing"


async def test_approve_requires_csrf_header(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    req = await pending_request()
    async with await http_client(db, user, csrf=False) as client:
        response = await client.post("/api/oauth/consent", json={"req": req, "approve": True})
    assert response.status_code == 403
    assert response.json()["detail"] == "csrf"


async def test_list_and_revoke_own_connection(db) -> None:
    user, _ = await connected_user(db)
    async with await http_client(db, user) as client:
        listed = await client.get("/api/oauth/connections")
        assert [c["client_name"] for c in listed.json()] == ["Claude"]
        assert (await client.delete("/api/oauth/connections/client-1")).status_code == 204
        assert (await client.get("/api/oauth/connections")).json() == []
        assert (await client.delete("/api/oauth/connections/unknown")).status_code == 404


async def test_admin_lists_and_revokes_user_connections(db) -> None:
    user, _ = await connected_user(db)
    admin = await make_user(db, username="root", role=Role.admin)
    async with await http_client(db, admin) as client:
        listed = await client.get(f"/api/admin/users/{user.id}/mcp-connections")
        assert [c["client_id"] for c in listed.json()] == ["client-1"]
        response = await client.delete(f"/api/admin/users/{user.id}/mcp-connections")
    assert response.status_code == 204
    assert await list_connections(db, user.id) == []


@pytest.mark.parametrize("how", ["admin_sessions", "deactivate", "password"])
async def test_account_actions_revoke_oauth_tokens(db, how) -> None:
    user, _ = await connected_user(db)
    admin = await make_user(db, username="root", role=Role.admin)
    if how == "password":
        async with await http_client(db, user) as client:
            response = await client.post("/api/auth/password", json={
                "current_password": PASSWORD, "new_password": "another long passphrase 42",
            })
    else:
        async with await http_client(db, admin) as client:
            if how == "admin_sessions":
                response = await client.delete(f"/api/admin/users/{user.id}/sessions")
            else:
                response = await client.patch(
                    f"/api/admin/users/{user.id}", json={"is_active": False}
                )
    assert response.status_code in (200, 204), response.text
    live = await db.scalar(
        sa.select(sa.func.count())
        .select_from(OAuthTokenPair)
        .where(OAuthTokenPair.revoked_at.is_(None))
    )
    assert live == 0


async def test_me_exposes_mcp_url(db) -> None:
    user = await make_user(db)
    async with await http_client(db, user) as client:
        response = await client.get("/api/auth/me")
    assert response.json()["mcp_url"] == "http://localhost:6500/mcp"
```

Nota: `DELETE /api/oauth/connections/unknown` → 404 perché nessuna riga viene revocata. Dopo la revoca di `client-1`, anche un secondo `DELETE /client-1` darebbe 404 (le righe hanno già `revoked_at`).

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `.venv\Scripts\python -m pytest tests/test_oauth_router.py -v`
Expected: FAIL (404 sulle route `/api/oauth/*`, `mcp_url` mancante).

- [ ] **Step 3: Crea schema e router**

`api/app/schemas/oauth.py`:

```python
"""Request/response shapes for the SPA's OAuth consent and connection views."""

from datetime import datetime

from pydantic import BaseModel


class ConsentDecision(BaseModel):
    req: str
    approve: bool


class McpConnectionOut(BaseModel):
    client_id: str
    client_name: str
    connected_at: datetime
    last_used_at: datetime | None
```

`api/app/routers/oauth.py`:

```python
"""Endpoints the SPA uses to finish an MCP OAuth authorization and to
manage the user's AI connections.

The OAuth protocol endpoints themselves (/authorize, /token, ...) are
served by the MCP SDK; `/authorize` redirects the browser to the SPA's
`/connect` page, which calls these endpoints with the normal session
cookie (and the CSRF header, enforced by `app.main`).
"""

from typing import Annotated
from urllib.parse import urlsplit

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.rate_limit import client_ip, consume
from app.db import get_session
from app.mcp.consent import load_request
from app.mcp.oauth import (
    create_authorization_code,
    denied_redirect,
    list_connections,
    revoke_user_tokens,
    user_may_connect,
)
from app.models.oauth import OAuthClient
from app.models.user import User
from app.schemas.oauth import ConsentDecision, McpConnectionOut
from app.services.audit import record

router = APIRouter(prefix="/api/oauth", tags=["oauth"])
Db = Annotated[AsyncSession, Depends(get_session)]
Current = Annotated[User, Depends(get_current_user)]


async def _pending(db: AsyncSession, req: str) -> tuple[dict, OAuthClient]:
    data = load_request(req)
    client = None
    if data is not None:
        client = await db.scalar(
            sa.select(OAuthClient).where(OAuthClient.client_id == data["client_id"])
        )
    if data is None or client is None:
        raise HTTPException(400, "richiesta scaduta")
    return data, client


@router.get("/consent")
async def consent_info(req: str, db: Db, user: Current):
    data, client = await _pending(db, req)
    return {
        "client_name": client.client_name or "Client MCP",
        "redirect_host": urlsplit(data["redirect_uri"]).hostname,
        "user": {"username": user.username, "display_name": user.display_name},
        "has_permission": user_may_connect(user),
    }


@router.post("/consent")
async def consent(payload: ConsentDecision, request: Request, db: Db, user: Current):
    if consume("oauth-consent", client_ip(request), limit=20):
        raise HTTPException(429, "too many attempts")
    data, client = await _pending(db, payload.req)
    if not payload.approve:
        return {"redirect_url": denied_redirect(data)}
    if not user_may_connect(user):
        raise HTTPException(403, "mcp_access_missing")
    redirect_url = await create_authorization_code(db, user, data)
    await record(
        db, user, "mcp.connect", user.id, {"client": client.client_name or client.client_id}, request
    )
    await db.commit()
    return {"redirect_url": redirect_url}


@router.get("/connections", response_model=list[McpConnectionOut])
async def connections(db: Db, user: Current):
    return await list_connections(db, user.id)


@router.delete("/connections/{client_id}", status_code=204)
async def revoke_connection(client_id: str, request: Request, db: Db, user: Current):
    if not await revoke_user_tokens(db, user.id, client_id):
        raise HTTPException(404, "connection not found")
    await record(db, user, "mcp.revoke", user.id, {"client_id": client_id}, request)
    await db.commit()
```

In `api/app/main.py`: import `from app.routers import admin, auth, diary, foods, oauth` e, subito dopo `app.include_router(auth.router)`, aggiungi `app.include_router(oauth.router)`. L'autenticazione è per-route tramite `Current`.

- [ ] **Step 4: Revoche collegate ed endpoint admin**

In `api/app/routers/admin.py`:
- import: `from app.mcp.oauth import list_connections, revoke_user_tokens` e `from app.schemas.oauth import McpConnectionOut`.
- in `patch_user`, dentro `if payload.is_active is False:`, dopo `await revoke_all(db, target.id)` aggiungi `await revoke_user_tokens(db, target.id)`.
- in `revoke_sessions`, dopo `await revoke_all(db, target.id)` aggiungi `await revoke_user_tokens(db, target.id)`.
- aggiungi, subito dopo `revoke_sessions`:

```python
@router.get("/users/{user_id}/mcp-connections", response_model=list[McpConnectionOut])
async def user_mcp_connections(user_id: int, db: AsyncSession = Depends(get_session), actor: User = Depends(require_admin)):
    target = await _target(db, user_id)
    return await list_connections(db, target.id)


@router.delete("/users/{user_id}/mcp-connections", status_code=204)
async def revoke_user_mcp_connections(user_id: int, request: Request, db: AsyncSession = Depends(get_session), actor: User = Depends(require_admin)):
    target = await _target(db, user_id)
    await revoke_user_tokens(db, target.id)
    await record(db, actor, "mcp.revoke", target.id, {"source": "admin"}, request)
    await db.commit()
```

`revoke_all` (in `app/auth/sessions.py`) fa già `commit`; `revoke_user_tokens` no. In `patch_user` e `revoke_sessions` segue sempre un `await db.commit()` finale (dopo `record`), quindi la revoca viene salvata. Controllalo leggendo il corpo attuale delle due funzioni.

In `api/app/routers/auth.py`:
- import: `from app.config import settings` e `from app.mcp.oauth import revoke_user_tokens`.
- `me` diventa:

```python
@router.get("/me")
async def me(user: Current):
    return {"id": user.id, "username": user.username, "display_name": user.display_name, "role": user.role, "permissions": sorted(p.value for p in effective_permissions(user)), "mcp_url": settings.mcp_resource_url}
```

- in `password`, dopo `await revoke_all(db, user.id, request.state.user_session.id)` aggiungi `await revoke_user_tokens(db, user.id)`. Il `commit` finale esistente lo salva. (Il cambio password dell'utente oggi non incrementa `auth_version`, quindi senza questa riga i token MCP sopravviverebbero.)

- [ ] **Step 5: Esegui i test**

Run: `.venv\Scripts\python -m pytest tests/test_oauth_router.py -v` → PASS.
Run: `.venv\Scripts\python -m pytest -q` e `.venv\Scripts\python -m ruff check app tests` → verdi.

- [ ] **Step 6: Commit**

```bash
git add api/app/schemas/oauth.py api/app/routers/oauth.py api/app/main.py api/app/routers/admin.py api/app/routers/auth.py api/tests/test_oauth_router.py
git commit -m "feat(api): consent and AI-connection endpoints; account actions revoke MCP tokens"
```

---

### Task 8: Server MCP montato nell'app, rate limit OAuth e nginx

**Files:**
- Create: `api/app/mcp/server.py`
- Modify: `api/app/main.py`
- Modify: `web/nginx.conf`
- Test: `api/tests/test_mcp_http.py`

**Interfaces:**
- Consumes: `PostgresOAuthProvider` (Task 6), `consume`, `client_ip` (Task 4).
- Produces: `app.mcp.server.INSTRUCTIONS: str`, `build_server() -> MCPServer`, `mcp_server: MCPServer`, `mcp_http_app` (Starlette). Nei task 9–10 `build_server()` chiamerà anche `register_food_tools(server)`, `register_diary_tools(server)`, `register_goal_tools(server)`, `register_prompts(server)`.
- HTTP: `/mcp`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`, `/register`, `/authorize`, `/token`, `/revoke`. Rate limit per IP al minuto: `/register` 10, `/token` 30, `/authorize` 30 → 429 `{"error": "slow_down"}`.

- [ ] **Step 1: Scrivi i test che falliscono**

`api/tests/test_mcp_http.py`:

```python
"""The MCP/OAuth HTTP surface mounted into the FastAPI app (needs Postgres).

`/mcp` itself needs the SDK session manager running (started by the app
lifespan, which ASGITransport does not run), so these tests stop at the
bearer check; tool behaviour is covered in-process by test_mcp_tools_*.
"""

import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlsplit

from app.mcp.oauth import PostgresOAuthProvider
from tests.factories import http_client, make_user

REDIRECT = "https://claude.ai/api/mcp/auth_callback"


def query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


def pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


async def register(client, redirect: str = REDIRECT):
    return await client.post("/register", json={
        "redirect_uris": [redirect], "token_endpoint_auth_method": "none", "client_name": "Claude",
        "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
    })


async def test_metadata_documents(db) -> None:
    async with await http_client() as client:
        server = await client.get("/.well-known/oauth-authorization-server")
        resource = await client.get("/.well-known/oauth-protected-resource/mcp")
    assert server.status_code == 200
    assert server.json()["issuer"] == "http://localhost:6500"
    assert server.json()["registration_endpoint"] == "http://localhost:6500/register"
    assert resource.json()["resource"] == "http://localhost:6500/mcp"


async def test_mcp_without_token_is_401_with_resource_metadata(db) -> None:
    async with await http_client() as client:
        response = await client.post("/mcp", json={})
    assert response.status_code == 401
    assert "oauth-protected-resource/mcp" in response.headers["www-authenticate"]


async def test_api_routes_still_win_over_the_mount(db) -> None:
    async with await http_client() as client:
        assert (await client.get("/api/health")).json() == {"status": "ok"}


async def test_register_rejects_non_https_redirect(db) -> None:
    async with await http_client() as client:
        response = await register(client, "http://evil.example/cb")
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_redirect_uri"


async def test_register_is_rate_limited(db) -> None:
    async with await http_client() as client:
        statuses = [(await register(client)).status_code for _ in range(11)]
    assert statuses[:10] == [201] * 10
    assert statuses[10] == 429


async def test_full_http_flow_with_refresh(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    verifier, challenge = pkce()
    async with await http_client(db, user) as client:
        client_id = (await register(client)).json()["client_id"]
        authorize = await client.get("/authorize", params={
            "response_type": "code", "client_id": client_id, "redirect_uri": REDIRECT,
            "code_challenge": challenge, "code_challenge_method": "S256", "state": "abc",
        })
        assert authorize.status_code == 302
        req = query(authorize.headers["location"])["req"]

        consent = await client.post("/api/oauth/consent", json={"req": req, "approve": True})
        code = query(consent.json()["redirect_url"])["code"]

        bad = await client.post("/token", data={
            "grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
            "client_id": client_id, "code_verifier": "x" * 50,
        })
        assert bad.status_code == 400

        token = await client.post("/token", data={
            "grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
            "client_id": client_id, "code_verifier": verifier,
        })
        assert token.status_code == 200, token.text
        body = token.json()
        assert body["token_type"] == "Bearer" and body["expires_in"] == 3600

        refreshed = await client.post("/token", data={
            "grant_type": "refresh_token", "refresh_token": body["refresh_token"],
            "client_id": client_id,
        })
        assert refreshed.status_code == 200, refreshed.text

    provider = PostgresOAuthProvider()
    assert await provider.load_access_token(body["access_token"]) is None
    assert await provider.load_access_token(refreshed.json()["access_token"]) is not None
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `.venv\Scripts\python -m pytest tests/test_mcp_http.py -v`
Expected: FAIL (404 su `/.well-known/...`, `/register`, `/mcp`).

- [ ] **Step 3: Crea il server**

`api/app/mcp/server.py`:

```python
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
    return MCPServer(
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


mcp_server = build_server()
mcp_http_app = mcp_server.streamable_http_app(
    streamable_http_path="/mcp",
    stateless_http=True,
    json_response=True,
    transport_security=_transport_security(),
    host="0.0.0.0",
)
```

- [ ] **Step 4: Monta il server in `app/main.py`**

1. Import:

```python
from app.auth.rate_limit import client_ip, consume
from app.mcp.server import mcp_http_app, mcp_server
```

2. Il `lifespan` diventa:

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # A single OffClient lives for the whole process so its rate limiters
    # (15/min product, 10/min search) and httpx connection pool are shared
    # across every request -- see CRITICAL 1 of the final-review fixes.
    # Constructing a fresh OffClient per-request made the rate limiting
    # inert in production.
    app.state.off_client = OffClient()
    try:
        # The MCP SDK's session manager owns the task group /mcp runs in.
        async with mcp_server.session_manager.run():
            yield
    finally:
        await app.state.off_client.aclose()
```

3. Dopo il middleware `csrf_protection` aggiungi:

```python
# Per-IP limits (requests/minute) on the unauthenticated OAuth endpoints the
# MCP SDK serves at the root.
OAUTH_RATE_LIMITS = {"/register": 10, "/token": 30, "/authorize": 30}


@app.middleware("http")
async def oauth_rate_limit(request: Request, call_next):
    limit = OAUTH_RATE_LIMITS.get(request.url.path)
    if limit is not None and consume(f"oauth:{request.url.path}", client_ip(request), limit=limit):
        return JSONResponse(status_code=429, content={"error": "slow_down"})
    return await call_next(request)
```

4. In **fondo al file**, dopo tutte le route (incluse `/api/openapi.json` e `/api/docs`):

```python
# Must stay last: a mount at "/" catches every path no route above matched.
app.mount("/", mcp_http_app)
```

- [ ] **Step 5: Esponi le route in nginx**

In `web/nginx.conf`, subito dopo il blocco `location /api/ { ... }`:

```nginx
    # MCP endpoint (streamable HTTP) and the OAuth 2.1 endpoints the MCP SDK
    # serves at the root. RFC 8414 / RFC 9728 fix these paths, so they
    # cannot live under /api/.
    location = /mcp {
        proxy_pass http://api:8000/mcp;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    location ^~ /.well-known/oauth- {
        proxy_pass http://api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~ ^/(register|authorize|token|revoke)$ {
        proxy_pass http://api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

`Host $host` è necessario: la protezione DNS-rebinding dell'SDK accetta solo l'host di `PUBLIC_BASE_URL`.

- [ ] **Step 6: Esegui i test**

Run: `.venv\Scripts\python -m pytest tests/test_mcp_http.py -v` → PASS.
Run: `.venv\Scripts\python -m pytest -q` e `.venv\Scripts\python -m ruff check app tests` → verdi.
Smoke manuale (facoltativo, con Postgres): `.venv\Scripts\python -m uvicorn app.main:app --port 8000`; `curl -i http://localhost:8000/.well-known/oauth-authorization-server` → 200; `curl -i -X POST http://localhost:8000/mcp` → 401. Poi ferma uvicorn.

- [ ] **Step 7: Commit**

```bash
git add api/app/mcp/server.py api/app/main.py web/nginx.conf api/tests/test_mcp_http.py
git commit -m "feat(api): mount MCP server with OAuth endpoints, rate limits and nginx routes"
```

---

### Task 9: Contesto dei tool e tool alimenti

**Files:**
- Create: `api/app/mcp/context.py`
- Create: `api/app/mcp/format.py`
- Create: `api/app/mcp/tools/__init__.py`
- Create: `api/app/mcp/tools/foods.py`
- Modify: `api/app/mcp/server.py` (registra i tool)
- Modify: `api/app/main.py` (passa l'`OffClient` ai tool)
- Create: `api/tests/mcp_helpers.py`
- Test: `api/tests/test_mcp_tools_foods.py`

**Interfaces:**
- Consumes: `session_scope` (Task 1); `ServiceError` (Task 2); `app.services.foods` (Task 3); `user_may_connect` (Task 6); `mcp_server`, `build_server` (Task 8); `record` (`app/services/audit.py`).
- Produces (`app.mcp.context`): `set_off_client(client) -> None`, `off_client() -> OffClient`, `today() -> date` (in `settings.app_timezone`), dataclass `ToolScope(db, user, client_name)` con `async audit(action: str, details: dict | None = None) -> None` (registra `mcp.<action>` e fa commit), async context manager `tool_scope() -> ToolScope` (converte `ServiceError` in `ToolError`).
- Produces (`app.mcp.format`): `MACROS`, `macros(values) -> dict[str, float]`, `food_payload(food) -> dict`, `entry_payload(entry: DiaryEntryOut) -> dict`, `goal_payload(goal) -> dict | None`, `day_payload(day: DayResponse) -> dict`, `week_payload(week: WeekResponse) -> dict`.
- Produces (tool): `search_foods(query, limit=10)`, `get_food_by_barcode(barcode)`, `get_recent_foods(limit=10)`, `create_custom_food(name, kcal, protein_g, carbs_g, fat_g, brand=None, sugars_g=0, sat_fat_g=0, fiber_g=0, salt_g=0)`.
- Produces (test): in `tests/mcp_helpers.py`: `mcp_client(user, client_id="test-client")` (async context manager → `mcp.Client`), `async call(client, name, **args) -> dict`, `async call_error(client, name, **args) -> str`, classi `FakeOff` / `ExplodingOff`.

- [ ] **Step 1: Crea gli helper di test**

`api/tests/mcp_helpers.py`:

```python
"""In-process MCP client wired to the real server, acting as a given user.

The bearer middleware is bypassed (in-memory transport), so we set the
SDK's auth context variable directly; the server task inherits it when
`Client` starts, which is exactly what `get_access_token()` reads.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from mcp import Client
from mcp.server.auth.middleware.auth_context import auth_context_var
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
from mcp.server.auth.provider import AccessToken

from app.mcp.server import mcp_server
from app.models.user import User


@asynccontextmanager
async def mcp_client(user: User, client_id: str = "test-client") -> AsyncIterator[Client]:
    token = AccessToken(token="test", client_id=client_id, scopes=[], subject=str(user.id))
    reset = auth_context_var.set(AuthenticatedUser(token))
    try:
        async with Client(mcp_server) as client:
            yield client
    finally:
        auth_context_var.reset(reset)


async def call(client: Client, name: str, **args: Any) -> dict:
    result = await client.call_tool(name, args)
    assert not result.is_error, result.content
    return result.structured_content


async def call_error(client: Client, name: str, **args: Any) -> str:
    result = await client.call_tool(name, args)
    assert result.is_error, result.structured_content
    return result.content[0].text


class FakeOff:
    """OffClient stand-in: OFF answers nothing, product lookups miss."""

    async def search(self, q: str, limit: int):
        return []

    async def get_product(self, barcode: str):
        return None


class ExplodingOff:
    async def search(self, q: str, limit: int):
        raise AssertionError("OFF must not be called")

    async def get_product(self, barcode: str):
        raise AssertionError("OFF must not be called")
```

Prima di proseguire, verifica che `food_cache.get_or_fetch_by_barcode` usi solo `client.get_product(...)` (`grep -n "client\." api/app/services/food_cache.py`); se chiama altri metodi, aggiungili a `FakeOff`/`ExplodingOff` con lo stesso stile.

- [ ] **Step 2: Scrivi i test che falliscono**

`api/tests/test_mcp_tools_foods.py`:

```python
"""Food tools over the in-memory MCP transport (needs Postgres)."""

import pytest

from app.mcp.context import set_off_client
from tests.factories import make_food, make_user
from tests.mcp_helpers import ExplodingOff, FakeOff, call, call_error, mcp_client


@pytest.fixture(autouse=True)
def _off():
    set_off_client(FakeOff())
    yield
    set_off_client(None)


async def test_tools_are_listed(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        names = {tool.name for tool in (await client.list_tools()).tools}
    assert {"search_foods", "get_food_by_barcode", "get_recent_foods", "create_custom_food"} <= names


async def test_search_returns_compact_foods(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db, name="Pasta di semola", brand="Barilla")
    set_off_client(ExplodingOff())  # no OFF permission -> never contacted
    async with mcp_client(user) as client:
        data = await call(client, "search_foods", query="semola")
    assert data["openfoodfacts_disabled"] is True
    assert data["results"] == [{
        "food_id": food.id, "name": "Pasta di semola", "brand": "Barilla",
        "serving_size_g": None,
        "per_100g": {"kcal": 200.0, "protein_g": 20.0, "carbs_g": 10.0, "fat_g": 8.0},
    }]


async def test_barcode_miss_is_a_tool_error(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        message = await call_error(client, "get_food_by_barcode", barcode="8001234567890")
    assert "food not found" in message


async def test_create_custom_food_requires_permission(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        message = await call_error(
            client, "create_custom_food", name="Torta", kcal=350, protein_g=6, carbs_g=50, fat_g=14
        )
    assert "foods.custom_create" in message


async def test_create_custom_food(db) -> None:
    user = await make_user(db, permissions=["mcp.access", "foods.custom_create"])
    async with mcp_client(user) as client:
        food = await call(
            client, "create_custom_food", name="Torta", kcal=350, protein_g=6, carbs_g=50, fat_g=14
        )
        found = await call(client, "search_foods", query="Torta")
    assert food["per_100g"] == {"kcal": 350.0, "protein_g": 6.0, "carbs_g": 50.0, "fat_g": 14.0}
    assert [f["food_id"] for f in found["results"]] == [food["food_id"]]


async def test_revoked_permission_blocks_tools(db) -> None:
    user = await make_user(db, permissions=[])
    async with mcp_client(user) as client:
        message = await call_error(client, "get_recent_foods")
    assert "revoked" in message
```

- [ ] **Step 3: Esegui e verifica che fallisca**

Run: `.venv\Scripts\python -m pytest tests/test_mcp_tools_foods.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'app.mcp.context'`.

- [ ] **Step 4: Crea il contesto dei tool**

`api/app/mcp/context.py`:

```python
"""Per-call plumbing for MCP tools: the token's user, a DB session, audit
logging and error translation.

Every tool body runs inside `async with tool_scope() as scope:`. The bearer
token was already validated by the SDK (via `PostgresOAuthProvider.
load_access_token`); here we load the user it belongs to, re-check access,
and turn domain errors into MCP tool errors the assistant can read.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import session_scope
from app.mcp.oauth import user_may_connect
from app.models.oauth import OAuthClient
from app.models.user import User
from app.services.audit import record
from app.services.errors import ServiceError
from app.services.off_client import OffClient

_off_client: OffClient | None = None


def set_off_client(client: OffClient | None) -> None:
    """Share the app-wide OffClient (and its rate limiters) with the tools."""
    global _off_client
    _off_client = client


def off_client() -> OffClient:
    if _off_client is None:
        raise ToolError("OpenFoodFacts is not available right now")
    return _off_client


def today() -> date:
    return datetime.now(ZoneInfo(settings.app_timezone)).date()


@dataclass
class ToolScope:
    db: AsyncSession
    user: User
    client_name: str

    async def audit(self, action: str, details: dict | None = None) -> None:
        await record(
            self.db, self.user, f"mcp.{action}", self.user.id,
            {"client": self.client_name, **(details or {})},
        )
        await self.db.commit()


@asynccontextmanager
async def tool_scope() -> AsyncIterator[ToolScope]:
    token = get_access_token()
    if token is None or token.subject is None:
        raise ToolError("Not authenticated")
    async with session_scope() as db:
        user = await db.get(User, int(token.subject))
        if user is None or not user_may_connect(user):
            raise ToolError("Access to this account has been revoked")
        client_name = await db.scalar(
            sa.select(OAuthClient.client_name).where(OAuthClient.client_id == token.client_id)
        )
        try:
            yield ToolScope(db=db, user=user, client_name=client_name or token.client_id)
        except ServiceError as exc:
            raise ToolError(str(exc)) from exc
```

`api/app/mcp/format.py`:

```python
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
```

- [ ] **Step 5: Crea i tool alimenti**

`api/app/mcp/tools/__init__.py`:

```python
"""MCP tool groups; each module exposes a `register_*_tools(server)` function."""
```

`api/app/mcp/tools/foods.py`:

```python
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
            return food_payload(await foods.get_by_barcode(scope.db, off_client(), scope.user, barcode))

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
        payload = CustomFoodCreate(name=name, brand=brand, nutriments=Nutriments(
            kcal=kcal, protein_g=protein_g, carbs_g=carbs_g, sugars_g=sugars_g, fat_g=fat_g,
            sat_fat_g=sat_fat_g, fiber_g=fiber_g, salt_g=salt_g,
        ))
        async with tool_scope() as scope:
            food = await foods.create_custom_food(scope.db, scope.user, payload)
            await scope.audit("create_custom_food", {"food_id": food.id})
            return food_payload(food)
```

- [ ] **Step 6: Registra i tool e passa l'OFF client**

In `api/app/mcp/server.py`, import `from app.mcp.tools.foods import register_food_tools` e cambia `build_server`:

```python
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
```

In `api/app/main.py`: import `from app.mcp.context import set_off_client` e nel `lifespan`, subito dopo `app.state.off_client = OffClient()`, aggiungi `set_off_client(app.state.off_client)`; nel `finally`, prima di `aclose()`, aggiungi `set_off_client(None)`.

- [ ] **Step 7: Esegui i test**

Run: `.venv\Scripts\python -m pytest tests/test_mcp_tools_foods.py -v` → PASS.
Run: `.venv\Scripts\python -m pytest -q` e `.venv\Scripts\python -m ruff check app tests` → verdi.

- [ ] **Step 8: Commit**

```bash
git add api/app/mcp/context.py api/app/mcp/format.py api/app/mcp/tools/__init__.py api/app/mcp/tools/foods.py api/app/mcp/server.py api/app/main.py api/tests/mcp_helpers.py api/tests/test_mcp_tools_foods.py
git commit -m "feat(api): MCP food tools with per-call user scope and audit"
```

---

### Task 10: Tool diario, obiettivi e prompt

**Files:**
- Create: `api/app/mcp/tools/diary.py`
- Create: `api/app/mcp/tools/goals.py`
- Create: `api/app/mcp/prompts.py`
- Modify: `api/app/mcp/server.py`
- Test: `api/tests/test_mcp_tools_diary.py`

**Interfaces:**
- Consumes: `tool_scope`, `today` (Task 9); `format.*` (Task 9); `diary_ops`, `goals` (Task 2).
- Produces (tool): `get_day(date=None)`, `get_week(date=None)`, `add_diary_entry(meal, food_id, grams, date=None)`, `add_diary_entries(entries)` (1–30, tutto-o-niente), `update_diary_entry(entry_id, grams=None, meal=None)`, `delete_diary_entry(entry_id)`, `copy_days(source_dates, target_start, meals=None, mode="append")`, `get_goal(date=None)`, `set_goal(kcal, protein_g, carbs_g, fat_g)`; prompt `plan_my_day(date=None)`.
- `register_diary_tools(server)`, `register_goal_tools(server)`, `register_prompts(server)`.

- [ ] **Step 1: Scrivi i test che falliscono**

`api/tests/test_mcp_tools_diary.py`:

```python
"""Diary and goal tools over the in-memory MCP transport (needs Postgres)."""

from datetime import date, timedelta

import pytest
import sqlalchemy as sa

from app.mcp.context import set_off_client, today
from app.models.diary import DiaryEntry
from app.models.user import AuditEvent
from tests.factories import make_food, make_user
from tests.mcp_helpers import FakeOff, call, call_error, mcp_client

MON = "2026-03-02"


@pytest.fixture(autouse=True)
def _off():
    set_off_client(FakeOff())
    yield
    set_off_client(None)


async def test_add_entry_then_get_day(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db, name="Pasta", brand="Barilla")
    async with mcp_client(user, client_id="claude") as client:
        entry = await call(client, "add_diary_entry", date=MON, meal="lunch", food_id=food.id, grams=80)
        day = await call(client, "get_day", date=MON)
    assert entry["food"] == "Pasta (Barilla)"
    assert entry["kcal"] == 160.0  # 200 kcal/100 g * 80 g
    assert [e["entry_id"] for e in day["meals"]["lunch"]] == [entry["entry_id"]]
    assert day["total"] == {"kcal": 160.0, "protein_g": 16.0, "carbs_g": 8.0, "fat_g": 6.4}
    assert day["goal"] is None and day["remaining"] is None
    audit = (await db.scalars(sa.select(AuditEvent).where(AuditEvent.action == "mcp.add_diary_entry"))).all()
    assert len(audit) == 1


async def test_date_defaults_to_today(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        entry = await call(client, "add_diary_entry", meal="snack", food_id=food.id, grams=10)
    assert entry["date"] == today().isoformat()


async def test_add_entries_is_all_or_nothing(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        message = await call_error(client, "add_diary_entries", entries=[
            {"date": MON, "meal": "dinner", "food_id": food.id, "grams": 100},
            {"date": MON, "meal": "dinner", "food_id": 999_999, "grams": 50},
        ])
        ok = await call(client, "add_diary_entries", entries=[
            {"date": MON, "meal": "dinner", "food_id": food.id, "grams": 100},
            {"date": MON, "meal": "dinner", "food_id": food.id, "grams": 50},
        ])
    assert "food not found" in message
    assert len(ok["entries"]) == 2
    count = await db.scalar(sa.select(sa.func.count()).select_from(DiaryEntry).where(DiaryEntry.user_id == user.id))
    assert count == 2


async def test_rejects_non_positive_grams(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        result = await client.call_tool("add_diary_entry", {"meal": "lunch", "food_id": food.id, "grams": 0})
    assert result.is_error


async def test_update_and_delete_entry(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        entry = await call(client, "add_diary_entry", date=MON, meal="lunch", food_id=food.id, grams=80)
        moved = await call(client, "update_diary_entry", entry_id=entry["entry_id"], meal="dinner", grams=50)
        assert (moved["meal"], moved["grams"]) == ("dinner", 50.0)
        assert "Nothing to update" in await call_error(client, "update_diary_entry", entry_id=entry["entry_id"])
        assert (await call(client, "delete_diary_entry", entry_id=entry["entry_id"])) == {"deleted": True}
        day = await call(client, "get_day", date=MON)
    assert all(day["meals"][meal] == [] for meal in day["meals"])


async def test_cannot_touch_another_users_entry(db) -> None:
    alice = await make_user(db, username="alice", permissions=["mcp.access"])
    bob = await make_user(db, username="bob", permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(bob) as client:
        entry = await call(client, "add_diary_entry", date=MON, meal="lunch", food_id=food.id, grams=80)
    async with mcp_client(alice) as client:
        assert "entry not found" in await call_error(client, "delete_diary_entry", entry_id=entry["entry_id"])
        day = await call(client, "get_day", date=MON)
    assert day["meals"]["lunch"] == []


async def test_get_week_starts_on_monday(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        await call(client, "add_diary_entry", date="2026-03-04", meal="lunch", food_id=food.id, grams=100)
        week = await call(client, "get_week", date="2026-03-05")
    assert (week["start"], week["end"]) == ("2026-03-02", "2026-03-08")
    assert [d["kcal"] for d in week["days"]] == [0.0, 0.0, 200.0, 0.0, 0.0, 0.0, 0.0]


async def test_copy_days_requires_permission_then_works(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        await call(client, "add_diary_entry", date=MON, meal="lunch", food_id=food.id, grams=80)
        denied = await call_error(client, "copy_days", source_dates=[MON], target_start="2026-03-09")
    assert "diary.copy" in denied
    user.permissions = ["mcp.access", "diary.copy"]
    await db.flush()
    async with mcp_client(user) as client:
        copied = await call(client, "copy_days", source_dates=[MON], target_start="2026-03-09")
        day = await call(client, "get_day", date="2026-03-09")
    assert copied["entries_created"] == 1
    assert len(day["meals"]["lunch"]) == 1


async def test_goals(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        assert (await call(client, "get_goal")) == {"goal": None}
        denied = await call_error(client, "set_goal", kcal=2000, protein_g=150, carbs_g=200, fat_g=70)
    assert "goals.edit" in denied
    user.permissions = ["mcp.access", "goals.edit"]
    await db.flush()
    async with mcp_client(user) as client:
        goal = await call(client, "set_goal", kcal=2000, protein_g=150, carbs_g=200, fat_g=70)
        again = await call(client, "get_goal")
    assert goal["goal"]["kcal"] == 2000.0
    assert goal["goal"]["valid_from"] == today().isoformat()
    assert again == goal


async def test_plan_my_day_prompt(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        prompt = await client.get_prompt("plan_my_day", {"date": MON})
    text = prompt.messages[0].content.text
    assert MON in text and "get_goal" in text and "add_diary_entries" in text
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `.venv\Scripts\python -m pytest tests/test_mcp_tools_diary.py -v`
Expected: FAIL (tool sconosciuti: `is_error` con "Unknown tool" o simile).

- [ ] **Step 3: Crea i tool diario**

`api/app/mcp/tools/diary.py`:

```python
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
        "Copy the entries of one or more days onto consecutive days starting at "
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
```

Prima di scrivere `copy_days`, verifica la semantica esatta leggendo il docstring di `plan_copy` in `api/app/services/diary.py` (mappa source→target e comportamento di `replace`) e correggi la `description` del tool se differisce.

- [ ] **Step 4: Crea i tool obiettivi e il prompt**

`api/app/mcp/tools/goals.py`:

```python
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
```

`api/app/mcp/prompts.py`:

```python
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
```

In `api/app/mcp/server.py` aggiungi gli import:

```python
from app.mcp.prompts import register_prompts
from app.mcp.tools.diary import register_diary_tools
from app.mcp.tools.goals import register_goal_tools
```

e in `build_server()`, dopo `register_food_tools(server)`:

```python
    register_diary_tools(server)
    register_goal_tools(server)
    register_prompts(server)
```

- [ ] **Step 5: Esegui i test**

Run: `.venv\Scripts\python -m pytest tests/test_mcp_tools_diary.py -v` → PASS.
Run: `.venv\Scripts\python -m pytest -q` e `.venv\Scripts\python -m ruff check app tests` → verdi.

- [ ] **Step 6: Commit**

```bash
git add api/app/mcp/tools/diary.py api/app/mcp/tools/goals.py api/app/mcp/prompts.py api/app/mcp/server.py api/tests/test_mcp_tools_diary.py
git commit -m "feat(api): MCP diary, goal tools and plan_my_day prompt"
```

---

### Task 11: Comando `purge-oauth`

**Files:**
- Modify: `api/app/cli.py`
- Test: `api/tests/test_purge_oauth.py`

**Interfaces:**
- Consumes: `purge_expired(db, now=None) -> tuple[int, int]` (Task 6).
- Produces: `python -m app.cli purge-oauth` che stampa `Rimossi <n> codici e <m> token OAuth scaduti`.

- [ ] **Step 1: Scrivi il test che fallisce**

`api/tests/test_purge_oauth.py`:

```python
"""Cleanup of dead OAuth codes and tokens (needs Postgres)."""

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.mcp.oauth import purge_expired
from app.models.oauth import OAuthAuthCode, OAuthClient, OAuthTokenPair
from tests.factories import make_user


def _pair(user, suffix: str, **times) -> OAuthTokenPair:
    now = datetime.now(UTC)
    values = {
        "access_expires_at": now + timedelta(hours=1),
        "refresh_expires_at": now + timedelta(days=30),
        **times,
    }
    return OAuthTokenPair(
        user_id=user.id, client_id="client-1", family_id=suffix,
        access_token_hash=f"a{suffix}".ljust(64, "0"), refresh_token_hash=f"r{suffix}".ljust(64, "0"),
        scopes=[], auth_version=user.auth_version, **values,
    )


async def test_purge_removes_only_dead_rows(db) -> None:
    user = await make_user(db)
    now = datetime.now(UTC)
    db.add(OAuthClient(client_id="client-1", client_name="Claude", info={}))
    await db.flush()
    db.add_all([
        OAuthAuthCode(code_hash="1".ljust(64, "0"), client_id="client-1", user_id=user.id,
                      redirect_uri="https://claude.ai/cb", redirect_uri_provided_explicitly=True,
                      code_challenge="c" * 43, scopes=[], expires_at=now - timedelta(days=2)),
        OAuthAuthCode(code_hash="2".ljust(64, "0"), client_id="client-1", user_id=user.id,
                      redirect_uri="https://claude.ai/cb", redirect_uri_provided_explicitly=True,
                      code_challenge="c" * 43, scopes=[], expires_at=now + timedelta(minutes=5)),
        _pair(user, "live"),
        _pair(user, "expired", refresh_expires_at=now - timedelta(seconds=1)),
        _pair(user, "oldrev", revoked_at=now - timedelta(days=31)),
        _pair(user, "newrev", revoked_at=now - timedelta(days=1)),
    ])
    await db.flush()

    assert await purge_expired(db) == (1, 2)
    left = set((await db.scalars(sa.select(OAuthTokenPair.family_id))).all())
    assert left == {"live", "newrev"}
```

- [ ] **Step 2: Esegui e verifica che il test passi già o fallisca per il motivo giusto**

Run: `.venv\Scripts\python -m pytest tests/test_purge_oauth.py -v`
Expected: PASS (`purge_expired` esiste dal Task 6). Se fallisce, correggi `purge_expired` — non il test.

- [ ] **Step 3: Aggiungi il comando CLI**

In `api/app/cli.py`:
- import: `from app.mcp.oauth import purge_expired`.
- nuova funzione, dopo `list_users`:

```python
async def purge_oauth() -> tuple[int, int]:
    async with AsyncSessionLocal() as session:
        return await purge_expired(session)
```

- in `main()`, dopo `sub.add_parser("list-users")`: `sub.add_parser("purge-oauth")`.
- nella catena `if/elif`, prima dell'`else` finale:

```python
    elif args.command == "purge-oauth":
        codes, tokens = asyncio.run(purge_oauth())
        print(f"Rimossi {codes} codici e {tokens} token OAuth scaduti")
```

- [ ] **Step 4: Verifica**

Run: `.venv\Scripts\python -m app.cli purge-oauth` (con `DATABASE_URL` del DB di test) → stampa `Rimossi 0 codici e 0 token OAuth scaduti` (o numeri ≥ 0).
Run: `.venv\Scripts\python -m pytest -q` e `.venv\Scripts\python -m ruff check app tests` → verdi.

- [ ] **Step 5: Commit**

```bash
git add api/app/cli.py api/tests/test_purge_oauth.py
git commit -m "feat(api): purge-oauth CLI command for expired MCP codes and tokens"
```

---

### Task 12: Web — pagina di consenso `/connect` e ritorno dopo il login

**Files:**
- Create: `web/src/api/oauth.ts`
- Create: `web/src/lib/safeNext.ts`, `web/src/lib/safeNext.test.ts`
- Create: `web/src/lib/redirect.ts`
- Create: `web/src/pages/ConnectPage.tsx`, `web/src/pages/ConnectPage.test.tsx`
- Modify: `web/src/pages/LoginPage.tsx`, `web/src/pages/LoginPage.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api/auth.ts` (`Me.mcp_url`)
- Modify: `web/vite.config.ts` (denylist del service worker)

**Interfaces:**
- Consumes: `GET/POST /api/oauth/consent`, `GET/DELETE /api/oauth/connections` (Task 7); `useMe` (`web/src/auth/AuthContext.tsx`).
- Produces (`web/src/api/oauth.ts`): tipi `ConsentInfo`, `McpConnection`; funzioni `getConsent(req)`, `decideConsent(req, approve)`, `listConnections()`, `revokeConnection(clientId)`.
- Produces: `safeNext(value: string | null): string | null`; `redirectTo(url: string): void`; route `/connect` fuori da `AuthGuard`.

- [ ] **Step 1: Scrivi i test che falliscono**

`web/src/lib/safeNext.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { safeNext } from "./safeNext";

describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/connect?req=abc")).toBe("/connect?req=abc");
  });

  it.each([null, "", "https://evil.example", "//evil.example", "/\\evil.example", "connect"])(
    "rejects %s",
    (value) => {
      expect(safeNext(value)).toBeNull();
    },
  );
});
```

`web/src/pages/ConnectPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMe } from "../api/auth";
import { ApiError } from "../api/client";
import { decideConsent, getConsent } from "../api/oauth";
import { redirectTo } from "../lib/redirect";
import ConnectPage from "./ConnectPage";

vi.mock("../api/auth", async () => {
  const actual = await vi.importActual<typeof import("../api/auth")>("../api/auth");
  return { ...actual, getMe: vi.fn() };
});
vi.mock("../api/oauth", () => ({ getConsent: vi.fn(), decideConsent: vi.fn() }));
vi.mock("../lib/redirect", () => ({ redirectTo: vi.fn() }));

const ME = {
  id: 1, username: "alice", display_name: "Alice", role: "user" as const,
  permissions: ["mcp.access" as const], mcp_url: "https://fit.example.com/mcp",
};
const CONSENT = {
  client_name: "Claude", redirect_host: "claude.ai",
  user: { username: "alice", display_name: "Alice" }, has_permission: true,
};

function LoginProbe() {
  const location = useLocation();
  return <div>Login {location.search}</div>;
}

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/connect" element={<ConnectPage />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ConnectPage", () => {
  beforeEach(() => {
    vi.mocked(getMe).mockResolvedValue(ME);
    vi.mocked(getConsent).mockResolvedValue(CONSENT);
    vi.mocked(decideConsent).mockReset();
    vi.mocked(redirectTo).mockReset();
  });

  it("approves and sends the browser back to the client", async () => {
    vi.mocked(decideConsent).mockResolvedValue({ redirect_url: "https://claude.ai/cb?code=x" });
    const user = userEvent.setup();
    renderAt("/connect?req=abc");

    await user.click(await screen.findByRole("button", { name: /autorizza/i }));

    expect(decideConsent).toHaveBeenCalledWith("abc", true);
    await vi.waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://claude.ai/cb?code=x"));
  });

  it("denies", async () => {
    vi.mocked(decideConsent).mockResolvedValue({ redirect_url: "https://claude.ai/cb?error=access_denied" });
    const user = userEvent.setup();
    renderAt("/connect?req=abc");

    await user.click(await screen.findByRole("button", { name: /nega/i }));

    expect(decideConsent).toHaveBeenCalledWith("abc", false);
  });

  it("explains a missing permission and offers only cancel", async () => {
    vi.mocked(getConsent).mockResolvedValue({ ...CONSENT, has_permission: false });
    renderAt("/connect?req=abc");

    expect(await screen.findByText(/chiedi all.amministratore/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /autorizza/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /annulla/i })).toBeInTheDocument();
  });

  it("reports an expired request", async () => {
    vi.mocked(getConsent).mockRejectedValue(new ApiError(400, "richiesta scaduta", null));
    renderAt("/connect?req=abc");

    expect(await screen.findByText(/richiesta scaduta/i)).toBeInTheDocument();
  });

  it("sends anonymous users to login and back", async () => {
    vi.mocked(getMe).mockRejectedValue(new ApiError(401, "unauthorized", null));
    renderAt("/connect?req=abc");

    expect(await screen.findByText("Login ?next=%2Fconnect%3Freq%3Dabc")).toBeInTheDocument();
  });
});
```

In `web/src/pages/LoginPage.test.tsx`, rendi `renderLoginPage` parametrico e aggiungi due test. Sostituisci la funzione con:

```tsx
function renderLoginPage(url = "/login") {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Day Home</div>} />
          <Route path="/connect" element={<div>Connect Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
```

e in fondo al `describe`:

```tsx
  async function loginWithTotp(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/username/i), "alice");
    await user.type(screen.getByLabelText(/^password$/i), "correct-password");
    await user.click(screen.getByRole("button", { name: /accedi/i }));
    await user.type(await screen.findByLabelText(/codice autenticatore/i), "123456");
    await user.click(screen.getByRole("button", { name: /verifica/i }));
  }

  it("returns to an internal next path after login", async () => {
    vi.mocked(login).mockResolvedValue({ status: "totp_required" });
    vi.mocked(verifyTotp).mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    renderLoginPage("/login?next=%2Fconnect%3Freq%3Dabc");

    await loginWithTotp(user);

    expect(await screen.findByText("Connect Page")).toBeInTheDocument();
  });

  it("ignores an external next URL", async () => {
    vi.mocked(login).mockResolvedValue({ status: "totp_required" });
    vi.mocked(verifyTotp).mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    renderLoginPage("/login?next=https%3A%2F%2Fevil.example");

    await loginWithTotp(user);

    expect(await screen.findByText("Day Home")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Esegui e verifica che falliscano**

Run (da `web/`): `npm test`
Expected: FAIL (moduli `./safeNext`, `../api/oauth`, `../lib/redirect`, `./ConnectPage` mancanti; i nuovi test di LoginPage finiscono su "Day Home" invece di "Connect Page").

- [ ] **Step 3: Implementa helper e client API**

`web/src/lib/safeNext.ts`:

```ts
/** A post-login destination is accepted only as a same-origin path (no open redirect). */
export function safeNext(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
```

`web/src/lib/redirect.ts`:

```ts
/** Full-page navigation to another origin (the OAuth client's callback). Wrapped so tests can mock it. */
export function redirectTo(url: string) {
  window.location.assign(url);
}
```

`web/src/api/oauth.ts`:

```ts
import { client } from "./client";

export interface ConsentInfo {
  client_name: string;
  redirect_host: string | null;
  user: { username: string; display_name: string };
  has_permission: boolean;
}
export interface McpConnection { client_id: string; client_name: string; connected_at: string; last_used_at: string | null }

export const getConsent = (req: string) => client.get<ConsentInfo>(`/oauth/consent?req=${encodeURIComponent(req)}`);
export const decideConsent = (req: string, approve: boolean) => client.post<{ redirect_url: string }>("/oauth/consent", { req, approve });
export const listConnections = () => client.get<McpConnection[]>("/oauth/connections");
export const revokeConnection = (clientId: string) => client.delete<void>(`/oauth/connections/${encodeURIComponent(clientId)}`);
```

In `web/src/api/auth.ts`, aggiungi `mcp_url: string;` all'interfaccia `Me`:

```ts
export interface Me { id: number; username: string; display_name: string; role: "admin" | "user"; permissions: Permission[]; mcp_url: string; }
```

Poi aggiorna i due test che costruiscono un `Me` finto (`web/src/auth/AuthGuard.test.tsx:48`, `web/src/pages/SettingsPage.test.tsx:57`) aggiungendo `mcp_url: "http://localhost:6500/mcp"` all'oggetto, se il type-check (`npm run build`) lo richiede.

- [ ] **Step 4: Implementa `ConnectPage`**

`web/src/pages/ConnectPage.tsx`:

```tsx
import type { ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { decideConsent, getConsent } from "../api/oauth";
import { useMe } from "../auth/AuthContext";
import { redirectTo } from "../lib/redirect";

function Shell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-app px-4"><main className="card w-full max-w-sm space-y-5 p-6">{children}</main></div>;
}

const alertClass = "rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";

export default function ConnectPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const req = params.get("req");
  const me = useMe();
  const consent = useQuery({
    queryKey: ["oauth", "consent", req],
    queryFn: () => getConsent(req ?? ""),
    enabled: Boolean(req && me.data),
    retry: false,
  });
  const decide = useMutation({
    mutationFn: (approve: boolean) => decideConsent(req ?? "", approve),
    onSuccess: (result) => redirectTo(result.redirect_url),
  });

  if (!req) return <Shell><p role="alert" className={alertClass}>Richiesta di collegamento non valida. Riprova dal tuo assistente AI.</p></Shell>;
  if (me.isLoading) return <Shell><p className="text-slate-500">Caricamento...</p></Shell>;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (consent.isLoading) return <Shell><p className="text-slate-500">Caricamento...</p></Shell>;
  if (consent.isError || !consent.data) {
    const expired = consent.error instanceof ApiError && consent.error.status === 400;
    return <Shell><p role="alert" className={alertClass}>{expired ? "Richiesta scaduta, riprova dal tuo assistente AI." : "Impossibile caricare la richiesta di collegamento."}</p></Shell>;
  }

  const info = consent.data;
  return <Shell>
    <header className="text-center">
      <h1 className="text-xl font-bold">Collega {info.client_name}</h1>
      <p className="text-sm text-slate-500">Accesso come {info.user.display_name} (@{info.user.username})</p>
    </header>
    {info.has_permission ? <>
      <p className="text-sm text-slate-700"><strong>{info.client_name}</strong> potrà leggere e modificare il tuo diario, i tuoi alimenti e i tuoi obiettivi.</p>
      {info.redirect_host && <p className="text-xs text-slate-500">Dopo la conferma tornerai su {info.redirect_host}.</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" disabled={decide.isPending} onClick={() => decide.mutate(false)}>Nega</button>
        <button type="button" className="btn-primary flex-1" disabled={decide.isPending} onClick={() => decide.mutate(true)}>Autorizza</button>
      </div>
    </> : <>
      <p role="alert" className={alertClass}>Chiedi all’amministratore di abilitare le connessioni AI per il tuo account.</p>
      <button type="button" className="btn-secondary w-full" disabled={decide.isPending} onClick={() => decide.mutate(false)}>Annulla</button>
    </>}
    {decide.isError && <p role="alert" className={alertClass}>{decide.error instanceof ApiError ? decide.error.message : "Impossibile completare l’operazione."}</p>}
  </Shell>;
}
```

- [ ] **Step 5: `next` nel login, route e service worker**

In `web/src/pages/LoginPage.tsx`:
- import: `import { useNavigate, useSearchParams } from "react-router-dom";` e `import { safeNext } from "../lib/safeNext";`
- dentro il componente, dopo `const navigate = useNavigate();`: `const [searchParams] = useSearchParams();`
- `finish` diventa:

```tsx
  const finish = async () => {
    await clearClientCaches(queryClient);
    navigate(safeNext(searchParams.get("next")) ?? "/", { replace: true });
  };
```

In `web/src/App.tsx`: `import ConnectPage from "./pages/ConnectPage";` e, subito dopo `<Route path="/login" element={<LoginPage />} />`, aggiungi `<Route path="/connect" element={<ConnectPage />} />`.

In `web/vite.config.ts`, dentro `workbox: { ... }` prima di `runtimeCaching`, aggiungi:

```ts
        // Top-level navigations to server routes must reach the network, not
        // the precached SPA shell -- /authorize in particular is where the AI
        // client sends the browser to start the OAuth flow.
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp/, /^\/authorize/, /^\/token/, /^\/register/, /^\/revoke/, /^\/\.well-known\//],
```

- [ ] **Step 6: Esegui i test**

Run (da `web/`): `npm test` → PASS; `npm run build` → OK; `npx eslint src` → nessun errore.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/oauth.ts web/src/api/auth.ts web/src/lib/safeNext.ts web/src/lib/safeNext.test.ts web/src/lib/redirect.ts web/src/pages/ConnectPage.tsx web/src/pages/ConnectPage.test.tsx web/src/pages/LoginPage.tsx web/src/pages/LoginPage.test.tsx web/src/App.tsx web/vite.config.ts web/src/auth/AuthGuard.test.tsx web/src/pages/SettingsPage.test.tsx
git commit -m "feat(web): OAuth consent page for AI connections and login next redirect"
```

(Se `AuthGuard.test.tsx` / `SettingsPage.test.tsx` non sono stati modificati, toglili da `git add`.)

---

### Task 13: Web — connessioni AI in Account e accesso utenti in Admin

**Files:**
- Create: `web/src/lib/format.ts`
- Create: `web/src/components/McpConnectionsSection.tsx`, `web/src/components/McpConnectionsSection.test.tsx`
- Create: `web/src/pages/admin/UserAccessPanel.tsx`, `web/src/pages/admin/UserAccessPanel.test.tsx`
- Modify: `web/src/pages/AccountPage.tsx`
- Modify: `web/src/pages/admin/AdminUsersPage.tsx`
- Modify: `web/src/api/admin.ts`

**Interfaces:**
- Consumes: `listConnections`, `revokeConnection`, `McpConnection` (Task 12); `GET /api/admin/permissions`, `PATCH /api/admin/users/{id}`, `GET/DELETE /api/admin/users/{id}/mcp-connections` (Task 7); `useHasPermission` (`AuthContext`).
- Produces: `formatDateTime(value: string): string`; `<McpConnectionsSection mcpUrl={string} />`; `<UserAccessPanel user={AdminUser} />`; hook `useAdminMcpConnections(id)`, `useRevokeAdminMcpConnections(id)`.

Nota: oggi il pannello admin non ha un editor dei permessi (`useUpdateUser` e `useAdminPermissions` esistono ma non sono usati). Senza editor l'admin non può concedere `mcp.access` dalla UI, quindi il pannello "Accesso" lo introduce per tutti i permessi.

- [ ] **Step 1: Scrivi i test che falliscono**

`web/src/components/McpConnectionsSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { listConnections, revokeConnection } from "../api/oauth";
import McpConnectionsSection from "./McpConnectionsSection";

vi.mock("../api/oauth", () => ({ listConnections: vi.fn(), revokeConnection: vi.fn() }));

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><McpConnectionsSection mcpUrl="https://fit.example.com/mcp" /></QueryClientProvider>);
}

describe("McpConnectionsSection", () => {
  it("shows the MCP URL and revokes a connection", async () => {
    vi.mocked(listConnections).mockResolvedValue([
      { client_id: "cid-1", client_name: "Claude", connected_at: "2026-09-01T10:00:00Z", last_used_at: null },
    ]);
    vi.mocked(revokeConnection).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByText("https://fit.example.com/mcp")).toBeInTheDocument();
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /revoca/i }));

    expect(revokeConnection).toHaveBeenCalledWith("cid-1");
  });

  it("says when nothing is connected", async () => {
    vi.mocked(listConnections).mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText(/nessun assistente collegato/i)).toBeInTheDocument();
  });
});
```

`web/src/pages/admin/UserAccessPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminUser } from "../../api/admin";
import { client } from "../../api/client";
import UserAccessPanel from "./UserAccessPanel";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, client: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const USER: AdminUser = {
  id: 2, username: "bob", display_name: "Bob", role: "user", permissions: ["goals.edit"],
  is_active: true, totp_enabled: true, must_change_password: false, locked_until: null,
  last_login_at: null, created_at: "2026-09-01T10:00:00Z", active_sessions: 0,
};

function renderPanel(user: AdminUser = USER) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><UserAccessPanel user={user} /></QueryClientProvider>);
}

describe("UserAccessPanel", () => {
  beforeEach(() => {
    // Cast: `client.get` is generic (<T>(path) => Promise<T>), the fake is not.
    vi.mocked(client.get).mockImplementation((async (path: string) => {
      if (path === "/admin/permissions") return [
        { key: "goals.edit", label: "Modifica gli obiettivi", default: true },
        { key: "mcp.access", label: "Connessioni AI (MCP)", default: false },
      ];
      if (path === "/admin/users/2/mcp-connections") return [
        { client_id: "cid-1", client_name: "Claude", connected_at: "2026-09-01T10:00:00Z", last_used_at: null },
      ];
      throw new Error(`unexpected GET ${path}`);
    }) as typeof client.get);
    vi.mocked(client.patch).mockResolvedValue({ ...USER, permissions: ["goals.edit", "mcp.access"] });
    vi.mocked(client.delete).mockResolvedValue(undefined);
  });

  it("grants a permission", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByLabelText("Connessioni AI (MCP)"));

    expect(client.patch).toHaveBeenCalledWith("/admin/users/2", { permissions: ["goals.edit", "mcp.access"] });
  });

  it("revokes all AI connections", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText(/Claude/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /revoca tutte/i }));

    expect(client.delete).toHaveBeenCalledWith("/admin/users/2/mcp-connections");
  });

  it("does not offer permission toggles for admins", async () => {
    renderPanel({ ...USER, role: "admin" });

    expect(await screen.findByText(/gli amministratori hanno tutti i permessi/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Esegui e verifica che falliscano**

Run (da `web/`): `npm test`
Expected: FAIL (moduli `./McpConnectionsSection`, `./UserAccessPanel` mancanti).

- [ ] **Step 3: Helper di formattazione e hook admin**

`web/src/lib/format.ts`:

```ts
export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
```

In `web/src/pages/AccountPage.tsx` elimina la funzione locale `formatDate`, importa `import { formatDateTime } from "../lib/format";` e sostituisci l'unico uso `formatDate(session.last_seen_at)` con `formatDateTime(session.last_seen_at)`.

In `web/src/api/admin.ts` aggiungi `import type { McpConnection } from "./oauth";` e in fondo:

```ts
export function useAdminMcpConnections(id: number) { return useQuery({ queryKey: ["admin", "users", id, "mcp"], queryFn: () => client.get<McpConnection[]>(`/admin/users/${id}/mcp-connections`) }); }
export function useRevokeAdminMcpConnections(id: number) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => client.delete<void>(`/admin/users/${id}/mcp-connections`), onSettled: () => void qc.invalidateQueries({ queryKey: ["admin", "users", id, "mcp"] }) });
}
```

- [ ] **Step 4: Sezione "Connessioni AI" in Account**

`web/src/components/McpConnectionsSection.tsx`:

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listConnections, revokeConnection } from "../api/oauth";
import { formatDateTime } from "../lib/format";

const connectionsKey = ["oauth", "connections"] as const;

export default function McpConnectionsSection({ mcpUrl }: { mcpUrl: string }) {
  const queryClient = useQueryClient();
  const connections = useQuery({ queryKey: connectionsKey, queryFn: listConnections });
  const revoke = useMutation({
    mutationFn: revokeConnection,
    onSettled: () => queryClient.invalidateQueries({ queryKey: connectionsKey }),
  });
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    await navigator.clipboard?.writeText(mcpUrl);
    setCopied(true);
  }

  return (
    <section className="space-y-2"><h2 className="section-label">Connessioni AI</h2><div className="card space-y-4 p-4">
      <div>
        <p className="text-sm text-slate-600">Collega Claude o un altro assistente compatibile MCP al tuo diario.</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-xl bg-slate-50 px-3 py-2 text-sm">{mcpUrl}</code>
          <button type="button" className="btn-secondary shrink-0" onClick={() => void copyUrl()}>{copied ? "Copiato" : "Copia"}</button>
        </div>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>In Claude apri Impostazioni → Connettori.</li>
          <li>Scegli “Aggiungi connettore personalizzato” e incolla l’URL.</li>
          <li>Accedi con username, password e codice autenticatore, poi autorizza.</li>
        </ol>
      </div>
      <div className="divide-y divide-slate-100 border-t border-slate-100">
        {connections.isLoading && <p className="py-3 text-sm text-slate-500">Caricamento...</p>}
        {connections.isError && <p role="alert" className="py-3 text-sm text-red-700">Impossibile caricare le connessioni.</p>}
        {connections.data?.length === 0 && <p className="py-3 text-sm text-slate-500">Nessun assistente collegato.</p>}
        {connections.data?.map((connection) => (
          <div className="flex items-center gap-3 py-3" key={connection.client_id}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-800">{connection.client_name}</p>
              <p className="text-xs text-slate-500">Ultimo uso: {connection.last_used_at ? formatDateTime(connection.last_used_at) : "mai"}</p>
            </div>
            <button type="button" className="btn-ghost shrink-0 text-sm text-red-600" disabled={revoke.isPending} onClick={() => revoke.mutate(connection.client_id)}>Revoca</button>
          </div>
        ))}
      </div>
    </div></section>
  );
}
```

In `web/src/pages/AccountPage.tsx`:
- import: `import McpConnectionsSection from "../components/McpConnectionsSection";` e aggiungi `useHasPermission` all'import esistente da `../auth/AuthContext`.
- nel componente, dopo `const logout = useLogout();`: `const canUseMcp = useHasPermission("mcp.access");`
- subito prima della `<section>` "Sessioni attive": `{canUseMcp && me?.mcp_url && <McpConnectionsSection mcpUrl={me.mcp_url} />}`

Nota: `useHasPermission` legge `AuthContext`, fornito da `AuthProvider` in `App.tsx`, che avvolge già tutte le route.

- [ ] **Step 5: Pannello "Accesso" in Admin**

`web/src/pages/admin/UserAccessPanel.tsx`:

```tsx
import {
  type AdminUser,
  useAdminMcpConnections,
  useAdminPermissions,
  useRevokeAdminMcpConnections,
  useUpdateUser,
} from "../../api/admin";
import { formatDateTime } from "../../lib/format";
import type { Permission } from "../../lib/permissions";

export default function UserAccessPanel({ user }: { user: AdminUser }) {
  const permissions = useAdminPermissions();
  const update = useUpdateUser();
  const connections = useAdminMcpConnections(user.id);
  const revokeAll = useRevokeAdminMcpConnections(user.id);

  function toggle(key: Permission, enabled: boolean) {
    const next = enabled ? [...user.permissions, key] : user.permissions.filter((p) => p !== key);
    update.mutate({ id: user.id, permissions: next });
  }

  return (
    <div className="mt-3 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Permessi</legend>
        {user.role === "admin"
          ? <p className="text-sm text-slate-500">Gli amministratori hanno tutti i permessi.</p>
          : permissions.data?.map((permission) => (
            <label key={permission.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={user.permissions.includes(permission.key)} disabled={update.isPending} onChange={(e) => toggle(permission.key, e.target.checked)} />
              {permission.label}
            </label>
          ))}
        {update.isError && <p role="alert" className="text-sm text-red-700">{update.error.message}</p>}
      </fieldset>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Connessioni AI</h3>
        {connections.data?.length === 0 && <p className="text-sm text-slate-500">Nessuna connessione attiva.</p>}
        <ul className="space-y-1">
          {connections.data?.map((connection) => (
            <li key={connection.client_id} className="text-sm text-slate-700">
              {connection.client_name} · ultimo uso {connection.last_used_at ? formatDateTime(connection.last_used_at) : "mai"}
            </li>
          ))}
        </ul>
        {Boolean(connections.data?.length) && (
          <button type="button" className="btn-secondary text-red-700" disabled={revokeAll.isPending} onClick={() => revokeAll.mutate()}>Revoca tutte</button>
        )}
      </div>
    </div>
  );
}
```

In `web/src/pages/admin/AdminUsersPage.tsx`:
- import: `import UserAccessPanel from "./UserAccessPanel";`
- stato: `const [accessUserId, setAccessUserId] = useState<number | null>(null);`
- nella riga pulsanti dell'utente, prima del pulsante "Elimina":

```tsx
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setAccessUserId(accessUserId === user.id ? null : user.id)}
            >
              Accesso
            </button>
```

- dopo `{deletingUserId === user.id && <DeleteUserRow ... />}`: `{accessUserId === user.id && <UserAccessPanel user={user} />}`

- [ ] **Step 6: Esegui i test**

Run (da `web/`): `npm test` → PASS; `npm run build` → OK; `npx eslint src` → nessun errore.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/format.ts web/src/components/McpConnectionsSection.tsx web/src/components/McpConnectionsSection.test.tsx web/src/pages/admin/UserAccessPanel.tsx web/src/pages/admin/UserAccessPanel.test.tsx web/src/pages/AccountPage.tsx web/src/pages/admin/AdminUsersPage.tsx web/src/api/admin.ts
git commit -m "feat(web): AI connections in Account and per-user access panel for admins"
```

---

### Task 14: Documentazione, emendamenti allo spec e verifica finale

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-23-mcp-server-design.md`

- [ ] **Step 1: README**

Nel `README.md`:
- in "What it does" aggiungi un punto:

```markdown
- **AI connections (MCP)** — users an admin has enabled can connect Claude (or any MCP client
  with OAuth support) to their own diary at `<PUBLIC_BASE_URL>/mcp`, and ask it to search foods,
  log meals, copy days and change goals. Login uses the same password + TOTP; each connection can
  be revoked from Account.
```

- nella tabella delle variabili d'ambiente aggiungi le righe `PUBLIC_BASE_URL`, `APP_TIMEZONE`, `OAUTH_ACCESS_TOKEN_MINUTES`, `OAUTH_REFRESH_TOKEN_DAYS` con default e descrizione come in `.env.example`.
- aggiungi una sezione:

```markdown
## Connecting an AI assistant (MCP)

1. Set `PUBLIC_BASE_URL` to the public HTTPS origin (the tunnel hostname) and restart `api`.
2. As admin, open Gestione utenti → Accesso and enable **Connessioni AI (MCP)** for the user.
3. The user copies the URL from Account → Connessioni AI and, in Claude, adds it under
   Settings → Connectors → Add custom connector. Claude opens the app's login + consent page.
4. Tokens die immediately on password change, TOTP reset, deactivation, permission removal or
   revocation from Account / the admin panel.

Housekeeping: `docker compose exec api python -m app.cli purge-oauth` removes expired codes and
tokens (safe to run from cron).

Routes involved (all proxied by nginx to `api`): `/mcp`, `/.well-known/oauth-*`, `/register`,
`/authorize`, `/token`, `/revoke`.
```

- nella sezione "Repository layout" aggiungi `app/mcp/` con una riga di descrizione.

- [ ] **Step 2: Emendamenti allo spec**

In `docs/superpowers/specs/2026-09-23-mcp-server-design.md` allinea lo spec a ciò che è stato costruito:
- SDK: `mcp` v2, classe `MCPServer` (non `FastMCP`), trasporto stateless con risposte JSON.
- `oauth_clients.client_secret_enc` (cifrato con la chiave TOTP derivata da `APP_KEY`) al posto di `client_secret_hash`, perché l'SDK confronta il secret in chiaro. Tabella token: modello `OAuthTokenPair`.
- Rate limit: nuova funzione `consume(bucket, key, limit=...)` separata dal limiter del login (non un parametro `bucket` su quello esistente).
- Il pannello admin non aveva un editor permessi: aggiunto pannello "Accesso" (permessi + connessioni AI).
- `POST /api/auth/password` ora revoca anche i token OAuth (non incrementa `auth_version`).
- Service worker: `navigateFallbackDenylist` per `/authorize` e le altre route server.
- "Oggi" nei tool usa `APP_TIMEZONE`; la REST continua a usare UTC come prima.

- [ ] **Step 3: Verifica completa**

```bash
cd api
.venv\Scripts\python -m ruff check app tests
.venv\Scripts\python -m pytest -q
cd ../web
npm test
npm run build
npx eslint src
```

Expected: tutto verde. Il numero di test API è la baseline del Task 0 più i nuovi; nessun test preesistente modificato (tranne i due test web che costruiscono `Me`, se toccati nel Task 12).

- [ ] **Step 4: Controllo manuale end-to-end (a cura dell'utente, richiede HTTPS pubblico)**

1. `docker compose up -d --build`, con `PUBLIC_BASE_URL` impostato al dominio del tunnel.
2. `curl https://<dominio>/.well-known/oauth-authorization-server` → JSON con `issuer` uguale a `PUBLIC_BASE_URL`.
3. Da admin, abilita "Connessioni AI (MCP)" per un utente.
4. In Claude.ai, aggiungi il connettore `https://<dominio>/mcp`, fai login e autorizza.
5. Chiedi "aggiungi 80 g di pasta a pranzo oggi": la voce compare nella web app.
6. Revoca da Account → Connessioni AI: la chiamata successiva di Claude chiede di ricollegarsi.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-23-mcp-server-design.md
git commit -m "docs: document MCP connections and align the spec with the implementation"
```
