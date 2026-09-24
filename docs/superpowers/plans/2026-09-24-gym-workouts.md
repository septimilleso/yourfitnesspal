# Sezione Palestra (stile Strong) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere all'app una sezione Palestra: catalogo esercizi (free-exercise-db, senza immagini) + esercizi custom, modelli di allenamento in cartelle, sessione live salvata sul server con serie da spuntare e timer di riposo, riepilogo con aggiornamento del modello, storico e tool MCP.

**Architecture:** Stesso schema delle feature esistenti: modelli SQLAlchemy in `app/models/`, regole pure (senza DB) in `app/services/gym_rules.py`, operazioni DB in `app/services/{exercises,templates,workouts}.py` condivise da router REST sottili e tool MCP. Il catalogo è un JSON versionato caricato da una migrazione dati. La SPA aggiunge una modalità "Palestra" (selettore nell'header, tab bar dedicata) con pagine in `web/src/pages/gym/` e hook react-query in `web/src/api/gym.ts`; la sessione live scrive ogni modifica sul server e sostituisce la cache con la risposta.

**Tech Stack:** FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, Postgres 16 (pg_trgm), pydantic 2, `mcp` 2.2 (`MCPServer`), pytest + pytest-asyncio; React 18 + TS, react-router 7, @tanstack/react-query 5, Tailwind 3, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-24-gym-workouts-design.md`

## Global Constraints

- Python ≥ 3.12; `ruff` con `line-length = 100`. Nessuna nuova dipendenza Python né npm.
- Catalogo: `yuhonas/free-exercise-db` al commit `a859101d633a01c4a1a920d6a8ce41dabba0705f`, licenza Unlicense, 876 esercizi, **nessuna immagine**, nomi e istruzioni in inglese.
- Regola `tracking`: `category` in (`stretching`, `cardio`) → `duration`; altrimenti `equipment == "body only"` → `reps`; altrimenti `weight_reps`.
- Permesso: `Permission.workouts = "workouts.use"`, etichetta `"Allenamenti"`, incluso in `DEFAULT_PERMISSIONS`. Ogni funzione di servizio palestra chiama `ensure_permission(user, Permission.workouts)`; `PermissionMissing` diventa 403 `{"detail": "forbidden"}` (handler già in `app/main.py`).
- Nomi DB: tabelle `exercises`, `template_folders`, `workout_templates`, `template_exercises`, `template_sets`, `workouts`, `workout_exercises`, `workout_sets`; enum Postgres `exercise_tracking` e `workout_status`.
- Limiti: `weight_kg` 0–1000 (2 decimali), `reps` 0–1000, `duration_s` 0–36000, `rest_seconds` 0–600 (default 90), nomi modello/cartella/workout 1–100 caratteri, nome esercizio 1–255, nota 0–500.
- Unità: solo kg. Nel testo italiano i decimali usano la virgola (`37,5 kg`).
- Errori di dominio: `NotFound("workout not found" | "template not found" | "folder not found" | "exercise not found" | "set not found")`, `Invalid(...)` con i messaggi esatti indicati nei task (la SPA confronta `incomplete_sets` ed `empty_workout`).
- Tool MCP: nomi, argomenti e descrizioni in inglese; agiscono solo sull'utente del token. Testi UI in italiano.
- Frontend: solo Tailwind con le classi esistenti (`card`, `row`, `field`, `field-label`, `btn-primary`, `btn-secondary`, `btn-ghost`, `section-label`, `app-header`); ogni accesso a `localStorage` dentro try/catch.
- Questa macchina non ha Postgres né Docker: i test DB-backed si scrivono ma girano sul deploy remoto. Localmente: da `api/` `.venv\Scripts\python -m ruff check app tests scripts`, `.venv\Scripts\python -c "import app.main"`, i test DB-free indicati, `.venv\Scripts\python -m pytest --collect-only -q`; da `web/` `npm test` e `npm run build`.
- Un commit per task, messaggi Conventional Commits in inglese, che terminano con la riga di attribuzione indicata dall'orchestratore.

---

## File Structure

**API — nuovi**
- `api/app/models/exercise.py` — `Exercise`, `Tracking`, `EQUIPMENT`, `MUSCLES`.
- `api/app/models/workout.py` — `TemplateFolder`, `WorkoutTemplate`, `TemplateExercise`, `TemplateSet`, `Workout`, `WorkoutExercise`, `WorkoutSet`, `WorkoutStatus`.
- `api/alembic/versions/9a4d2c7e1f03_gym_schema.py` — tabelle + permesso agli utenti esistenti.
- `api/alembic/versions/b81f5e3a6c42_gym_exercise_catalog.py` — caricamento catalogo.
- `api/app/services/gym_rules.py` — regole pure: tracking, superserie, validazione serie, timer, formattazione, diff modello.
- `api/app/services/exercise_catalog.py` — riduzione del JSON sorgente, lettura del file, upsert.
- `api/app/data/exercises.json`, `api/app/data/README.md` — catalogo ridotto e provenienza.
- `api/scripts/build_exercises.py` — rigenera `exercises.json`.
- `api/app/schemas/exercise.py`, `api/app/schemas/workout.py` — schemi pydantic.
- `api/app/services/exercises.py`, `api/app/services/templates.py`, `api/app/services/workouts.py` — logica DB.
- `api/app/routers/exercises.py`, `api/app/routers/templates.py`, `api/app/routers/workouts.py` — REST.
- `api/app/mcp/tools/workouts.py` — tool MCP.
- Test: `api/tests/test_gym_models.py`, `test_gym_rules.py`, `test_exercise_catalog.py`, `test_exercises_service.py`, `test_templates_service.py`, `test_workouts_live.py`, `test_workouts_finish.py`, `test_gym_routers.py`, `test_mcp_tools_workouts.py`, `test_gym_permission.py`.

**API — modificati**
- `api/app/models/__init__.py`, `api/app/permissions.py`, `api/app/main.py`, `api/app/mcp/server.py`, `api/pyproject.toml`, `api/tests/factories.py`.

**Web — nuovi**
- `web/src/api/gym.ts` — tipi, chiavi, chiamate e hook.
- `web/src/lib/gym.ts`, `web/src/lib/restTimer.ts`, `web/src/lib/appMode.ts`, `web/src/lib/useNow.ts`, `web/src/lib/useDebounced.ts` (+ test).
- `web/src/components/ModeSwitch.tsx`, `web/src/components/gym/*` (`ActionMenu`, `ActiveWorkoutBar`, `ExerciseFilters`, `ExerciseDetailSheet`, `CustomExerciseForm`, `ExercisePicker`, `NumberInput`, `RestPicker`, `TemplateCard`, `TemplatePreviewSheet`, `MoveToFolderSheet`, `liveErrors`, `SetRow`, `RestTimerBar`, `WorkoutExerciseCard`).
- `web/src/pages/gym/` — `GymStartPage`, `TemplateEditorPage`, `ExercisesPage`, `WorkoutPage`, `HistoryPage`, `WorkoutDetailPage` (+ test).

**Web — modificati**
- `web/src/App.tsx`, `web/src/components/AppShell.tsx` (+ test), `web/src/lib/permissions.ts`, header di `DayPage`, `SearchPage`, `WeekPage`, `SettingsPage`, `AccountPage`.

**Docs**: `README.md`.

---

### Task 1: Modelli, migrazione schema e permesso `workouts.use`

**Files:**
- Create: `api/app/models/exercise.py`
- Create: `api/app/models/workout.py`
- Create: `api/alembic/versions/9a4d2c7e1f03_gym_schema.py`
- Modify: `api/app/models/__init__.py`
- Modify: `api/app/permissions.py`
- Modify: `api/tests/factories.py`
- Modify: `api/pyproject.toml`
- Modify: `web/src/lib/permissions.ts`
- Test: `api/tests/test_gym_permission.py` (DB-free), `api/tests/test_gym_models.py` (DB)

**Interfaces:**
- Produces: `app.models.exercise.{Exercise, Tracking, EQUIPMENT, MUSCLES}`; `app.models.workout.{TemplateFolder, WorkoutTemplate, TemplateExercise, TemplateSet, Workout, WorkoutExercise, WorkoutSet, WorkoutStatus}`; `Permission.workouts`; factories `make_exercise(db, *, name="Test Squat", tracking=Tracking.weight_reps, owner=None, equipment="barbell", muscle="quadriceps") -> Exercise` and constant `GYM = ["workouts.use"]` in `tests/factories.py`.
- Relationships (ordered by `position`, `cascade="all, delete-orphan"`): `WorkoutTemplate.exercises`, `TemplateExercise.sets`, `Workout.exercises`, `WorkoutExercise.sets`; many-to-one `TemplateExercise.exercise`, `WorkoutExercise.exercise`.

- [ ] **Step 1: Write the failing DB-free permission test**

`api/tests/test_gym_permission.py`:

```python
"""The gym permission exists and is on by default (DB-free)."""

from app.permissions import DEFAULT_PERMISSIONS, PERMISSION_LABELS, Permission


def test_workouts_permission_is_default() -> None:
    assert Permission.workouts.value == "workouts.use"
    assert Permission.workouts in DEFAULT_PERMISSIONS
    assert PERMISSION_LABELS[Permission.workouts] == "Allenamenti"
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `api/`): `.venv\Scripts\python -m pytest tests/test_gym_permission.py -v`
Expected: FAIL with `AttributeError: workouts`.

- [ ] **Step 3: Add the permission**

In `api/app/permissions.py` add the member and the label:

```python
class Permission(str, enum.Enum):
    foods_off_lookup = "foods.off_lookup"
    foods_custom_create = "foods.custom_create"
    diary_copy = "diary.copy"
    goals_edit = "goals.edit"
    mcp_access = "mcp.access"
    workouts = "workouts.use"


PERMISSION_LABELS: dict[Permission, str] = {
    Permission.foods_off_lookup: "Ricerca su OpenFoodFacts",
    Permission.foods_custom_create: "Crea alimenti personalizzati",
    Permission.diary_copy: "Copia giorni del diario",
    Permission.goals_edit: "Modifica gli obiettivi",
    Permission.mcp_access: "Connessioni AI (MCP)",
    Permission.workouts: "Allenamenti",
}
```

(`DEFAULT_PERMISSIONS = frozenset(Permission) - {Permission.mcp_access}` already includes it.)

In `web/src/lib/permissions.ts`:

```ts
export type Permission = "foods.off_lookup" | "foods.custom_create" | "diary.copy" | "goals.edit" | "mcp.access" | "workouts.use";

export const PERMISSIONS: Permission[] = ["foods.off_lookup", "foods.custom_create", "diary.copy", "goals.edit", "mcp.access", "workouts.use"];
```

- [ ] **Step 4: Run the permission test**

Run: `.venv\Scripts\python -m pytest tests/test_gym_permission.py -v`
Expected: PASS.

- [ ] **Step 5: Write the exercise model**

`api/app/models/exercise.py`:

```python
import enum
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

# Values used by the free-exercise-db catalog; custom exercises must pick from these.
EQUIPMENT = (
    "bands", "barbell", "body only", "cable", "dumbbell", "e-z curl bar", "exercise ball",
    "foam roll", "kettlebells", "machine", "medicine ball", "other",
)
MUSCLES = (
    "abdominals", "abductors", "adductors", "biceps", "calves", "chest", "forearms", "glutes",
    "hamstrings", "lats", "lower back", "middle back", "neck", "quadriceps", "shoulders",
    "traps", "triceps",
)


class Tracking(str, enum.Enum):
    """What a set of this exercise records. Values map 1:1 to the Postgres enum."""

    weight_reps = "weight_reps"
    reps = "reps"
    duration = "duration"


class Exercise(Base):
    """An exercise from the bundled catalog (`source="catalog"`) or a user's own
    (`source="custom"`, `owner_user_id` set).

    Rows are never deleted: history and templates reference them. A custom
    exercise the user "deletes" gets `archived_at` and disappears from search.
    """

    __tablename__ = "exercises"
    __table_args__ = (
        sa.CheckConstraint(
            "(source = 'custom') = (owner_user_id IS NOT NULL)",
            name="ck_exercises_owner_only_custom",
        ),
        sa.UniqueConstraint("source", "source_id", name="uq_exercises_source_source_id"),
        sa.Index(
            "ix_exercises_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
    )

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    source: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    source_id: Mapped[str | None] = mapped_column(sa.String(128), nullable=True)
    owner_user_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    equipment: Mapped[str | None] = mapped_column(sa.String(32), nullable=True)
    primary_muscles: Mapped[list[str]] = mapped_column(
        ARRAY(sa.String(32)), nullable=False, server_default="{}"
    )
    secondary_muscles: Mapped[list[str]] = mapped_column(
        ARRAY(sa.String(32)), nullable=False, server_default="{}"
    )
    category: Mapped[str | None] = mapped_column(sa.String(32), nullable=True)
    instructions: Mapped[list[str]] = mapped_column(
        ARRAY(sa.Text), nullable=False, server_default="{}"
    )
    tracking: Mapped[Tracking] = mapped_column(
        sa.Enum(
            Tracking,
            name="exercise_tracking",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Exercise(id={self.id!r}, name={self.name!r})"
```

- [ ] **Step 6: Write the workout models**

`api/app/models/workout.py`:

```python
import enum
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.exercise import Exercise


class WorkoutStatus(str, enum.Enum):
    in_progress = "in_progress"
    finished = "finished"


# FKs to `exercises` use the default NO ACTION: exercises are never deleted,
# and NO ACTION (unlike RESTRICT) is checked at statement end, so deleting a
# user cascades through their workouts and custom exercises without tripping it.


class TemplateFolder(Base):
    __tablename__ = "template_folders"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)


class WorkoutTemplate(Base):
    """A reusable workout plan ("Giorno 1"), optionally inside a folder."""

    __tablename__ = "workout_templates"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    folder_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("template_folders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
        nullable=False,
    )

    exercises: Mapped[list["TemplateExercise"]] = relationship(
        order_by="TemplateExercise.position", cascade="all, delete-orphan"
    )


class TemplateExercise(Base):
    __tablename__ = "template_exercises"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(
        sa.ForeignKey("workout_templates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exercise_id: Mapped[int] = mapped_column(
        sa.ForeignKey("exercises.id"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    rest_seconds: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=90)
    superset_group: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)

    exercise: Mapped[Exercise] = relationship()
    sets: Mapped[list["TemplateSet"]] = relationship(
        order_by="TemplateSet.position", cascade="all, delete-orphan"
    )


class TemplateSet(Base):
    __tablename__ = "template_sets"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    template_exercise_id: Mapped[int] = mapped_column(
        sa.ForeignKey("template_exercises.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    weight_kg: Mapped[float | None] = mapped_column(sa.Numeric(6, 2), nullable=True)
    reps: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    duration_s: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)


class Workout(Base):
    """A workout session: `in_progress` while live (at most one per user), then
    `finished`. `rest_ends_at` is the absolute end of the running rest timer."""

    __tablename__ = "workouts"
    __table_args__ = (
        sa.Index(
            "ux_workouts_one_in_progress",
            "user_id",
            unique=True,
            postgresql_where=sa.text("status = 'in_progress'"),
        ),
        sa.Index("ix_workouts_user_finished", "user_id", "finished_at"),
    )

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    template_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("workout_templates.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    status: Mapped[WorkoutStatus] = mapped_column(
        sa.Enum(
            WorkoutStatus,
            name="workout_status",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    rest_ends_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    rest_total_s: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)

    exercises: Mapped[list["WorkoutExercise"]] = relationship(
        order_by="WorkoutExercise.position", cascade="all, delete-orphan"
    )


class WorkoutExercise(Base):
    __tablename__ = "workout_exercises"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    workout_id: Mapped[int] = mapped_column(
        sa.ForeignKey("workouts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exercise_id: Mapped[int] = mapped_column(
        sa.ForeignKey("exercises.id"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    rest_seconds: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=90)
    superset_group: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)

    exercise: Mapped[Exercise] = relationship()
    sets: Mapped[list["WorkoutSet"]] = relationship(
        order_by="WorkoutSet.position", cascade="all, delete-orphan"
    )


class WorkoutSet(Base):
    __tablename__ = "workout_sets"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    workout_exercise_id: Mapped[int] = mapped_column(
        sa.ForeignKey("workout_exercises.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    weight_kg: Mapped[float | None] = mapped_column(sa.Numeric(6, 2), nullable=True)
    reps: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    duration_s: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
```

Register them in `api/app/models/__init__.py` (keep alphabetical order in both the imports and `__all__`):

```python
from app.models.base import Base
from app.models.diary import DiaryEntry, Meal
from app.models.exercise import Exercise, Tracking
from app.models.food import Food, FoodPortion
from app.models.goal import Goal
from app.models.meal_template import MealTemplate, MealTemplateItem
from app.models.oauth import OAuthAuthCode, OAuthClient, OAuthTokenPair
from app.models.user import AuditEvent, RecoveryCode, Role, User, UserSession
from app.models.workout import (
    TemplateExercise,
    TemplateFolder,
    TemplateSet,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutStatus,
    WorkoutTemplate,
)

__all__ = [
    "AuditEvent",
    "Base",
    "DiaryEntry",
    "Exercise",
    "Food",
    "FoodPortion",
    "Goal",
    "Meal",
    "MealTemplate",
    "MealTemplateItem",
    "OAuthAuthCode",
    "OAuthClient",
    "OAuthTokenPair",
    "RecoveryCode",
    "Role",
    "TemplateExercise",
    "TemplateFolder",
    "TemplateSet",
    "Tracking",
    "User",
    "UserSession",
    "Workout",
    "WorkoutExercise",
    "WorkoutSet",
    "WorkoutStatus",
    "WorkoutTemplate",
]
```

- [ ] **Step 7: Write the schema migration**

`api/alembic/versions/9a4d2c7e1f03_gym_schema.py`:

```python
"""Gym: exercises, templates, workouts, and the workouts.use permission.

Revision ID: 9a4d2c7e1f03
Revises: 7c3e1a9b5d20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "9a4d2c7e1f03"
down_revision: str | Sequence[str] | None = "7c3e1a9b5d20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EMPTY_ARRAY = sa.text("'{}'")


def upgrade() -> None:
    bind = op.get_bind()
    tracking = postgresql.ENUM(
        "weight_reps", "reps", "duration", name="exercise_tracking", create_type=False
    )
    status = postgresql.ENUM("in_progress", "finished", name="workout_status", create_type=False)
    tracking.create(bind, checkfirst=True)
    status.create(bind, checkfirst=True)

    op.create_table(
        "exercises",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("source_id", sa.String(128), nullable=True),
        sa.Column(
            "owner_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("equipment", sa.String(32), nullable=True),
        sa.Column(
            "primary_muscles", postgresql.ARRAY(sa.String(32)), nullable=False,
            server_default=_EMPTY_ARRAY,
        ),
        sa.Column(
            "secondary_muscles", postgresql.ARRAY(sa.String(32)), nullable=False,
            server_default=_EMPTY_ARRAY,
        ),
        sa.Column("category", sa.String(32), nullable=True),
        sa.Column(
            "instructions", postgresql.ARRAY(sa.Text()), nullable=False,
            server_default=_EMPTY_ARRAY,
        ),
        sa.Column("tracking", tracking, nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(source = 'custom') = (owner_user_id IS NOT NULL)",
            name="ck_exercises_owner_only_custom",
        ),
        sa.UniqueConstraint("source", "source_id", name="uq_exercises_source_source_id"),
    )
    op.create_index("ix_exercises_owner_user_id", "exercises", ["owner_user_id"])
    op.create_index(
        "ix_exercises_name_trgm", "exercises", ["name"],
        postgresql_using="gin", postgresql_ops={"name": "gin_trgm_ops"},
    )

    op.create_table(
        "template_folders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_template_folders_user_id", "template_folders", ["user_id"])

    op.create_table(
        "workout_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "folder_id", sa.Integer(),
            sa.ForeignKey("template_folders.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_workout_templates_user_id", "workout_templates", ["user_id"])
    op.create_index("ix_workout_templates_folder_id", "workout_templates", ["folder_id"])

    op.create_table(
        "template_exercises",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "template_id", sa.Integer(),
            sa.ForeignKey("workout_templates.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("exercise_id", sa.Integer(), sa.ForeignKey("exercises.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("rest_seconds", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("superset_group", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
    )
    op.create_index("ix_template_exercises_template_id", "template_exercises", ["template_id"])
    op.create_index("ix_template_exercises_exercise_id", "template_exercises", ["exercise_id"])

    op.create_table(
        "template_sets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "template_exercise_id", sa.Integer(),
            sa.ForeignKey("template_exercises.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("weight_kg", sa.Numeric(6, 2), nullable=True),
        sa.Column("reps", sa.Integer(), nullable=True),
        sa.Column("duration_s", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_template_sets_template_exercise_id", "template_sets", ["template_exercise_id"]
    )

    op.create_table(
        "workouts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "template_id", sa.Integer(),
            sa.ForeignKey("workout_templates.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("status", status, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rest_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rest_total_s", sa.Integer(), nullable=True),
    )
    op.create_index("ix_workouts_user_id", "workouts", ["user_id"])
    op.create_index("ix_workouts_template_id", "workouts", ["template_id"])
    op.create_index("ix_workouts_user_finished", "workouts", ["user_id", "finished_at"])
    op.create_index(
        "ux_workouts_one_in_progress", "workouts", ["user_id"], unique=True,
        postgresql_where=sa.text("status = 'in_progress'"),
    )

    op.create_table(
        "workout_exercises",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "workout_id", sa.Integer(), sa.ForeignKey("workouts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("exercise_id", sa.Integer(), sa.ForeignKey("exercises.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("rest_seconds", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("superset_group", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
    )
    op.create_index("ix_workout_exercises_workout_id", "workout_exercises", ["workout_id"])
    op.create_index("ix_workout_exercises_exercise_id", "workout_exercises", ["exercise_id"])

    op.create_table(
        "workout_sets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "workout_exercise_id", sa.Integer(),
            sa.ForeignKey("workout_exercises.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("weight_kg", sa.Numeric(6, 2), nullable=True),
        sa.Column("reps", sa.Integer(), nullable=True),
        sa.Column("duration_s", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_workout_sets_workout_exercise_id", "workout_sets", ["workout_exercise_id"]
    )

    # Existing accounts get the new default permission too.
    op.execute(
        "UPDATE users SET permissions = permissions || '[\"workouts.use\"]'::jsonb "
        "WHERE NOT permissions ? 'workouts.use'"
    )


def downgrade() -> None:
    op.execute("UPDATE users SET permissions = permissions - 'workouts.use'")
    op.drop_table("workout_sets")
    op.drop_table("workout_exercises")
    op.drop_table("workouts")
    op.drop_table("template_sets")
    op.drop_table("template_exercises")
    op.drop_table("workout_templates")
    op.drop_table("template_folders")
    op.drop_table("exercises")
    bind = op.get_bind()
    postgresql.ENUM(name="workout_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="exercise_tracking").drop(bind, checkfirst=True)
```

Note for the implementer: the `?` inside the SQL string is the JSONB "has key" operator. `op.execute` with a plain string goes through `sa.text()`, where `?` is not a bind marker, so it is safe. If asyncpg complains about it on the remote run, use `jsonb_exists(permissions, 'workouts.use')` instead of `permissions ? 'workouts.use'`.

- [ ] **Step 8: Package the data directory and add the test factory**

In `api/pyproject.toml`, below `[tool.setuptools.packages.find]`, add (so `pip install .` ships the catalog JSON added in Task 2):

```toml
[tool.setuptools.package-data]
app = ["data/*.json"]
```

Append to `api/tests/factories.py` (add `from app.models.exercise import Exercise, Tracking` to the imports):

```python
GYM = ["workouts.use"]


async def make_exercise(
    db: AsyncSession,
    *,
    name: str = "Test Squat",
    tracking: Tracking = Tracking.weight_reps,
    owner: User | None = None,
    equipment: str | None = "barbell",
    muscle: str = "quadriceps",
) -> Exercise:
    """A catalog exercise, or a custom one owned by `owner`.

    Tests use made-up names (e.g. "Zzq Press") so they never collide with the
    876 real catalog rows the data migration loads into the test database.
    """
    exercise = Exercise(
        source="custom" if owner else "catalog",
        source_id=None if owner else f"test-{name}",
        owner_user_id=owner.id if owner else None,
        name=name, equipment=equipment, primary_muscles=[muscle], secondary_muscles=[],
        category="strength", instructions=[], tracking=tracking,
    )
    db.add(exercise)
    await db.flush()
    return exercise
```

- [ ] **Step 9: Write the DB-backed model tests**

`api/tests/test_gym_models.py`:

```python
"""Constraints on the gym tables (needs Postgres)."""

from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.models.exercise import Exercise, Tracking
from app.models.user import User
from app.models.workout import Workout, WorkoutExercise, WorkoutSet, WorkoutStatus
from tests.factories import make_exercise, make_user


async def test_custom_exercise_needs_owner(db) -> None:
    db.add(Exercise(
        source="custom", name="Orphan", primary_muscles=[], secondary_muscles=[],
        instructions=[], tracking=Tracking.reps,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_only_one_workout_in_progress_per_user(db) -> None:
    user = await make_user(db)
    now = datetime.now(UTC)
    db.add(Workout(user_id=user.id, name="A", status=WorkoutStatus.in_progress, started_at=now))
    await db.flush()
    db.add(Workout(user_id=user.id, name="B", status=WorkoutStatus.finished, started_at=now))
    await db.flush()
    db.add(Workout(user_id=user.id, name="C", status=WorkoutStatus.in_progress, started_at=now))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_deleting_user_cascades_through_workouts_and_custom_exercises(db) -> None:
    user = await make_user(db)
    custom = await make_exercise(db, name="Zzq Custom", owner=user)
    workout = Workout(
        user_id=user.id, name="A", status=WorkoutStatus.finished,
        started_at=datetime.now(UTC),
        exercises=[WorkoutExercise(
            exercise_id=custom.id, position=0, rest_seconds=90,
            sets=[WorkoutSet(position=0, reps=5)],
        )],
    )
    db.add(workout)
    await db.flush()
    await db.execute(sa.delete(User).where(User.id == user.id))
    assert await db.scalar(sa.select(sa.func.count()).select_from(Workout).where(
        Workout.user_id == user.id)) == 0
    assert await db.get(Exercise, custom.id, populate_existing=True) is None
```

- [ ] **Step 10: Verify locally what can run**

Run (from `api/`):
- `.venv\Scripts\python -m ruff check app tests`
- `.venv\Scripts\python -c "import app.main"`
- `.venv\Scripts\python -m pytest tests/test_gym_permission.py -v` → PASS
- `.venv\Scripts\python -m pytest --collect-only -q` → no import errors

From `web/`: `npm run build` → success.

`tests/test_gym_models.py` needs Postgres: written, not run locally.

- [ ] **Step 11: Commit**

```bash
git add api/app/models/exercise.py api/app/models/workout.py api/app/models/__init__.py api/alembic/versions/9a4d2c7e1f03_gym_schema.py api/app/permissions.py api/pyproject.toml api/tests/factories.py api/tests/test_gym_permission.py api/tests/test_gym_models.py web/src/lib/permissions.ts
git commit -m "feat(api): gym tables, models and the workouts.use permission"
```

---

### Task 2: Regole pure e catalogo esercizi

**Files:**
- Create: `api/app/services/gym_rules.py`
- Create: `api/app/services/exercise_catalog.py`
- Create: `api/scripts/build_exercises.py`
- Create: `api/app/data/exercises.json` (generated)
- Create: `api/app/data/README.md`
- Create: `api/alembic/versions/b81f5e3a6c42_gym_exercise_catalog.py`
- Test: `api/tests/test_gym_rules.py` (DB-free), `api/tests/test_exercise_catalog.py` (DB-free + 1 DB test)

**Interfaces:**
- Consumes: `Tracking` from Task 1.
- Produces (`app.services.gym_rules`):
  - `DEFAULT_REST_SECONDS = 90`
  - `SetTuple = tuple[float | None, int | None, int | None]` — `(weight_kg, reps, duration_s)`
  - `derive_tracking(category: str | None, equipment: str | None) -> Tracking`
  - `normalize_supersets(groups: Sequence[int | None]) -> list[int | None]`
  - `set_problem(tracking: Tracking, weight_kg, reps, duration_s) -> str | None`
  - `ExerciseProgress(rest_seconds: int, superset_group: int | None, set_positions: frozenset[int], completed_positions: frozenset[int])` (frozen dataclass)
  - `rest_after_completion(exercises: Sequence[ExerciseProgress], index: int, position: int) -> int | None`
  - `format_kg(value) -> str`, `format_duration(seconds: int) -> str`, `format_set(tracking: Tracking, values: SetTuple) -> str`
  - `DiffExercise(exercise_id: int, name: str, tracking: Tracking, rest_seconds: int, superset_group: int | None, sets: tuple[SetTuple, ...])` (frozen dataclass)
  - `template_diff(template: Sequence[DiffExercise], workout: Sequence[DiffExercise]) -> list[str]`
- Produces (`app.services.exercise_catalog`): `CATALOG_PATH: Path`, `reduce_exercise(raw: dict) -> dict`, `load_catalog_rows() -> list[dict]`, `upsert_catalog(connection: sa.Connection) -> int`.

- [ ] **Step 1: Write the failing rules tests**

`api/tests/test_gym_rules.py`:

```python
"""Pure gym rules (DB-free)."""

from app.models.exercise import Tracking
from app.services.gym_rules import (
    DiffExercise,
    ExerciseProgress,
    derive_tracking,
    format_duration,
    format_kg,
    format_set,
    normalize_supersets,
    rest_after_completion,
    set_problem,
    template_diff,
)


def test_derive_tracking() -> None:
    assert derive_tracking("stretching", "body only") is Tracking.duration
    assert derive_tracking("cardio", "machine") is Tracking.duration
    assert derive_tracking("strength", "body only") is Tracking.reps
    assert derive_tracking("strength", "barbell") is Tracking.weight_reps
    assert derive_tracking("strength", None) is Tracking.weight_reps


def test_normalize_supersets() -> None:
    assert normalize_supersets([]) == []
    assert normalize_supersets([None, 7, 7, None]) == [None, 1, 1, None]
    # a lone member is not a superset
    assert normalize_supersets([3, None, 5, 5, 5]) == [None, None, 1, 1, 1]
    # the same value in two separate runs gives two groups
    assert normalize_supersets([2, 2, None, 2, 2]) == [1, 1, None, 2, 2]
    # adjacent different groups stay different
    assert normalize_supersets([4, 4, 9, 9]) == [1, 1, 2, 2]


def test_set_problem() -> None:
    assert set_problem(Tracking.weight_reps, 80, 8, None) is None
    assert set_problem(Tracking.weight_reps, None, 8, None) == "weight and reps are required"
    assert set_problem(Tracking.weight_reps, 80, None, None) == "weight and reps are required"
    assert set_problem(Tracking.reps, None, 10, None) is None
    assert set_problem(Tracking.reps, 10, None, None) == "reps are required"
    assert set_problem(Tracking.duration, None, None, 60) is None
    assert set_problem(Tracking.duration, None, None, None) == "duration is required"


def _p(rest, group, sets, done):
    return ExerciseProgress(
        rest_seconds=rest, superset_group=group,
        set_positions=frozenset(sets), completed_positions=frozenset(done),
    )


def test_rest_after_completion_single_exercise() -> None:
    assert rest_after_completion([_p(90, None, {0, 1}, {0})], 0, 0) == 90
    assert rest_after_completion([_p(0, None, {0}, {0})], 0, 0) is None


def test_rest_after_completion_superset_waits_for_round() -> None:
    a_done = [_p(30, 1, {0, 1}, {0}), _p(120, 1, {0, 1}, set())]
    assert rest_after_completion(a_done, 0, 0) is None
    both_done = [_p(30, 1, {0, 1}, {0}), _p(120, 1, {0, 1}, {0})]
    # the last exercise of the group decides the rest
    assert rest_after_completion(both_done, 1, 0) == 120
    # an exercise with no set at that position does not block the round
    short = [_p(30, 1, {0, 1, 2}, {2}), _p(120, 1, {0, 1}, set())]
    assert rest_after_completion(short, 0, 2) == 120


def test_formatting() -> None:
    assert format_kg(80) == "80"
    assert format_kg(37.5) == "37,5"
    assert format_kg(2.25) == "2,25"
    assert format_duration(90) == "1:30"
    assert format_duration(5) == "0:05"
    assert format_set(Tracking.weight_reps, (80, 8, None)) == "80 kg × 8"
    assert format_set(Tracking.reps, (None, 12, None)) == "12 rip"
    assert format_set(Tracking.reps, (10, 12, None)) == "10 kg × 12"
    assert format_set(Tracking.duration, (None, None, 75)) == "1:15"


def _ex(exercise_id, name, sets, rest=90, group=None, tracking=Tracking.weight_reps):
    return DiffExercise(
        exercise_id=exercise_id, name=name, tracking=tracking, rest_seconds=rest,
        superset_group=group, sets=tuple(sets),
    )


def test_template_diff_no_changes() -> None:
    squat = _ex(1, "Squat", [(80, 8, None), (80, 8, None)])
    assert template_diff([squat], [squat]) == []


def test_template_diff_values_sets_and_rest() -> None:
    before = [_ex(1, "Squat", [(80, 8, None), (80, 8, None)], rest=90)]
    after = [_ex(1, "Squat", [(85, 8, None), (80, 8, None), (80, 6, None)], rest=120)]
    assert template_diff(before, after) == [
        "Squat: serie 1 80 kg × 8 → 85 kg × 8",
        "Squat: +1 serie",
        "Squat: riposo 1:30 → 2:00",
    ]
    assert template_diff(after, before) == [
        "Squat: serie 1 85 kg × 8 → 80 kg × 8",
        "Squat: -1 serie",
        "Squat: riposo 2:00 → 1:30",
    ]


def test_template_diff_added_removed_and_order() -> None:
    squat = _ex(1, "Squat", [(80, 8, None)])
    curl = _ex(2, "Curl", [(10, 12, None)])
    plank = _ex(3, "Plank", [(None, None, 60)], tracking=Tracking.duration)
    assert template_diff([squat, curl], [squat, plank]) == ["Aggiunto: Plank", "Rimosso: Curl"]
    assert template_diff([squat, curl], [curl, squat]) == ["Ordine o superserie modificati"]
    linked = [_ex(1, "Squat", [(80, 8, None)], group=1), _ex(2, "Curl", [(10, 12, None)], group=1)]
    assert template_diff([squat, curl], linked) == ["Ordine o superserie modificati"]


def test_template_diff_matches_repeated_exercise_by_occurrence() -> None:
    before = [_ex(1, "Squat", [(60, 10, None)]), _ex(1, "Squat", [(100, 3, None)])]
    after = [_ex(1, "Squat", [(60, 10, None)]), _ex(1, "Squat", [(105, 3, None)])]
    assert template_diff(before, after) == ["Squat: serie 1 100 kg × 3 → 105 kg × 3"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv\Scripts\python -m pytest tests/test_gym_rules.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.gym_rules'`.

- [ ] **Step 3: Implement `gym_rules.py`**

`api/app/services/gym_rules.py`:

```python
"""Pure gym rules shared by the services, the catalog build and the tests.

Nothing here touches the database, so every rule is unit-testable without
Postgres. Italian strings are user-facing (the SPA shows them verbatim).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from app.models.exercise import Tracking

DEFAULT_REST_SECONDS = 90

# (weight_kg, reps, duration_s)
SetTuple = tuple[float | Decimal | None, int | None, int | None]


def derive_tracking(category: str | None, equipment: str | None) -> Tracking:
    """What a catalog exercise records, from its free-exercise-db fields."""
    if category in ("stretching", "cardio"):
        return Tracking.duration
    if equipment == "body only":
        return Tracking.reps
    return Tracking.weight_reps


def normalize_supersets(groups: Sequence[int | None]) -> list[int | None]:
    """Renumber superset groups 1..n over runs of consecutive equal values.

    A run of one exercise is not a superset and becomes None; the same value
    in two separate runs yields two distinct groups.
    """
    result: list[int | None] = [None] * len(groups)
    next_group = 1
    start = 0
    while start < len(groups):
        end = start
        if groups[start] is not None:
            while end + 1 < len(groups) and groups[end + 1] == groups[start]:
                end += 1
        if end > start:
            for index in range(start, end + 1):
                result[index] = next_group
            next_group += 1
        start = end + 1
    return result


def set_problem(
    tracking: Tracking,
    weight_kg: float | Decimal | None,
    reps: int | None,
    duration_s: int | None,
) -> str | None:
    """Why a set cannot be marked done, or None when it can."""
    if tracking is Tracking.weight_reps and (weight_kg is None or reps is None):
        return "weight and reps are required"
    if tracking is Tracking.reps and reps is None:
        return "reps are required"
    if tracking is Tracking.duration and duration_s is None:
        return "duration is required"
    return None


@dataclass(frozen=True)
class ExerciseProgress:
    rest_seconds: int
    superset_group: int | None
    set_positions: frozenset[int]
    completed_positions: frozenset[int]


def rest_after_completion(
    exercises: Sequence[ExerciseProgress], index: int, position: int
) -> int | None:
    """Seconds of rest to start after set `position` of `exercises[index]` is done.

    Outside a superset: that exercise's rest. Inside one: only once every
    exercise of the group has finished (or has no) set at that position, using
    the rest of the group's last exercise. 0 means no timer.
    """
    current = exercises[index]
    if current.superset_group is None:
        rest = current.rest_seconds
    else:
        group = [e for e in exercises if e.superset_group == current.superset_group]
        round_done = all(
            position not in e.set_positions or position in e.completed_positions for e in group
        )
        if not round_done:
            return None
        rest = group[-1].rest_seconds
    return rest or None


def format_kg(value: float | Decimal) -> str:
    text = f"{float(value):.2f}".rstrip("0").rstrip(".")
    return text.replace(".", ",")


def format_duration(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def format_set(tracking: Tracking, values: SetTuple) -> str:
    weight, reps, duration = values
    if tracking is Tracking.duration:
        return format_duration(duration or 0)
    if tracking is Tracking.reps and weight is None:
        return f"{reps or 0} rip"
    return f"{format_kg(weight or 0)} kg × {reps or 0}"


@dataclass(frozen=True)
class DiffExercise:
    exercise_id: int
    name: str
    tracking: Tracking
    rest_seconds: int
    superset_group: int | None
    sets: tuple[SetTuple, ...]


def _norm(values: SetTuple) -> tuple[float | None, ...]:
    return tuple(None if v is None else float(v) for v in values)


def _keyed(items: Sequence[DiffExercise]) -> list[tuple[tuple[int, int], DiffExercise]]:
    """Key each item by (exercise_id, occurrence), so the k-th Squat of the
    template pairs with the k-th Squat of the workout."""
    seen: dict[int, int] = {}
    keyed = []
    for item in items:
        occurrence = seen.get(item.exercise_id, 0)
        seen[item.exercise_id] = occurrence + 1
        keyed.append(((item.exercise_id, occurrence), item))
    return keyed


def _partners(keyed: list[tuple[tuple[int, int], DiffExercise]]) -> dict:
    groups: dict[int, set] = {}
    for key, item in keyed:
        if item.superset_group is not None:
            groups.setdefault(item.superset_group, set()).add(key)
    return {
        key: frozenset(groups[item.superset_group]) if item.superset_group is not None
        else frozenset()
        for key, item in keyed
    }


def _exercise_changes(old: DiffExercise, new: DiffExercise) -> list[str]:
    changes = []
    for number, (a, b) in enumerate(zip(old.sets, new.sets, strict=False), start=1):
        if _norm(a) != _norm(b):
            changes.append(
                f"{new.name}: serie {number} {format_set(new.tracking, a)} → "
                f"{format_set(new.tracking, b)}"
            )
    extra = len(new.sets) - len(old.sets)
    if extra > 0:
        changes.append(f"{new.name}: +{extra} serie")
    elif extra < 0:
        changes.append(f"{new.name}: {extra} serie")
    if old.rest_seconds != new.rest_seconds:
        changes.append(
            f"{new.name}: riposo {format_duration(old.rest_seconds)} → "
            f"{format_duration(new.rest_seconds)}"
        )
    return changes


def template_diff(
    template: Sequence[DiffExercise], workout: Sequence[DiffExercise]
) -> list[str]:
    """Readable differences between a template and the workout done from it.

    Empty list = nothing to ask the user.
    """
    before = _keyed(template)
    after = _keyed(workout)
    before_map = dict(before)
    after_map = dict(after)
    changes: list[str] = []
    for key, item in after:
        old = before_map.get(key)
        if old is None:
            changes.append(f"Aggiunto: {item.name}")
        else:
            changes.extend(_exercise_changes(old, item))
    changes.extend(f"Rimosso: {item.name}" for key, item in before if key not in after_map)

    common = before_map.keys() & after_map.keys()
    order_before = [key for key, _ in before if key in common]
    order_after = [key for key, _ in after if key in common]
    partners_before = _partners(before)
    partners_after = _partners(after)
    groups_changed = any(
        partners_before[key] & common != partners_after[key] & common for key in common
    )
    if order_before != order_after or groups_changed:
        changes.append("Ordine o superserie modificati")
    return changes
```

- [ ] **Step 4: Run the rules tests**

Run: `.venv\Scripts\python -m pytest tests/test_gym_rules.py -v`
Expected: PASS (all tests).

- [ ] **Step 5: Write the failing catalog tests**

`api/tests/test_exercise_catalog.py`:

```python
"""The bundled exercise catalog. Only the last test needs Postgres."""

import sqlalchemy as sa

from app.models.exercise import EQUIPMENT, MUSCLES, Exercise
from app.services.exercise_catalog import load_catalog_rows, reduce_exercise, upsert_catalog

RAW = {
    "id": "Barbell_Squat",
    "name": " Barbell Squat ",
    "force": "push",
    "level": "beginner",
    "mechanic": "compound",
    "equipment": "barbell",
    "primaryMuscles": ["quadriceps"],
    "secondaryMuscles": ["calves", "glutes"],
    "instructions": ["Step one.", "  ", "Step two. "],
    "category": "strength",
    "images": ["Barbell_Squat/0.jpg"],
}


def test_reduce_exercise_drops_images_and_derives_tracking() -> None:
    assert reduce_exercise(RAW) == {
        "id": "Barbell_Squat",
        "name": "Barbell Squat",
        "equipment": "barbell",
        "primary_muscles": ["quadriceps"],
        "secondary_muscles": ["calves", "glutes"],
        "category": "strength",
        "instructions": ["Step one.", "Step two."],
        "tracking": "weight_reps",
    }


def test_bundled_catalog_is_complete_and_clean() -> None:
    rows = load_catalog_rows()
    assert len(rows) == 876
    assert len({row["id"] for row in rows}) == 876
    for row in rows:
        assert "images" not in row
        assert row["equipment"] is None or row["equipment"] in EQUIPMENT
        assert set(row["primary_muscles"]) <= set(MUSCLES)
        assert row["tracking"] in {"weight_reps", "reps", "duration"}


async def test_upsert_is_idempotent(db) -> None:
    await db.run_sync(lambda session: upsert_catalog(session.connection()))
    await db.run_sync(lambda session: upsert_catalog(session.connection()))
    count = await db.scalar(
        sa.select(sa.func.count())
        .select_from(Exercise)
        .where(Exercise.source == "catalog", Exercise.source_id.not_like("test-%"))
    )
    assert count == 876
```

- [ ] **Step 6: Implement `exercise_catalog.py`**

`api/app/services/exercise_catalog.py`:

```python
"""The bundled free-exercise-db catalog (see app/data/README.md).

`reduce_exercise` turns an upstream record into the stored shape (no images,
derived `tracking`); `upsert_catalog` loads app/data/exercises.json into the
`exercises` table. It is called by an Alembic data migration, so it takes a
sync connection and uses a lightweight table definition instead of the ORM
model (old migrations must not depend on later model changes).
"""

import json
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.services.gym_rules import derive_tracking

CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "exercises.json"

_exercises = sa.table(
    "exercises",
    sa.column("source", sa.String),
    sa.column("source_id", sa.String),
    sa.column("name", sa.String),
    sa.column("equipment", sa.String),
    sa.column("primary_muscles", postgresql.ARRAY(sa.String)),
    sa.column("secondary_muscles", postgresql.ARRAY(sa.String)),
    sa.column("category", sa.String),
    sa.column("instructions", postgresql.ARRAY(sa.Text)),
    sa.column(
        "tracking",
        postgresql.ENUM(
            "weight_reps", "reps", "duration", name="exercise_tracking", create_type=False
        ),
    ),
)


def reduce_exercise(raw: dict) -> dict:
    return {
        "id": raw["id"],
        "name": raw["name"].strip(),
        "equipment": raw.get("equipment"),
        "primary_muscles": list(raw.get("primaryMuscles") or []),
        "secondary_muscles": list(raw.get("secondaryMuscles") or []),
        "category": raw.get("category"),
        "instructions": [
            line.strip() for line in raw.get("instructions") or [] if line.strip()
        ],
        "tracking": derive_tracking(raw.get("category"), raw.get("equipment")).value,
    }


def load_catalog_rows() -> list[dict]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def upsert_catalog(connection: sa.Connection) -> int:
    """Insert or refresh every catalog exercise; never deletes. Returns the count."""
    rows = [
        {
            "source": "catalog",
            "source_id": row["id"],
            "name": row["name"],
            "equipment": row["equipment"],
            "primary_muscles": row["primary_muscles"],
            "secondary_muscles": row["secondary_muscles"],
            "category": row["category"],
            "instructions": row["instructions"],
            "tracking": row["tracking"],
        }
        for row in load_catalog_rows()
    ]
    stmt = postgresql.insert(_exercises)
    stmt = stmt.on_conflict_do_update(
        index_elements=["source", "source_id"],
        set_={
            column: stmt.excluded[column]
            for column in (
                "name", "equipment", "primary_muscles", "secondary_muscles", "category",
                "instructions", "tracking",
            )
        },
    )
    connection.execute(stmt, rows)
    return len(rows)
```

Note: the `tracking` column is declared as the existing Postgres enum (`create_type=False`) so the string values bind to `exercise_tracking` without a cast.

- [ ] **Step 7: Write the build script and generate the data file**

`api/scripts/build_exercises.py`:

```python
"""Rebuild app/data/exercises.json from yuhonas/free-exercise-db (Unlicense).

Run from api/:  .venv\\Scripts\\python scripts/build_exercises.py
Pinned to one upstream commit so the file is reproducible; bump COMMIT and
add a new data migration to ship catalog updates.
"""

import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.exercise_catalog import CATALOG_PATH, reduce_exercise  # noqa: E402

COMMIT = "a859101d633a01c4a1a920d6a8ce41dabba0705f"
SOURCE_URL = (
    f"https://raw.githubusercontent.com/yuhonas/free-exercise-db/{COMMIT}/dist/exercises.json"
)


def main() -> None:
    with urllib.request.urlopen(SOURCE_URL, timeout=60) as response:
        raw = json.load(response)
    reduced = sorted((reduce_exercise(item) for item in raw), key=lambda row: row["id"])
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(
        json.dumps(reduced, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"wrote {len(reduced)} exercises to {CATALOG_PATH}")


if __name__ == "__main__":
    main()
```

Run (from `api/`): `.venv\Scripts\python scripts/build_exercises.py`
Expected: `wrote 876 exercises to ...\app\data\exercises.json`.

`api/app/data/README.md`:

```markdown
# Exercise catalog

`exercises.json` is derived from [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db)
at commit `a859101d633a01c4a1a920d6a8ce41dabba0705f`, released under the
[Unlicense](https://github.com/yuhonas/free-exercise-db/blob/main/LICENSE) (public domain).

Changes from upstream: images, `force`, `level` and `mechanic` are dropped; names and
instructions are trimmed; `tracking` is added (`duration` for stretching/cardio,
`reps` for body-only, `weight_reps` otherwise).

Regenerate with `python scripts/build_exercises.py` (from `api/`). The data migration
`b81f5e3a6c42_gym_exercise_catalog` loads the file; ship a later update as a new
migration that calls `app.services.exercise_catalog.upsert_catalog` again.
```

- [ ] **Step 8: Write the data migration**

`api/alembic/versions/b81f5e3a6c42_gym_exercise_catalog.py`:

```python
"""Load the bundled exercise catalog (app/data/exercises.json).

Revision ID: b81f5e3a6c42
Revises: 9a4d2c7e1f03
"""

from collections.abc import Sequence

from alembic import op
from app.services.exercise_catalog import upsert_catalog

revision: str = "b81f5e3a6c42"
down_revision: str | Sequence[str] | None = "9a4d2c7e1f03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    upsert_catalog(op.get_bind())


def downgrade() -> None:
    # Catalog rows referenced by templates/history cannot be removed; only
    # drop the ones nothing uses.
    op.execute(
        "DELETE FROM exercises e WHERE e.source = 'catalog' "
        "AND NOT EXISTS (SELECT 1 FROM template_exercises t WHERE t.exercise_id = e.id) "
        "AND NOT EXISTS (SELECT 1 FROM workout_exercises w WHERE w.exercise_id = e.id)"
    )
```

- [ ] **Step 9: Run the DB-free tests and checks**

Run (from `api/`):
- `.venv\Scripts\python -m pytest tests/test_gym_rules.py tests/test_exercise_catalog.py -k "not upsert" -v` → PASS
- `.venv\Scripts\python -m ruff check app tests scripts`
- `.venv\Scripts\python -m pytest --collect-only -q`

`test_upsert_is_idempotent` needs Postgres: written, not run locally.

- [ ] **Step 10: Commit**

```bash
git add api/app/services/gym_rules.py api/app/services/exercise_catalog.py api/scripts/build_exercises.py api/app/data/exercises.json api/app/data/README.md api/alembic/versions/b81f5e3a6c42_gym_exercise_catalog.py api/tests/test_gym_rules.py api/tests/test_exercise_catalog.py
git commit -m "feat(api): gym rules and the bundled free-exercise-db catalog"
```

---
### Task 3: Esercizi — servizio, schemi e API

**Files:**
- Create: `api/app/schemas/exercise.py`
- Create: `api/app/services/exercises.py`
- Create: `api/app/routers/exercises.py`
- Modify: `api/app/main.py` (include router)
- Test: `api/tests/test_exercises_service.py` (DB), `api/tests/test_gym_routers.py` (DB; this task creates the file, later tasks append)

**Interfaces:**
- Consumes: `Exercise`, `Tracking`, `EQUIPMENT`, `MUSCLES` (Task 1); `make_exercise`, `GYM` (Task 1).
- Produces (`app.schemas.exercise`): `ExerciseOut{id, name, equipment, primary_muscles, secondary_muscles, category, tracking, custom}`, `ExerciseDetail(ExerciseOut){instructions}`, `ExerciseList{items, total}`, `ExerciseCreate{name, equipment, primary_muscle, tracking}`, `ExercisePatch` (same fields, all optional).
- Produces (`app.services.exercises`):
  - `visible_exercise_filter(user) -> ColumnElement[bool]`
  - `exercise_out(exercise: Exercise) -> ExerciseOut`
  - `async get_visible_exercises(db, user, ids: Iterable[int]) -> dict[int, Exercise]` (raises `NotFound("exercise not found")`)
  - `async search_exercises(db, user, *, q="", equipment=None, muscle=None, limit=50, offset=0) -> ExerciseList`
  - `async get_exercise(db, user, exercise_id) -> ExerciseDetail`
  - `async create_custom_exercise(db, user, payload: ExerciseCreate) -> ExerciseDetail`
  - `async update_custom_exercise(db, user, exercise_id, payload: ExercisePatch) -> ExerciseDetail`
  - `async archive_custom_exercise(db, user, exercise_id) -> None`
- REST: `GET /api/exercises?q=&equipment=&muscle=&limit=&offset=`, `GET /api/exercises/{id}`, `POST /api/exercises` (201), `PATCH /api/exercises/{id}`, `DELETE /api/exercises/{id}` (204).

- [ ] **Step 1: Write the failing service tests**

`api/tests/test_exercises_service.py`:

```python
"""Exercise search and custom exercises (needs Postgres)."""

import pytest

from app.models.exercise import Tracking
from app.schemas.exercise import ExerciseCreate, ExercisePatch
from app.services import exercises
from app.services.errors import NotFound, PermissionMissing
from tests.factories import GYM, make_exercise, make_user


async def test_search_by_name_equipment_and_muscle(db) -> None:
    user = await make_user(db, permissions=GYM)
    await make_exercise(db, name="Zzq Front Squat", equipment="barbell", muscle="quadriceps")
    await make_exercise(db, name="Zzq Goblet Squat", equipment="kettlebells", muscle="quadriceps")
    await make_exercise(db, name="Zzq Curl", equipment="dumbbell", muscle="biceps")

    by_name = await exercises.search_exercises(db, user, q="Zzq")
    assert {e.name for e in by_name.items} == {"Zzq Front Squat", "Zzq Goblet Squat", "Zzq Curl"}
    assert by_name.total == 3

    kettle = await exercises.search_exercises(db, user, q="Zzq", equipment="kettlebells")
    assert [e.name for e in kettle.items] == ["Zzq Goblet Squat"]
    biceps = await exercises.search_exercises(db, user, q="Zzq", muscle="biceps")
    assert [e.name for e in biceps.items] == ["Zzq Curl"]


async def test_custom_exercises_are_private_and_archivable(db) -> None:
    alice = await make_user(db, username="alice", permissions=GYM)
    bob = await make_user(db, username="bob", permissions=GYM)
    created = await exercises.create_custom_exercise(db, alice, ExerciseCreate(
        name="  Zzq Landmine Press ", equipment="barbell", primary_muscle="shoulders",
        tracking=Tracking.weight_reps,
    ))
    assert created.name == "Zzq Landmine Press"
    assert created.custom is True
    assert created.primary_muscles == ["shoulders"]

    assert [e.id for e in (await exercises.search_exercises(db, alice, q="Landmine")).items] == [
        created.id
    ]
    assert (await exercises.search_exercises(db, bob, q="Landmine")).items == []
    with pytest.raises(NotFound):
        await exercises.get_exercise(db, bob, created.id)

    renamed = await exercises.update_custom_exercise(
        db, alice, created.id, ExercisePatch(name="Zzq Landmine", tracking=Tracking.reps)
    )
    assert (renamed.name, renamed.tracking) == ("Zzq Landmine", Tracking.reps)

    await exercises.archive_custom_exercise(db, alice, created.id)
    assert (await exercises.search_exercises(db, alice, q="Landmine")).items == []
    # still readable (history and templates keep showing it)
    assert (await exercises.get_exercise(db, alice, created.id)).name == "Zzq Landmine"
    with pytest.raises(NotFound):
        await exercises.update_custom_exercise(db, alice, created.id, ExercisePatch(name="x"))


async def test_catalog_exercises_cannot_be_edited(db) -> None:
    user = await make_user(db, permissions=GYM)
    catalog = await make_exercise(db, name="Zzq Catalog")
    with pytest.raises(NotFound):
        await exercises.update_custom_exercise(db, user, catalog.id, ExercisePatch(name="x"))
    with pytest.raises(NotFound):
        await exercises.archive_custom_exercise(db, user, catalog.id)


async def test_get_visible_exercises_rejects_foreign_ids(db) -> None:
    alice = await make_user(db, username="alice", permissions=GYM)
    bob = await make_user(db, username="bob", permissions=GYM)
    mine = await make_exercise(db, name="Zzq Mine", owner=alice)
    catalog = await make_exercise(db, name="Zzq Shared")
    found = await exercises.get_visible_exercises(db, alice, [mine.id, catalog.id])
    assert set(found) == {mine.id, catalog.id}
    with pytest.raises(NotFound):
        await exercises.get_visible_exercises(db, bob, [mine.id])


async def test_requires_permission(db) -> None:
    user = await make_user(db, permissions=[])
    with pytest.raises(PermissionMissing):
        await exercises.search_exercises(db, user, q="Zzq")
```

`api/tests/test_gym_routers.py`:

```python
"""HTTP smoke tests for the gym routers (needs Postgres)."""

from tests.factories import GYM, http_client, make_exercise, make_user


async def test_exercises_api(db) -> None:
    user = await make_user(db, permissions=GYM)
    await make_exercise(db, name="Zzq Row")
    async with await http_client(db, user) as client:
        found = await client.get("/api/exercises", params={"q": "Zzq Row"})
        assert found.status_code == 200
        assert found.json()["items"][0]["name"] == "Zzq Row"

        created = await client.post("/api/exercises", json={
            "name": "Zzq Mine", "equipment": "cable", "primary_muscle": "lats",
            "tracking": "weight_reps",
        })
        assert created.status_code == 201
        exercise_id = created.json()["id"]
        assert (await client.get(f"/api/exercises/{exercise_id}")).json()["instructions"] == []
        patched = await client.patch(f"/api/exercises/{exercise_id}", json={"name": "Zzq Mine 2"})
        assert patched.json()["name"] == "Zzq Mine 2"
        assert (await client.delete(f"/api/exercises/{exercise_id}")).status_code == 204

        bad = await client.post("/api/exercises", json={"name": "x", "equipment": "spoon"})
        assert bad.status_code == 422


async def test_exercises_api_forbidden_without_permission(db) -> None:
    user = await make_user(db, permissions=[])
    async with await http_client(db, user) as client:
        response = await client.get("/api/exercises")
    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
```

- [ ] **Step 2: Verify the new modules fail to import**

Run: `.venv\Scripts\python -m pytest tests/test_exercises_service.py --collect-only -q`
Expected: ERROR `ModuleNotFoundError: No module named 'app.schemas.exercise'`.

- [ ] **Step 3: Write the schemas**

`api/app/schemas/exercise.py`:

```python
"""Pydantic schemas for the exercise catalog and custom exercises."""

from typing import Annotated

from pydantic import AfterValidator, BaseModel, StringConstraints

from app.models.exercise import EQUIPMENT, MUSCLES, Tracking

ExerciseName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


def _check_equipment(value: str | None) -> str | None:
    if value is not None and value not in EQUIPMENT:
        raise ValueError("unknown equipment")
    return value


def _check_muscle(value: str | None) -> str | None:
    if value is not None and value not in MUSCLES:
        raise ValueError("unknown muscle")
    return value


Equipment = Annotated[str | None, AfterValidator(_check_equipment)]
Muscle = Annotated[str | None, AfterValidator(_check_muscle)]


class ExerciseOut(BaseModel):
    id: int
    name: str
    equipment: str | None
    primary_muscles: list[str]
    secondary_muscles: list[str]
    category: str | None
    tracking: Tracking
    custom: bool


class ExerciseDetail(ExerciseOut):
    instructions: list[str]


class ExerciseList(BaseModel):
    items: list[ExerciseOut]
    total: int


class ExerciseCreate(BaseModel):
    name: ExerciseName
    equipment: Equipment = None
    primary_muscle: Muscle = None
    tracking: Tracking = Tracking.weight_reps


class ExercisePatch(BaseModel):
    """Only the fields sent are changed (`model_fields_set`)."""

    name: ExerciseName | None = None
    equipment: Equipment = None
    primary_muscle: Muscle = None
    tracking: Tracking | None = None
```

- [ ] **Step 4: Write the service**

`api/app/services/exercises.py`:

```python
"""Exercise catalog search and the user's custom exercises.

Shared by the REST router and the MCP tools. Catalog rows are visible to
everyone; custom rows only to their owner. Archived custom exercises are
hidden from search but still readable, because history and templates keep
referencing them.
"""

from collections.abc import Iterable
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.exercise import Exercise
from app.models.user import User
from app.permissions import Permission, ensure_permission
from app.schemas.exercise import (
    ExerciseCreate,
    ExerciseDetail,
    ExerciseList,
    ExerciseOut,
    ExercisePatch,
)
from app.services.errors import NotFound


def visible_exercise_filter(user: User) -> sa.ColumnElement[bool]:
    return sa.or_(Exercise.source == "catalog", Exercise.owner_user_id == user.id)


def exercise_out(exercise: Exercise) -> ExerciseOut:
    return ExerciseOut(
        id=exercise.id, name=exercise.name, equipment=exercise.equipment,
        primary_muscles=list(exercise.primary_muscles),
        secondary_muscles=list(exercise.secondary_muscles),
        category=exercise.category, tracking=exercise.tracking,
        custom=exercise.source == "custom",
    )


def _detail(exercise: Exercise) -> ExerciseDetail:
    return ExerciseDetail(
        **exercise_out(exercise).model_dump(), instructions=list(exercise.instructions)
    )


async def get_visible_exercises(
    db: AsyncSession, user: User, ids: Iterable[int]
) -> dict[int, Exercise]:
    wanted = set(ids)
    if not wanted:
        return {}
    found = {
        exercise.id: exercise
        for exercise in (
            await db.scalars(
                sa.select(Exercise).where(Exercise.id.in_(wanted), visible_exercise_filter(user))
            )
        ).all()
    }
    if wanted - found.keys():
        raise NotFound("exercise not found")
    return found


async def search_exercises(
    db: AsyncSession,
    user: User,
    *,
    q: str = "",
    equipment: str | None = None,
    muscle: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> ExerciseList:
    ensure_permission(user, Permission.workouts)
    conditions = [visible_exercise_filter(user), Exercise.archived_at.is_(None)]
    q = q.strip()
    if q:
        conditions.append(Exercise.name.ilike(f"%{q}%"))
    if equipment:
        conditions.append(Exercise.equipment == equipment)
    if muscle:
        conditions.append(Exercise.primary_muscles.any(muscle))
    total = await db.scalar(sa.select(sa.func.count()).select_from(Exercise).where(*conditions))
    order = (
        [sa.func.similarity(Exercise.name, q).desc(), Exercise.name]
        if q
        else [sa.func.lower(Exercise.name)]
    )
    rows = (
        await db.scalars(
            sa.select(Exercise).where(*conditions).order_by(*order).limit(limit).offset(offset)
        )
    ).all()
    return ExerciseList(items=[exercise_out(e) for e in rows], total=total or 0)


async def get_exercise(db: AsyncSession, user: User, exercise_id: int) -> ExerciseDetail:
    ensure_permission(user, Permission.workouts)
    return _detail((await get_visible_exercises(db, user, [exercise_id]))[exercise_id])


async def _own_custom(db: AsyncSession, user: User, exercise_id: int) -> Exercise:
    exercise = await db.scalar(
        sa.select(Exercise).where(
            Exercise.id == exercise_id,
            Exercise.owner_user_id == user.id,
            Exercise.archived_at.is_(None),
        )
    )
    if exercise is None:
        raise NotFound("exercise not found")
    return exercise


async def create_custom_exercise(
    db: AsyncSession, user: User, payload: ExerciseCreate
) -> ExerciseDetail:
    ensure_permission(user, Permission.workouts)
    exercise = Exercise(
        source="custom", source_id=None, owner_user_id=user.id, name=payload.name,
        equipment=payload.equipment,
        primary_muscles=[payload.primary_muscle] if payload.primary_muscle else [],
        secondary_muscles=[], category=None, instructions=[], tracking=payload.tracking,
    )
    db.add(exercise)
    await db.commit()
    return _detail(exercise)


async def update_custom_exercise(
    db: AsyncSession, user: User, exercise_id: int, payload: ExercisePatch
) -> ExerciseDetail:
    ensure_permission(user, Permission.workouts)
    exercise = await _own_custom(db, user, exercise_id)
    fields = payload.model_fields_set
    if "name" in fields and payload.name is not None:
        exercise.name = payload.name
    if "equipment" in fields:
        exercise.equipment = payload.equipment
    if "primary_muscle" in fields:
        exercise.primary_muscles = [payload.primary_muscle] if payload.primary_muscle else []
    if "tracking" in fields and payload.tracking is not None:
        exercise.tracking = payload.tracking
    await db.commit()
    return _detail(exercise)


async def archive_custom_exercise(db: AsyncSession, user: User, exercise_id: int) -> None:
    ensure_permission(user, Permission.workouts)
    exercise = await _own_custom(db, user, exercise_id)
    exercise.archived_at = datetime.now(UTC)
    await db.commit()
```

- [ ] **Step 5: Write the router and register it**

`api/app/routers/exercises.py`:

```python
"""Exercise catalog + custom exercises. Thin layer over app/services/exercises.py."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.user import User
from app.schemas.exercise import (
    ExerciseCreate,
    ExerciseDetail,
    ExerciseList,
    ExercisePatch,
)
from app.services import exercises

router = APIRouter(prefix="/api/exercises", tags=["exercises"])


@router.get("", response_model=ExerciseList)
async def search(
    q: str = "",
    equipment: str | None = None,
    muscle: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ExerciseList:
    return await exercises.search_exercises(
        session, user, q=q, equipment=equipment, muscle=muscle, limit=limit, offset=offset
    )


@router.get("/{exercise_id}", response_model=ExerciseDetail)
async def get_one(
    exercise_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ExerciseDetail:
    return await exercises.get_exercise(session, user, exercise_id)


@router.post("", response_model=ExerciseDetail, status_code=201)
async def create(
    payload: ExerciseCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ExerciseDetail:
    return await exercises.create_custom_exercise(session, user, payload)


@router.patch("/{exercise_id}", response_model=ExerciseDetail)
async def update(
    exercise_id: int,
    payload: ExercisePatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ExerciseDetail:
    return await exercises.update_custom_exercise(session, user, exercise_id, payload)


@router.delete("/{exercise_id}", status_code=204)
async def archive(
    exercise_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await exercises.archive_custom_exercise(session, user, exercise_id)
```

In `api/app/main.py` change the routers import to
`from app.routers import admin, auth, diary, exercises, foods, oauth` and add, after the `goals_router` include:

```python
app.include_router(exercises.router, dependencies=[Depends(get_current_user)])
```

- [ ] **Step 6: Run local checks**

Run (from `api/`): `.venv\Scripts\python -m ruff check app tests`, `.venv\Scripts\python -c "import app.main"`, `.venv\Scripts\python -m pytest --collect-only -q`.
Expected: clean; collection lists the new tests. The tests themselves need Postgres (not run locally).

- [ ] **Step 7: Commit**

```bash
git add api/app/schemas/exercise.py api/app/services/exercises.py api/app/routers/exercises.py api/app/main.py api/tests/test_exercises_service.py api/tests/test_gym_routers.py
git commit -m "feat(api): exercise search and custom exercises"
```

---

### Task 4: Modelli di allenamento e cartelle — servizio, schemi e API

**Files:**
- Create: `api/app/schemas/workout.py` (template part; Task 5 appends workout schemas)
- Create: `api/app/services/templates.py`
- Create: `api/app/routers/templates.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_templates_service.py` (DB), append to `api/tests/test_gym_routers.py` (DB)

**Interfaces:**
- Consumes: models (Task 1); `normalize_supersets`, `DEFAULT_REST_SECONDS` (Task 2); `exercise_out`, `get_visible_exercises` (Task 3).
- Produces (`app.schemas.workout`): `SetValues{weight_kg, reps, duration_s}`, `TemplateExerciseIn`, `TemplateIn`, `TemplateExerciseOut`, `TemplateOut`, `TemplateSummary`, `FolderIn`, `FolderOut`, `TemplatesResponse`, `TemplatePatch`, type alias `Name100`.
- Produces (`app.services.templates`):
  - `template_out(template: WorkoutTemplate) -> TemplateOut`
  - `async find_template(db, user, template_id) -> WorkoutTemplate | None` (exercises, their exercise and sets loaded; `populate_existing`)
  - `async own_template(db, user, template_id) -> WorkoutTemplate` (raises `NotFound("template not found")`)
  - `async own_folder(db, user, folder_id) -> TemplateFolder` (raises `NotFound("folder not found")`)
  - `async next_template_position(db, user, folder_id: int | None) -> int`
  - `async list_templates(db, user) -> TemplatesResponse`
  - `async create_folder(db, user, payload: FolderIn) -> FolderOut`, `rename_folder(db, user, folder_id, payload: FolderIn) -> FolderOut`, `delete_folder(db, user, folder_id) -> None`
  - `async create_template(db, user, payload: TemplateIn) -> TemplateOut`, `get_template(db, user, template_id) -> TemplateOut`, `replace_template(db, user, template_id, payload: TemplateIn) -> TemplateOut`, `patch_template(db, user, template_id, payload: TemplatePatch) -> TemplateOut`, `delete_template(db, user, template_id) -> None`, `duplicate_template(db, user, template_id) -> TemplateOut`
- REST: `GET /api/templates`, `POST /api/templates` (201), `GET|PUT|PATCH|DELETE /api/templates/{id}`, `POST /api/templates/{id}/duplicate` (201), `POST /api/template-folders` (201), `PATCH|DELETE /api/template-folders/{id}`.

- [ ] **Step 1: Write the failing service tests**

`api/tests/test_templates_service.py`:

```python
"""Templates and folders (needs Postgres)."""

import pytest

from app.schemas.workout import FolderIn, TemplateIn, TemplatePatch
from app.services import templates
from app.services.errors import NotFound
from tests.factories import GYM, make_exercise, make_user


def _payload(squat_id: int, curl_id: int, **overrides) -> TemplateIn:
    data = {
        "name": "Giorno 1",
        "exercises": [
            {"exercise_id": squat_id, "rest_seconds": 90, "superset_group": None,
             "sets": [{"weight_kg": 80, "reps": 8}, {"weight_kg": 80, "reps": 8}]},
            {"exercise_id": curl_id, "rest_seconds": 60, "superset_group": 5,
             "sets": [{"weight_kg": 12.5, "reps": 10}]},
        ],
    }
    data.update(overrides)
    return TemplateIn.model_validate(data)


async def test_create_get_and_list(db) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    curl = await make_exercise(db, name="Zzq Curl")
    folder = await templates.create_folder(db, user, FolderIn(name="Settimana 1"))

    created = await templates.create_template(
        db, user, _payload(squat.id, curl.id, folder_id=folder.id)
    )
    assert created.folder_id == folder.id
    assert [e.exercise.name for e in created.exercises] == ["Zzq Squat", "Zzq Curl"]
    assert created.exercises[0].sets[0].weight_kg == 80
    # a lone superset member is normalized away
    assert created.exercises[1].superset_group is None

    listing = await templates.list_templates(db, user)
    assert [f.name for f in listing.folders] == ["Settimana 1"]
    assert listing.templates[0].exercise_names == ["Zzq Squat", "Zzq Curl"]
    assert (await templates.get_template(db, user, created.id)).name == "Giorno 1"


async def test_replace_patch_duplicate_delete(db) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    curl = await make_exercise(db, name="Zzq Curl")
    created = await templates.create_template(db, user, _payload(squat.id, curl.id))

    replaced = await templates.replace_template(db, user, created.id, TemplateIn.model_validate({
        "name": "Giorno 1 V2",
        "exercises": [{"exercise_id": curl.id, "rest_seconds": 45,
                       "sets": [{"weight_kg": 14, "reps": 8}]}],
    }))
    assert replaced.name == "Giorno 1 V2"
    assert [(e.exercise.name, e.rest_seconds) for e in replaced.exercises] == [("Zzq Curl", 45)]

    folder = await templates.create_folder(db, user, FolderIn(name="Settimana 2"))
    moved = await templates.patch_template(
        db, user, created.id, TemplatePatch(folder_id=folder.id)
    )
    assert moved.folder_id == folder.id
    renamed = await templates.patch_template(db, user, created.id, TemplatePatch(name="G1"))
    assert (renamed.name, renamed.folder_id) == ("G1", folder.id)
    out = await templates.patch_template(db, user, created.id, TemplatePatch(folder_id=None))
    assert out.folder_id is None

    copy = await templates.duplicate_template(db, user, created.id)
    assert copy.name == "G1 Copia"
    assert copy.id != created.id
    assert [e.exercise.name for e in copy.exercises] == ["Zzq Curl"]

    await templates.delete_template(db, user, created.id)
    with pytest.raises(NotFound):
        await templates.get_template(db, user, created.id)


async def test_deleting_folder_keeps_templates(db) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    curl = await make_exercise(db, name="Zzq Curl")
    folder = await templates.create_folder(db, user, FolderIn(name="Vecchi"))
    created = await templates.create_template(
        db, user, _payload(squat.id, curl.id, folder_id=folder.id)
    )
    renamed = await templates.rename_folder(db, user, folder.id, FolderIn(name="Archivio"))
    assert renamed.name == "Archivio"
    await templates.delete_folder(db, user, folder.id)
    assert (await templates.get_template(db, user, created.id)).folder_id is None
    assert (await templates.list_templates(db, user)).folders == []


async def test_templates_are_private(db) -> None:
    alice = await make_user(db, username="alice", permissions=GYM)
    bob = await make_user(db, username="bob", permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    curl = await make_exercise(db, name="Zzq Curl")
    created = await templates.create_template(db, alice, _payload(squat.id, curl.id))
    folder = await templates.create_folder(db, alice, FolderIn(name="A"))
    with pytest.raises(NotFound):
        await templates.get_template(db, bob, created.id)
    with pytest.raises(NotFound):
        await templates.create_template(db, bob, _payload(squat.id, curl.id, folder_id=folder.id))
    assert (await templates.list_templates(db, bob)).templates == []
    bobs_custom = await make_exercise(db, name="Zzq Bob Only", owner=bob)
    with pytest.raises(NotFound):
        await templates.create_template(db, alice, _payload(squat.id, bobs_custom.id))
```

Append to `api/tests/test_gym_routers.py`:

```python
async def test_templates_api(db) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    async with await http_client(db, user) as client:
        folder = await client.post("/api/template-folders", json={"name": "Settimana 1"})
        assert folder.status_code == 201
        body = {
            "name": "Giorno 1", "folder_id": folder.json()["id"],
            "exercises": [{"exercise_id": squat.id, "sets": [{"weight_kg": 80, "reps": 8}]}],
        }
        created = await client.post("/api/templates", json=body)
        assert created.status_code == 201
        template_id = created.json()["id"]
        assert created.json()["exercises"][0]["rest_seconds"] == 90

        listing = (await client.get("/api/templates")).json()
        assert listing["templates"][0]["exercise_names"] == ["Zzq Squat"]

        body["name"] = "Giorno 1 V2"
        assert (await client.put(f"/api/templates/{template_id}", json=body)).json()["name"] == (
            "Giorno 1 V2"
        )
        copy = await client.post(f"/api/templates/{template_id}/duplicate")
        assert copy.status_code == 201
        patched = await client.patch(f"/api/templates/{template_id}", json={"folder_id": None})
        assert patched.json()["folder_id"] is None
        assert (await client.delete(f"/api/templates/{template_id}")).status_code == 204
        assert (await client.get(f"/api/templates/{template_id}")).status_code == 404
        renamed = await client.patch(
            f"/api/template-folders/{folder.json()['id']}", json={"name": "S1"}
        )
        assert renamed.json()["name"] == "S1"
        assert (
            await client.delete(f"/api/template-folders/{folder.json()['id']}")
        ).status_code == 204
```

- [ ] **Step 2: Verify the new modules fail to import**

Run: `.venv\Scripts\python -m pytest tests/test_templates_service.py --collect-only -q`
Expected: ERROR `ModuleNotFoundError: No module named 'app.schemas.workout'`.

- [ ] **Step 3: Write the template schemas**

`api/app/schemas/workout.py`:

```python
"""Pydantic schemas for templates, folders and workouts."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.exercise import ExerciseOut
from app.services.gym_rules import DEFAULT_REST_SECONDS

Name100 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
RestSeconds = Annotated[int, Field(ge=0, le=600)]
Note = Annotated[str | None, Field(max_length=500)]


class SetValues(BaseModel):
    """One set's numbers; which ones matter depends on the exercise's tracking."""

    model_config = ConfigDict(from_attributes=True)

    weight_kg: float | None = Field(default=None, ge=0, le=1000)
    reps: int | None = Field(default=None, ge=0, le=1000)
    duration_s: int | None = Field(default=None, ge=0, le=36000)


class TemplateExerciseIn(BaseModel):
    exercise_id: int
    rest_seconds: RestSeconds = DEFAULT_REST_SECONDS
    superset_group: int | None = None
    note: Note = None
    sets: list[SetValues] = Field(min_length=1, max_length=30)


class TemplateIn(BaseModel):
    """Body of `POST /api/templates` and `PUT /api/templates/{id}` (full replace)."""

    name: Name100
    folder_id: int | None = None
    exercises: list[TemplateExerciseIn] = Field(default_factory=list, max_length=40)


class TemplateExerciseOut(BaseModel):
    id: int
    exercise: ExerciseOut
    rest_seconds: int
    superset_group: int | None
    note: str | None
    sets: list[SetValues]


class TemplateOut(BaseModel):
    id: int
    name: str
    folder_id: int | None
    last_used_at: datetime | None
    exercises: list[TemplateExerciseOut]


class TemplateSummary(BaseModel):
    id: int
    name: str
    folder_id: int | None
    last_used_at: datetime | None
    exercise_names: list[str]


class FolderIn(BaseModel):
    name: Name100


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    position: int


class TemplatesResponse(BaseModel):
    folders: list[FolderOut]
    templates: list[TemplateSummary]


class TemplatePatch(BaseModel):
    """Rename and/or move to a folder. `folder_id: null` sent explicitly moves the
    template out of its folder; an omitted field is left unchanged."""

    name: Name100 | None = None
    folder_id: int | None = None
```

- [ ] **Step 4: Write the service**

`api/app/services/templates.py`:

```python
"""Workout templates and their folders.

A template is replaced as a whole on edit (`PUT`): the SPA edits a local
draft and saves once. Positions are 0-based and rewritten on every change.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import User
from app.models.workout import TemplateExercise, TemplateFolder, TemplateSet, WorkoutTemplate
from app.permissions import Permission, ensure_permission
from app.schemas.workout import (
    FolderIn,
    FolderOut,
    SetValues,
    TemplateExerciseIn,
    TemplateExerciseOut,
    TemplateIn,
    TemplateOut,
    TemplatePatch,
    TemplatesResponse,
    TemplateSummary,
)
from app.services.errors import NotFound
from app.services.exercises import exercise_out, get_visible_exercises
from app.services.gym_rules import normalize_supersets


def template_out(template: WorkoutTemplate) -> TemplateOut:
    return TemplateOut(
        id=template.id, name=template.name, folder_id=template.folder_id,
        last_used_at=template.last_used_at,
        exercises=[
            TemplateExerciseOut(
                id=item.id, exercise=exercise_out(item.exercise), rest_seconds=item.rest_seconds,
                superset_group=item.superset_group, note=item.note,
                sets=[SetValues.model_validate(s) for s in item.sets],
            )
            for item in template.exercises
        ],
    )


async def find_template(
    db: AsyncSession, user: User, template_id: int
) -> WorkoutTemplate | None:
    return await db.scalar(
        sa.select(WorkoutTemplate)
        .where(WorkoutTemplate.id == template_id, WorkoutTemplate.user_id == user.id)
        .options(
            selectinload(WorkoutTemplate.exercises).selectinload(TemplateExercise.exercise),
            selectinload(WorkoutTemplate.exercises).selectinload(TemplateExercise.sets),
        )
        .execution_options(populate_existing=True)
    )


async def own_template(db: AsyncSession, user: User, template_id: int) -> WorkoutTemplate:
    template = await find_template(db, user, template_id)
    if template is None:
        raise NotFound("template not found")
    return template


async def own_folder(db: AsyncSession, user: User, folder_id: int) -> TemplateFolder:
    folder = await db.scalar(
        sa.select(TemplateFolder).where(
            TemplateFolder.id == folder_id, TemplateFolder.user_id == user.id
        )
    )
    if folder is None:
        raise NotFound("folder not found")
    return folder


async def next_template_position(db: AsyncSession, user: User, folder_id: int | None) -> int:
    in_folder = (
        WorkoutTemplate.folder_id.is_(None)
        if folder_id is None
        else WorkoutTemplate.folder_id == folder_id
    )
    current = await db.scalar(
        sa.select(sa.func.max(WorkoutTemplate.position)).where(
            WorkoutTemplate.user_id == user.id, in_folder
        )
    )
    return 0 if current is None else current + 1


async def _build_exercises(
    db: AsyncSession, user: User, items: Sequence[TemplateExerciseIn]
) -> list[TemplateExercise]:
    exercises = await get_visible_exercises(db, user, {item.exercise_id for item in items})
    groups = normalize_supersets([item.superset_group for item in items])
    return [
        TemplateExercise(
            exercise_id=item.exercise_id, exercise=exercises[item.exercise_id], position=position,
            rest_seconds=item.rest_seconds, superset_group=groups[position], note=item.note,
            sets=[
                TemplateSet(
                    position=number, weight_kg=s.weight_kg, reps=s.reps, duration_s=s.duration_s
                )
                for number, s in enumerate(item.sets)
            ],
        )
        for position, item in enumerate(items)
    ]


async def list_templates(db: AsyncSession, user: User) -> TemplatesResponse:
    ensure_permission(user, Permission.workouts)
    folders = (
        await db.scalars(
            sa.select(TemplateFolder)
            .where(TemplateFolder.user_id == user.id)
            .order_by(TemplateFolder.position, TemplateFolder.id)
        )
    ).all()
    rows = (
        await db.scalars(
            sa.select(WorkoutTemplate)
            .where(WorkoutTemplate.user_id == user.id)
            .options(
                selectinload(WorkoutTemplate.exercises).selectinload(TemplateExercise.exercise)
            )
            .order_by(WorkoutTemplate.position, WorkoutTemplate.id)
        )
    ).all()
    return TemplatesResponse(
        folders=[FolderOut.model_validate(folder) for folder in folders],
        templates=[
            TemplateSummary(
                id=t.id, name=t.name, folder_id=t.folder_id, last_used_at=t.last_used_at,
                exercise_names=[item.exercise.name for item in t.exercises],
            )
            for t in rows
        ],
    )


async def create_folder(db: AsyncSession, user: User, payload: FolderIn) -> FolderOut:
    ensure_permission(user, Permission.workouts)
    current = await db.scalar(
        sa.select(sa.func.max(TemplateFolder.position)).where(TemplateFolder.user_id == user.id)
    )
    folder = TemplateFolder(
        user_id=user.id, name=payload.name, position=0 if current is None else current + 1
    )
    db.add(folder)
    await db.commit()
    return FolderOut.model_validate(folder)


async def rename_folder(
    db: AsyncSession, user: User, folder_id: int, payload: FolderIn
) -> FolderOut:
    ensure_permission(user, Permission.workouts)
    folder = await own_folder(db, user, folder_id)
    folder.name = payload.name
    await db.commit()
    return FolderOut.model_validate(folder)


async def delete_folder(db: AsyncSession, user: User, folder_id: int) -> None:
    """Delete a folder; its templates move out of it (they are not deleted)."""
    ensure_permission(user, Permission.workouts)
    folder = await own_folder(db, user, folder_id)
    await db.execute(
        sa.update(WorkoutTemplate)
        .where(WorkoutTemplate.folder_id == folder.id)
        .values(folder_id=None)
        .execution_options(synchronize_session="fetch")
    )
    await db.delete(folder)
    await db.commit()


async def create_template(db: AsyncSession, user: User, payload: TemplateIn) -> TemplateOut:
    ensure_permission(user, Permission.workouts)
    if payload.folder_id is not None:
        await own_folder(db, user, payload.folder_id)
    template = WorkoutTemplate(
        user_id=user.id, folder_id=payload.folder_id, name=payload.name,
        position=await next_template_position(db, user, payload.folder_id),
        exercises=await _build_exercises(db, user, payload.exercises),
    )
    db.add(template)
    await db.commit()
    return template_out(await own_template(db, user, template.id))


async def get_template(db: AsyncSession, user: User, template_id: int) -> TemplateOut:
    ensure_permission(user, Permission.workouts)
    return template_out(await own_template(db, user, template_id))


async def _move(
    db: AsyncSession, user: User, template: WorkoutTemplate, folder_id: int | None
) -> None:
    if folder_id == template.folder_id:
        return
    if folder_id is not None:
        await own_folder(db, user, folder_id)
    template.position = await next_template_position(db, user, folder_id)
    template.folder_id = folder_id


async def replace_template(
    db: AsyncSession, user: User, template_id: int, payload: TemplateIn
) -> TemplateOut:
    ensure_permission(user, Permission.workouts)
    template = await own_template(db, user, template_id)
    await _move(db, user, template, payload.folder_id)
    template.name = payload.name
    template.exercises = await _build_exercises(db, user, payload.exercises)
    await db.commit()
    return template_out(await own_template(db, user, template.id))


async def patch_template(
    db: AsyncSession, user: User, template_id: int, payload: TemplatePatch
) -> TemplateOut:
    ensure_permission(user, Permission.workouts)
    template = await own_template(db, user, template_id)
    if "name" in payload.model_fields_set and payload.name is not None:
        template.name = payload.name
    if "folder_id" in payload.model_fields_set:
        await _move(db, user, template, payload.folder_id)
    await db.commit()
    return template_out(await own_template(db, user, template.id))


async def delete_template(db: AsyncSession, user: User, template_id: int) -> None:
    ensure_permission(user, Permission.workouts)
    await db.delete(await own_template(db, user, template_id))
    await db.commit()


async def duplicate_template(db: AsyncSession, user: User, template_id: int) -> TemplateOut:
    ensure_permission(user, Permission.workouts)
    source = await own_template(db, user, template_id)
    copy = WorkoutTemplate(
        user_id=user.id, folder_id=source.folder_id, name=f"{source.name} Copia"[:100],
        position=await next_template_position(db, user, source.folder_id),
        exercises=[
            TemplateExercise(
                exercise_id=item.exercise_id, exercise=item.exercise, position=item.position,
                rest_seconds=item.rest_seconds, superset_group=item.superset_group,
                note=item.note,
                sets=[
                    TemplateSet(
                        position=s.position, weight_kg=s.weight_kg, reps=s.reps,
                        duration_s=s.duration_s,
                    )
                    for s in item.sets
                ],
            )
            for item in source.exercises
        ],
    )
    db.add(copy)
    await db.commit()
    return template_out(await own_template(db, user, copy.id))
```

- [ ] **Step 5: Write the router and register it**

`api/app/routers/templates.py`:

```python
"""Workout templates and folders. Thin layer over app/services/templates.py."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.user import User
from app.schemas.workout import (
    FolderIn,
    FolderOut,
    TemplateIn,
    TemplateOut,
    TemplatePatch,
    TemplatesResponse,
)
from app.services import templates

router = APIRouter(prefix="/api", tags=["templates"])


@router.get("/templates", response_model=TemplatesResponse)
async def list_all(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
) -> TemplatesResponse:
    return await templates.list_templates(session, user)


@router.post("/templates", response_model=TemplateOut, status_code=201)
async def create(
    payload: TemplateIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await templates.create_template(session, user, payload)


@router.get("/templates/{template_id}", response_model=TemplateOut)
async def get_one(
    template_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await templates.get_template(session, user, template_id)


@router.put("/templates/{template_id}", response_model=TemplateOut)
async def replace(
    template_id: int,
    payload: TemplateIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await templates.replace_template(session, user, template_id, payload)


@router.patch("/templates/{template_id}", response_model=TemplateOut)
async def patch(
    template_id: int,
    payload: TemplatePatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await templates.patch_template(session, user, template_id, payload)


@router.delete("/templates/{template_id}", status_code=204)
async def delete(
    template_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await templates.delete_template(session, user, template_id)


@router.post("/templates/{template_id}/duplicate", response_model=TemplateOut, status_code=201)
async def duplicate(
    template_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await templates.duplicate_template(session, user, template_id)


@router.post("/template-folders", response_model=FolderOut, status_code=201)
async def create_folder(
    payload: FolderIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FolderOut:
    return await templates.create_folder(session, user, payload)


@router.patch("/template-folders/{folder_id}", response_model=FolderOut)
async def rename_folder(
    folder_id: int,
    payload: FolderIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FolderOut:
    return await templates.rename_folder(session, user, folder_id, payload)


@router.delete("/template-folders/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await templates.delete_folder(session, user, folder_id)
```

In `api/app/main.py`: import `templates` in the routers import line
(`from app.routers import admin, auth, diary, exercises, foods, oauth, templates`) and add
`app.include_router(templates.router, dependencies=[Depends(get_current_user)])` after the exercises router.

- [ ] **Step 6: Run local checks**

Run (from `api/`): `.venv\Scripts\python -m ruff check app tests`, `.venv\Scripts\python -c "import app.main"`, `.venv\Scripts\python -m pytest --collect-only -q`.
Expected: clean. DB tests: written, not run locally.

- [ ] **Step 7: Commit**

```bash
git add api/app/schemas/workout.py api/app/services/templates.py api/app/routers/templates.py api/app/main.py api/tests/test_templates_service.py api/tests/test_gym_routers.py
git commit -m "feat(api): workout templates and folders"
```

---
### Task 5: Sessione live — avvio, modifiche, "precedente", spunta e timer

**Files:**
- Modify: `api/app/schemas/workout.py` (append workout schemas)
- Create: `api/app/services/workouts.py`
- Create: `api/app/routers/workouts.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_workouts_live.py` (DB), append to `api/tests/test_gym_routers.py` (DB)

**Interfaces:**
- Consumes: models (Task 1); `gym_rules` (Task 2); `exercise_out`, `get_visible_exercises` (Task 3); `own_template`, `find_template` (Task 4); `SetValues`, `Name100`, `RestSeconds`, `Note` (Task 4).
- Produces (`app.schemas.workout`): `WorkoutSetOut`, `WorkoutExerciseOut`, `WorkoutOut`, `WorkoutStart`, `WorkoutRename`, `WorkoutExerciseAdd`, `WorkoutExercisePatch`, `LayoutItem`, `LayoutIn`, `SetPatch`, `RestIn`, `FinishIn`, `SaveAsTemplateIn`, `HistoryExercise`, `HistoryItem`, `HistoryPage`.
- Produces (`app.services.workouts`), each returning the full `WorkoutOut` unless noted:
  - `now() -> datetime` (UTC; tests monkeypatch `app.services.workouts.now`)
  - `async load_workout(db, user, workout_id) -> Workout` (raises `NotFound("workout not found")`)
  - `async workout_out(db, user, workout: Workout) -> WorkoutOut`
  - `async previous_sets(db, user, exercise_ids) -> dict[int, Previous]` with `Previous(rest_seconds: int, sets: list[SetValues])`
  - `async get_active(db, user) -> WorkoutOut | None`, `start_workout(db, user, payload: WorkoutStart)`, `rename_workout(db, user, workout_id, payload: WorkoutRename)`
  - `add_exercise(db, user, workout_id, payload: WorkoutExerciseAdd)`, `patch_exercise(db, user, workout_id, item_id, payload: WorkoutExercisePatch)`, `remove_exercise(db, user, workout_id, item_id)`, `set_layout(db, user, workout_id, payload: LayoutIn)`
  - `add_set(db, user, workout_id, item_id)`, `patch_set(db, user, workout_id, set_id, payload: SetPatch)`, `delete_set(db, user, workout_id, set_id)`, `complete_set(db, user, workout_id, set_id, payload: SetPatch)`, `uncomplete_set(db, user, workout_id, set_id)`, `rest(db, user, workout_id, payload: RestIn)`
  - `get_workout(db, user, workout_id)`
- `Invalid` messages: `"a workout is already in progress"`, `"workout is not in progress"`, `"layout must list every exercise once"`, `"no rest timer running"`, plus `set_problem` messages.
- REST (all return `WorkoutOut`): `GET /api/workouts/active` (204 when none), `POST /api/workouts` (201), `GET|PATCH /api/workouts/{id}`, `POST /api/workouts/{id}/exercises`, `PATCH|DELETE /api/workouts/{id}/exercises/{item_id}`, `PUT /api/workouts/{id}/layout`, `POST /api/workouts/{id}/exercises/{item_id}/sets`, `PATCH|DELETE /api/workouts/{id}/sets/{set_id}`, `POST /api/workouts/{id}/sets/{set_id}/complete`, `POST /api/workouts/{id}/sets/{set_id}/uncomplete`, `POST /api/workouts/{id}/rest`.

- [ ] **Step 1: Write the failing live-session tests**

`api/tests/test_workouts_live.py`:

```python
"""The live workout session (needs Postgres)."""

from datetime import UTC, datetime, timedelta

import pytest

from app.models.exercise import Tracking
from app.models.workout import Workout, WorkoutExercise, WorkoutSet, WorkoutStatus
from app.schemas.workout import (
    LayoutIn,
    RestIn,
    SetPatch,
    TemplateIn,
    WorkoutExerciseAdd,
    WorkoutExercisePatch,
    WorkoutStart,
)
from app.services import templates, workouts
from app.services.errors import Invalid, NotFound
from tests.factories import GYM, make_exercise, make_user

T0 = datetime(2026, 9, 24, 18, 0, tzinfo=UTC)


@pytest.fixture
def clock(monkeypatch):
    """Freeze `workouts.now()`; `clock.advance(seconds)` moves it forward."""

    class Clock:
        current = T0

        def advance(self, seconds: int) -> None:
            self.current += timedelta(seconds=seconds)

    c = Clock()
    monkeypatch.setattr(workouts, "now", lambda: c.current)
    return c


async def _template(db, user, *items):
    return await templates.create_template(db, user, TemplateIn.model_validate({
        "name": "Giorno 1", "exercises": list(items),
    }))


async def test_start_from_template_copies_values(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    template = await _template(db, user, {
        "exercise_id": squat.id, "rest_seconds": 90,
        "sets": [{"weight_kg": 80, "reps": 8}, {"weight_kg": 80, "reps": 8}],
    })
    workout = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))
    assert workout.status is WorkoutStatus.in_progress
    assert workout.name == "Giorno 1"
    assert workout.template_id == template.id
    assert workout.started_at == T0
    assert workout.server_now == T0
    [item] = workout.exercises
    assert [(s.weight_kg, s.reps, s.completed_at) for s in item.sets] == [
        (80, 8, None), (80, 8, None)
    ]
    assert item.sets[0].previous is None
    assert (await templates.get_template(db, user, template.id)).last_used_at == T0

    active = await workouts.get_active(db, user)
    assert active is not None and active.id == workout.id
    with pytest.raises(Invalid, match="already in progress"):
        await workouts.start_workout(db, user, WorkoutStart())


async def test_empty_workout_and_previous_values(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    # an earlier finished workout: 2 sets of squat with 120 s rest
    db.add(Workout(
        user_id=user.id, name="Old", status=WorkoutStatus.finished,
        started_at=T0 - timedelta(days=2), finished_at=T0 - timedelta(days=2, minutes=-50),
        exercises=[WorkoutExercise(
            exercise_id=squat.id, position=0, rest_seconds=120,
            sets=[WorkoutSet(position=0, weight_kg=70, reps=10, completed_at=T0),
                  WorkoutSet(position=1, weight_kg=75, reps=8, completed_at=T0)],
        )],
    ))
    await db.flush()

    workout = await workouts.start_workout(db, user, WorkoutStart())
    assert workout.name.startswith("Allenamento")
    assert workout.template_id is None

    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    [item] = workout.exercises
    # prefilled from the last time, with that rest
    assert item.rest_seconds == 120
    assert [(s.weight_kg, s.reps) for s in item.sets] == [(70, 10), (75, 8)]
    assert [(s.previous.weight_kg, s.previous.reps) for s in item.sets] == [(70, 10), (75, 8)]

    workout = await workouts.add_set(db, user, workout.id, item.id)
    third = workout.exercises[0].sets[2]
    assert (third.weight_kg, third.reps, third.previous) == (75, 8, None)


async def test_edit_sets_and_exercises(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    curl = await make_exercise(db, name="Zzq Curl")
    plank = await make_exercise(db, name="Zzq Plank", tracking=Tracking.duration)
    workout = await workouts.start_workout(db, user, WorkoutStart())
    for exercise in (squat, curl, plank):
        workout = await workouts.add_exercise(
            db, user, workout.id, WorkoutExerciseAdd(exercise_id=exercise.id)
        )
    squat_item, curl_item, plank_item = workout.exercises

    first = squat_item.sets[0].id
    workout = await workouts.patch_set(
        db, user, workout.id, first, SetPatch(weight_kg=82.5, reps=5)
    )
    assert (workout.exercises[0].sets[0].weight_kg, workout.exercises[0].sets[0].reps) == (82.5, 5)
    workout = await workouts.patch_set(db, user, workout.id, first, SetPatch(weight_kg=None))
    assert workout.exercises[0].sets[0].weight_kg is None
    assert workout.exercises[0].sets[0].reps == 5  # untouched: not sent

    workout = await workouts.patch_exercise(db, user, workout.id, curl_item.id,
                                            WorkoutExercisePatch(rest_seconds=45, note="lento"))
    assert (workout.exercises[1].rest_seconds, workout.exercises[1].note) == (45, "lento")
    workout = await workouts.patch_exercise(db, user, workout.id, curl_item.id,
                                            WorkoutExercisePatch(exercise_id=squat.id))
    assert workout.exercises[1].exercise.name == "Zzq Squat"

    workout = await workouts.set_layout(db, user, workout.id, LayoutIn.model_validate({"items": [
        {"id": plank_item.id, "superset_group": None},
        {"id": squat_item.id, "superset_group": 1},
        {"id": curl_item.id, "superset_group": 1},
    ]}))
    assert [e.id for e in workout.exercises] == [plank_item.id, squat_item.id, curl_item.id]
    assert [e.superset_group for e in workout.exercises] == [None, 1, 1]
    with pytest.raises(Invalid, match="every exercise once"):
        await workouts.set_layout(db, user, workout.id, LayoutIn.model_validate(
            {"items": [{"id": plank_item.id, "superset_group": None}]}))

    workout = await workouts.remove_exercise(db, user, workout.id, curl_item.id)
    assert [e.id for e in workout.exercises] == [plank_item.id, squat_item.id]
    assert [e.superset_group for e in workout.exercises] == [None, None]

    workout = await workouts.delete_set(db, user, workout.id, first)
    assert workout.exercises[1].sets == []
    with pytest.raises(NotFound):
        await workouts.delete_set(db, user, workout.id, first)


async def test_complete_set_validates_and_starts_rest(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    item = workout.exercises[0]
    set_id = item.sets[0].id

    with pytest.raises(Invalid, match="weight and reps are required"):
        await workouts.complete_set(db, user, workout.id, set_id, SetPatch())

    # values sent with the tick are saved first
    workout = await workouts.complete_set(
        db, user, workout.id, set_id, SetPatch(weight_kg=80, reps=8)
    )
    done = workout.exercises[0].sets[0]
    assert (done.weight_kg, done.reps, done.completed_at) == (80, 8, T0)
    assert workout.rest_ends_at == T0 + timedelta(seconds=90)
    assert workout.rest_total_s == 90

    clock.advance(30)
    workout = await workouts.rest(db, user, workout.id, RestIn(delta_s=15))
    assert workout.rest_ends_at == T0 + timedelta(seconds=105)
    assert workout.rest_total_s == 105
    workout = await workouts.rest(db, user, workout.id, RestIn(delta_s=-600))
    assert workout.rest_ends_at is None
    with pytest.raises(Invalid, match="no rest timer running"):
        await workouts.rest(db, user, workout.id, RestIn(delta_s=15))
    workout = await workouts.rest(db, user, workout.id, RestIn(start_s=60))
    assert workout.rest_ends_at == T0 + timedelta(seconds=90)
    workout = await workouts.rest(db, user, workout.id, RestIn(skip=True))
    assert (workout.rest_ends_at, workout.rest_total_s) == (None, None)

    workout = await workouts.uncomplete_set(db, user, workout.id, set_id)
    assert workout.exercises[0].sets[0].completed_at is None


async def test_superset_rest_starts_after_the_round(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    a = await make_exercise(db, name="Zzq A")
    b = await make_exercise(db, name="Zzq B")
    template = await _template(
        db, user,
        {"exercise_id": a.id, "rest_seconds": 30, "superset_group": 1,
         "sets": [{"weight_kg": 10, "reps": 10}]},
        {"exercise_id": b.id, "rest_seconds": 120, "superset_group": 1,
         "sets": [{"weight_kg": 20, "reps": 10}]},
    )
    workout = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))
    a_set = workout.exercises[0].sets[0].id
    b_set = workout.exercises[1].sets[0].id
    workout = await workouts.complete_set(db, user, workout.id, a_set, SetPatch())
    assert workout.rest_ends_at is None
    workout = await workouts.complete_set(db, user, workout.id, b_set, SetPatch())
    assert workout.rest_ends_at == T0 + timedelta(seconds=120)


async def test_zero_rest_starts_no_timer(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    template = await _template(db, user, {
        "exercise_id": squat.id, "rest_seconds": 0, "sets": [{"weight_kg": 80, "reps": 8}],
    })
    workout = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))
    workout = await workouts.complete_set(
        db, user, workout.id, workout.exercises[0].sets[0].id, SetPatch()
    )
    assert workout.rest_ends_at is None


async def test_workouts_are_private(db, clock) -> None:
    alice = await make_user(db, username="alice", permissions=GYM)
    bob = await make_user(db, username="bob", permissions=GYM)
    workout = await workouts.start_workout(db, alice, WorkoutStart())
    with pytest.raises(NotFound):
        await workouts.get_workout(db, bob, workout.id)
    with pytest.raises(NotFound):
        await workouts.rest(db, bob, workout.id, RestIn(skip=True))
    assert await workouts.get_active(db, bob) is None
```

Append to `api/tests/test_gym_routers.py`:

```python
async def test_live_workout_api(db) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    async with await http_client(db, user) as client:
        assert (await client.get("/api/workouts/active")).status_code == 204
        started = await client.post("/api/workouts", json={})
        assert started.status_code == 201
        workout_id = started.json()["id"]
        assert (await client.get("/api/workouts/active")).json()["id"] == workout_id

        body = (await client.post(
            f"/api/workouts/{workout_id}/exercises", json={"exercise_id": squat.id}
        )).json()
        item_id = body["exercises"][0]["id"]
        set_id = body["exercises"][0]["sets"][0]["id"]
        added = await client.post(f"/api/workouts/{workout_id}/exercises/{item_id}/sets")
        assert len(added.json()["exercises"][0]["sets"]) == 2

        done = await client.post(
            f"/api/workouts/{workout_id}/sets/{set_id}/complete",
            json={"weight_kg": 80, "reps": 8},
        )
        assert done.status_code == 200
        assert done.json()["exercises"][0]["sets"][0]["completed_at"] is not None
        assert done.json()["rest_ends_at"] is not None
        skipped = await client.post(f"/api/workouts/{workout_id}/rest", json={"skip": True})
        assert skipped.json()["rest_ends_at"] is None
        bad = await client.post(f"/api/workouts/{workout_id}/rest", json={})
        assert bad.status_code == 422
        renamed = await client.patch(f"/api/workouts/{workout_id}", json={"name": "Gambe"})
        assert renamed.json()["name"] == "Gambe"
        layout = await client.put(
            f"/api/workouts/{workout_id}/layout",
            json={"items": [{"id": item_id, "superset_group": None}]},
        )
        assert layout.status_code == 200
```

- [ ] **Step 2: Verify the tests fail to import**

Run: `.venv\Scripts\python -m pytest tests/test_workouts_live.py --collect-only -q`
Expected: ERROR `ImportError: cannot import name 'LayoutIn'`.

- [ ] **Step 3: Append the workout schemas**

Append to `api/app/schemas/workout.py` (add `model_validator` to the pydantic import and `from app.models.workout import WorkoutStatus` to the imports):

```python
class WorkoutSetOut(SetValues):
    id: int
    completed_at: datetime | None
    # Same position in the last finished workout with this exercise.
    previous: SetValues | None


class WorkoutExerciseOut(BaseModel):
    id: int
    exercise: ExerciseOut
    rest_seconds: int
    superset_group: int | None
    note: str | None
    sets: list[WorkoutSetOut]


class WorkoutOut(BaseModel):
    id: int
    name: str
    template_id: int | None
    status: WorkoutStatus
    started_at: datetime
    finished_at: datetime | None
    rest_ends_at: datetime | None
    rest_total_s: int | None
    # Server clock at response time: the SPA derives its clock offset from it,
    # so the rest countdown is right even if the phone's clock drifts.
    server_now: datetime
    exercises: list[WorkoutExerciseOut]
    # Finished workouts made from a template: readable differences from it.
    template_diff: list[str] = Field(default_factory=list)


class WorkoutStart(BaseModel):
    template_id: int | None = None


class WorkoutRename(BaseModel):
    name: Name100


class WorkoutExerciseAdd(BaseModel):
    exercise_id: int


class WorkoutExercisePatch(BaseModel):
    """Only the fields sent are changed. `exercise_id` replaces the exercise."""

    exercise_id: int | None = None
    rest_seconds: RestSeconds | None = None
    note: Note = None


class LayoutItem(BaseModel):
    id: int
    superset_group: int | None = None


class LayoutIn(BaseModel):
    """Order and superset grouping of every exercise of the workout."""

    items: list[LayoutItem]


class SetPatch(SetValues):
    """Only the fields sent are changed (`null` clears a value)."""


class RestIn(BaseModel):
    """Exactly one of: start a timer, move the running one, or skip it."""

    start_s: int | None = Field(default=None, ge=1, le=600)
    delta_s: int | None = Field(default=None, ge=-600, le=600)
    skip: bool = False

    @model_validator(mode="after")
    def _one_action(self) -> "RestIn":
        chosen = [self.start_s is not None, self.delta_s is not None, self.skip]
        if sum(chosen) != 1:
            raise ValueError("send exactly one of start_s, delta_s, skip")
        return self


class FinishIn(BaseModel):
    discard_incomplete: bool = False


class SaveAsTemplateIn(BaseModel):
    name: Name100
    folder_id: int | None = None


class HistoryExercise(BaseModel):
    name: str
    sets: int


class HistoryItem(BaseModel):
    id: int
    name: str
    started_at: datetime
    finished_at: datetime
    exercises: list[HistoryExercise]


class HistoryPage(BaseModel):
    items: list[HistoryItem]
    # Pass as `before` to get the next page; null on the last page.
    next_before: datetime | None
```

- [ ] **Step 4: Write the service (live part)**

`api/app/services/workouts.py`:

```python
"""The live workout session, its rest timer, finishing and history.

Every live edit loads the whole in-progress workout, changes it in memory,
commits, and answers with the full `WorkoutOut`, so the SPA can replace its
cached copy with the response. Positions are 0-based and rewritten after
every insert/delete; superset groups are renormalized after every change.
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.user import User
from app.models.workout import Workout, WorkoutExercise, WorkoutSet, WorkoutStatus
from app.permissions import Permission, ensure_permission
from app.schemas.workout import (
    LayoutIn,
    RestIn,
    SetPatch,
    SetValues,
    WorkoutExerciseAdd,
    WorkoutExerciseOut,
    WorkoutExercisePatch,
    WorkoutOut,
    WorkoutRename,
    WorkoutSetOut,
    WorkoutStart,
)
from app.services.errors import Invalid, NotFound
from app.services.exercises import exercise_out, get_visible_exercises
from app.services.gym_rules import (
    DEFAULT_REST_SECONDS,
    DiffExercise,
    ExerciseProgress,
    normalize_supersets,
    rest_after_completion,
    set_problem,
    template_diff,
)
from app.services.templates import find_template, own_template

SET_FIELDS = ("weight_kg", "reps", "duration_s")


def now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Previous:
    rest_seconds: int
    sets: list[SetValues] = field(default_factory=list)


async def load_workout(db: AsyncSession, user: User, workout_id: int) -> Workout:
    ensure_permission(user, Permission.workouts)
    workout = await db.scalar(
        sa.select(Workout)
        .where(Workout.id == workout_id, Workout.user_id == user.id)
        .options(
            selectinload(Workout.exercises).selectinload(WorkoutExercise.exercise),
            selectinload(Workout.exercises).selectinload(WorkoutExercise.sets),
        )
        .execution_options(populate_existing=True)
    )
    if workout is None:
        raise NotFound("workout not found")
    return workout


async def _load_live(db: AsyncSession, user: User, workout_id: int) -> Workout:
    workout = await load_workout(db, user, workout_id)
    if workout.status is not WorkoutStatus.in_progress:
        raise Invalid("workout is not in progress")
    return workout


def _item(workout: Workout, item_id: int) -> WorkoutExercise:
    for item in workout.exercises:
        if item.id == item_id:
            return item
    raise NotFound("exercise not found")


def _set(workout: Workout, set_id: int) -> tuple[WorkoutExercise, WorkoutSet]:
    for item in workout.exercises:
        for workout_set in item.sets:
            if workout_set.id == set_id:
                return item, workout_set
    raise NotFound("set not found")


def _renumber(workout: Workout) -> None:
    groups = normalize_supersets([item.superset_group for item in workout.exercises])
    for position, (item, group) in enumerate(zip(workout.exercises, groups, strict=True)):
        item.position = position
        item.superset_group = group
        for number, workout_set in enumerate(item.sets):
            workout_set.position = number


async def previous_sets(
    db: AsyncSession, user: User, exercise_ids: Iterable[int]
) -> dict[int, Previous]:
    """Rest and completed sets of each exercise's last finished appearance."""
    ids = set(exercise_ids)
    if not ids:
        return {}
    latest = (
        await db.execute(
            sa.select(
                WorkoutExercise.exercise_id, WorkoutExercise.id, WorkoutExercise.rest_seconds
            )
            .join(Workout, Workout.id == WorkoutExercise.workout_id)
            .where(
                Workout.user_id == user.id,
                Workout.status == WorkoutStatus.finished,
                WorkoutExercise.exercise_id.in_(ids),
            )
            .distinct(WorkoutExercise.exercise_id)
            .order_by(
                WorkoutExercise.exercise_id, Workout.finished_at.desc(), WorkoutExercise.position
            )
        )
    ).all()
    if not latest:
        return {}
    exercise_of = {item_id: exercise_id for exercise_id, item_id, _ in latest}
    result = {exercise_id: Previous(rest_seconds=rest) for exercise_id, _, rest in latest}
    rows = await db.scalars(
        sa.select(WorkoutSet)
        .where(
            WorkoutSet.workout_exercise_id.in_(exercise_of),
            WorkoutSet.completed_at.is_not(None),
        )
        .order_by(WorkoutSet.workout_exercise_id, WorkoutSet.position)
    )
    for workout_set in rows:
        result[exercise_of[workout_set.workout_exercise_id]].sets.append(
            SetValues.model_validate(workout_set)
        )
    return result


def _previous_at(previous: Previous | None, index: int) -> SetValues | None:
    if previous is None or index >= len(previous.sets):
        return None
    return previous.sets[index]


def _diff_item(item) -> DiffExercise:
    return DiffExercise(
        exercise_id=item.exercise_id, name=item.exercise.name, tracking=item.exercise.tracking,
        rest_seconds=item.rest_seconds, superset_group=item.superset_group,
        sets=tuple((s.weight_kg, s.reps, s.duration_s) for s in item.sets),
    )


async def _template_diff(db: AsyncSession, user: User, workout: Workout) -> list[str]:
    if workout.template_id is None:
        return []
    template = await find_template(db, user, workout.template_id)
    if template is None:
        return []
    return template_diff(
        [_diff_item(item) for item in template.exercises],
        [_diff_item(item) for item in workout.exercises],
    )


async def workout_out(db: AsyncSession, user: User, workout: Workout) -> WorkoutOut:
    previous: dict[int, Previous] = {}
    diff: list[str] = []
    if workout.status is WorkoutStatus.in_progress:
        previous = await previous_sets(db, user, {item.exercise_id for item in workout.exercises})
    else:
        diff = await _template_diff(db, user, workout)
    return WorkoutOut(
        id=workout.id, name=workout.name, template_id=workout.template_id,
        status=workout.status, started_at=workout.started_at,
        finished_at=workout.finished_at, rest_ends_at=workout.rest_ends_at,
        rest_total_s=workout.rest_total_s, server_now=now(),
        exercises=[
            WorkoutExerciseOut(
                id=item.id, exercise=exercise_out(item.exercise), rest_seconds=item.rest_seconds,
                superset_group=item.superset_group, note=item.note,
                sets=[
                    WorkoutSetOut(
                        id=s.id, weight_kg=s.weight_kg, reps=s.reps, duration_s=s.duration_s,
                        completed_at=s.completed_at,
                        previous=_previous_at(previous.get(item.exercise_id), number),
                    )
                    for number, s in enumerate(item.sets)
                ],
            )
            for item in workout.exercises
        ],
        template_diff=diff,
    )


async def _save(db: AsyncSession, user: User, workout: Workout) -> WorkoutOut:
    await db.commit()
    return await workout_out(db, user, await load_workout(db, user, workout.id))


async def _active_id(db: AsyncSession, user: User) -> int | None:
    return await db.scalar(
        sa.select(Workout.id).where(
            Workout.user_id == user.id, Workout.status == WorkoutStatus.in_progress
        )
    )


async def get_active(db: AsyncSession, user: User) -> WorkoutOut | None:
    ensure_permission(user, Permission.workouts)
    workout_id = await _active_id(db, user)
    if workout_id is None:
        return None
    return await workout_out(db, user, await load_workout(db, user, workout_id))


async def get_workout(db: AsyncSession, user: User, workout_id: int) -> WorkoutOut:
    return await workout_out(db, user, await load_workout(db, user, workout_id))


async def start_workout(db: AsyncSession, user: User, payload: WorkoutStart) -> WorkoutOut:
    ensure_permission(user, Permission.workouts)
    if await _active_id(db, user) is not None:
        raise Invalid("a workout is already in progress")
    started = now()
    local_day = started.astimezone(ZoneInfo(settings.app_timezone))
    workout = Workout(
        user_id=user.id, status=WorkoutStatus.in_progress, started_at=started,
        name=f"Allenamento {local_day:%d/%m/%Y}",
    )
    if payload.template_id is not None:
        template = await own_template(db, user, payload.template_id)
        workout.template_id = template.id
        workout.name = template.name
        workout.exercises = [
            WorkoutExercise(
                exercise_id=item.exercise_id, exercise=item.exercise, position=item.position,
                rest_seconds=item.rest_seconds, superset_group=item.superset_group,
                note=item.note,
                sets=[
                    WorkoutSet(
                        position=s.position, weight_kg=s.weight_kg, reps=s.reps,
                        duration_s=s.duration_s,
                    )
                    for s in item.sets
                ],
            )
            for item in template.exercises
        ]
        template.last_used_at = started
    db.add(workout)
    return await _save(db, user, workout)


async def rename_workout(
    db: AsyncSession, user: User, workout_id: int, payload: WorkoutRename
) -> WorkoutOut:
    workout = await load_workout(db, user, workout_id)
    workout.name = payload.name
    return await _save(db, user, workout)


async def add_exercise(
    db: AsyncSession, user: User, workout_id: int, payload: WorkoutExerciseAdd
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    exercise = (await get_visible_exercises(db, user, [payload.exercise_id]))[payload.exercise_id]
    previous = (await previous_sets(db, user, [exercise.id])).get(exercise.id)
    values = previous.sets if previous and previous.sets else [SetValues()]
    workout.exercises.append(
        WorkoutExercise(
            exercise_id=exercise.id, exercise=exercise, position=len(workout.exercises),
            rest_seconds=previous.rest_seconds if previous else DEFAULT_REST_SECONDS,
            sets=[
                WorkoutSet(position=number, **value.model_dump())
                for number, value in enumerate(values)
            ],
        )
    )
    return await _save(db, user, workout)


async def patch_exercise(
    db: AsyncSession, user: User, workout_id: int, item_id: int, payload: WorkoutExercisePatch
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    item = _item(workout, item_id)
    fields = payload.model_fields_set
    if "exercise_id" in fields and payload.exercise_id not in (None, item.exercise_id):
        exercise = (await get_visible_exercises(db, user, [payload.exercise_id]))[
            payload.exercise_id
        ]
        item.exercise_id = exercise.id
        item.exercise = exercise
    if "rest_seconds" in fields and payload.rest_seconds is not None:
        item.rest_seconds = payload.rest_seconds
    if "note" in fields:
        item.note = payload.note or None
    return await _save(db, user, workout)


async def remove_exercise(
    db: AsyncSession, user: User, workout_id: int, item_id: int
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    workout.exercises.remove(_item(workout, item_id))
    _renumber(workout)
    return await _save(db, user, workout)


async def set_layout(
    db: AsyncSession, user: User, workout_id: int, payload: LayoutIn
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    by_id = {item.id: item for item in workout.exercises}
    ids = [entry.id for entry in payload.items]
    if sorted(ids) != sorted(by_id):
        raise Invalid("layout must list every exercise once")
    ordered = [by_id[item_id] for item_id in ids]
    for item, entry in zip(ordered, payload.items, strict=True):
        item.superset_group = entry.superset_group
    workout.exercises[:] = ordered
    _renumber(workout)
    return await _save(db, user, workout)


async def add_set(db: AsyncSession, user: User, workout_id: int, item_id: int) -> WorkoutOut:
    """Add a set copying the last one, or the first set of last time."""
    workout = await _load_live(db, user, workout_id)
    item = _item(workout, item_id)
    if item.sets:
        last = item.sets[-1]
        values = SetValues(weight_kg=last.weight_kg, reps=last.reps, duration_s=last.duration_s)
    else:
        previous = (await previous_sets(db, user, [item.exercise_id])).get(item.exercise_id)
        values = _previous_at(previous, 0) or SetValues()
    item.sets.append(WorkoutSet(position=len(item.sets), **values.model_dump()))
    return await _save(db, user, workout)


def _apply(workout_set: WorkoutSet, payload: SetPatch) -> None:
    for name in SET_FIELDS:
        if name in payload.model_fields_set:
            setattr(workout_set, name, getattr(payload, name))


async def patch_set(
    db: AsyncSession, user: User, workout_id: int, set_id: int, payload: SetPatch
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    item, workout_set = _set(workout, set_id)
    _apply(workout_set, payload)
    if workout_set.completed_at is not None:
        problem = set_problem(
            item.exercise.tracking, workout_set.weight_kg, workout_set.reps, workout_set.duration_s
        )
        if problem:
            raise Invalid(problem)
    return await _save(db, user, workout)


async def delete_set(db: AsyncSession, user: User, workout_id: int, set_id: int) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    item, workout_set = _set(workout, set_id)
    item.sets.remove(workout_set)
    _renumber(workout)
    return await _save(db, user, workout)


def _progress(item: WorkoutExercise) -> ExerciseProgress:
    return ExerciseProgress(
        rest_seconds=item.rest_seconds, superset_group=item.superset_group,
        set_positions=frozenset(s.position for s in item.sets),
        completed_positions=frozenset(s.position for s in item.sets if s.completed_at),
    )


def _start_rest(workout: Workout, seconds: int) -> None:
    workout.rest_ends_at = now() + timedelta(seconds=seconds)
    workout.rest_total_s = seconds


def _clear_rest(workout: Workout) -> None:
    workout.rest_ends_at = None
    workout.rest_total_s = None


async def complete_set(
    db: AsyncSession, user: User, workout_id: int, set_id: int, payload: SetPatch
) -> WorkoutOut:
    """Save the values sent with the tick, mark the set done, start the rest."""
    workout = await _load_live(db, user, workout_id)
    item, workout_set = _set(workout, set_id)
    _apply(workout_set, payload)
    problem = set_problem(
        item.exercise.tracking, workout_set.weight_kg, workout_set.reps, workout_set.duration_s
    )
    if problem:
        raise Invalid(problem)
    if workout_set.completed_at is None:
        workout_set.completed_at = now()
        rest_seconds = rest_after_completion(
            [_progress(entry) for entry in workout.exercises],
            workout.exercises.index(item),
            workout_set.position,
        )
        if rest_seconds:
            _start_rest(workout, rest_seconds)
    return await _save(db, user, workout)


async def uncomplete_set(
    db: AsyncSession, user: User, workout_id: int, set_id: int
) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    _, workout_set = _set(workout, set_id)
    workout_set.completed_at = None
    return await _save(db, user, workout)


async def rest(db: AsyncSession, user: User, workout_id: int, payload: RestIn) -> WorkoutOut:
    workout = await _load_live(db, user, workout_id)
    current = now()
    if payload.skip:
        _clear_rest(workout)
    elif payload.start_s is not None:
        _start_rest(workout, payload.start_s)
    else:
        if workout.rest_ends_at is None or workout.rest_ends_at <= current:
            raise Invalid("no rest timer running")
        ends = workout.rest_ends_at + timedelta(seconds=payload.delta_s or 0)
        if ends <= current:
            _clear_rest(workout)
        else:
            workout.rest_ends_at = ends
            workout.rest_total_s = max(1, (workout.rest_total_s or 0) + (payload.delta_s or 0))
    return await _save(db, user, workout)
```

Note: `workout.exercises.index(item)` relies on the collection being ordered by `position`, which `load_workout` guarantees (`order_by` on the relationship).

- [ ] **Step 5: Write the router (live part) and register it**

`api/app/routers/workouts.py`:

```python
"""Workouts: the live session, finishing and history.

Thin layer over app/services/workouts.py; every live endpoint answers with
the full workout so the SPA can replace its cached copy.
"""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.user import User
from app.schemas.workout import (
    LayoutIn,
    RestIn,
    SetPatch,
    WorkoutExerciseAdd,
    WorkoutExercisePatch,
    WorkoutOut,
    WorkoutRename,
    WorkoutStart,
)
from app.services import workouts

router = APIRouter(prefix="/api/workouts", tags=["workouts"])


@router.get("/active", response_model=WorkoutOut, responses={204: {"description": "None"}})
async def active(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    workout = await workouts.get_active(session, user)
    if workout is None:
        return Response(status_code=204)
    return workout


@router.post("", response_model=WorkoutOut, status_code=201)
async def start(
    payload: WorkoutStart,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.start_workout(session, user, payload)


@router.get("/{workout_id}", response_model=WorkoutOut)
async def get_one(
    workout_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.get_workout(session, user, workout_id)


@router.patch("/{workout_id}", response_model=WorkoutOut)
async def rename(
    workout_id: int,
    payload: WorkoutRename,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.rename_workout(session, user, workout_id, payload)


@router.post("/{workout_id}/exercises", response_model=WorkoutOut)
async def add_exercise(
    workout_id: int,
    payload: WorkoutExerciseAdd,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.add_exercise(session, user, workout_id, payload)


@router.patch("/{workout_id}/exercises/{item_id}", response_model=WorkoutOut)
async def patch_exercise(
    workout_id: int,
    item_id: int,
    payload: WorkoutExercisePatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.patch_exercise(session, user, workout_id, item_id, payload)


@router.delete("/{workout_id}/exercises/{item_id}", response_model=WorkoutOut)
async def remove_exercise(
    workout_id: int,
    item_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.remove_exercise(session, user, workout_id, item_id)


@router.put("/{workout_id}/layout", response_model=WorkoutOut)
async def set_layout(
    workout_id: int,
    payload: LayoutIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.set_layout(session, user, workout_id, payload)


@router.post("/{workout_id}/exercises/{item_id}/sets", response_model=WorkoutOut)
async def add_set(
    workout_id: int,
    item_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.add_set(session, user, workout_id, item_id)


@router.patch("/{workout_id}/sets/{set_id}", response_model=WorkoutOut)
async def patch_set(
    workout_id: int,
    set_id: int,
    payload: SetPatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.patch_set(session, user, workout_id, set_id, payload)


@router.delete("/{workout_id}/sets/{set_id}", response_model=WorkoutOut)
async def delete_set(
    workout_id: int,
    set_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.delete_set(session, user, workout_id, set_id)


@router.post("/{workout_id}/sets/{set_id}/complete", response_model=WorkoutOut)
async def complete_set(
    workout_id: int,
    set_id: int,
    payload: SetPatch | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.complete_set(session, user, workout_id, set_id, payload or SetPatch())


@router.post("/{workout_id}/sets/{set_id}/uncomplete", response_model=WorkoutOut)
async def uncomplete_set(
    workout_id: int,
    set_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.uncomplete_set(session, user, workout_id, set_id)


@router.post("/{workout_id}/rest", response_model=WorkoutOut)
async def rest(
    workout_id: int,
    payload: RestIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.rest(session, user, workout_id, payload)
```

In `api/app/main.py`: add `workouts` to the routers import (`from app.routers import admin, auth, diary, exercises, foods, oauth, templates, workouts`) and
`app.include_router(workouts.router, dependencies=[Depends(get_current_user)])` after the templates router.

- [ ] **Step 6: Run local checks**

Run (from `api/`): `.venv\Scripts\python -m ruff check app tests`, `.venv\Scripts\python -c "import app.main"`, `.venv\Scripts\python -m pytest tests/test_gym_rules.py -q`, `.venv\Scripts\python -m pytest --collect-only -q`.
Expected: clean. DB tests: written, not run locally.

- [ ] **Step 7: Commit**

```bash
git add api/app/schemas/workout.py api/app/services/workouts.py api/app/routers/workouts.py api/app/main.py api/tests/test_workouts_live.py api/tests/test_gym_routers.py
git commit -m "feat(api): live workout session with previous values and rest timer"
```

---

### Task 6: Fine allenamento, diff col modello, storico

**Files:**
- Modify: `api/app/services/workouts.py` (append)
- Modify: `api/app/routers/workouts.py` (append)
- Test: `api/tests/test_workouts_finish.py` (DB), append to `api/tests/test_gym_routers.py` (DB)

**Interfaces:**
- Consumes: everything from Task 5; `template_out`, `own_template`, `own_folder`, `next_template_position` (Task 4); `FinishIn`, `SaveAsTemplateIn`, `HistoryPage` (Task 5 schemas); `TemplateOut` (Task 4).
- Produces (`app.services.workouts`):
  - `async finish_workout(db, user, workout_id, payload: FinishIn) -> WorkoutOut` — `Invalid("empty_workout")` when no set is done; `Invalid("incomplete_sets")` when some are not done and `discard_incomplete` is false.
  - `async delete_workout(db, user, workout_id) -> None` (cancel a live one or delete a finished one)
  - `async apply_to_template(db, user, workout_id) -> TemplateOut` — `Invalid("workout is not finished")`, `Invalid("workout has no template")`
  - `async save_as_template(db, user, workout_id, payload: SaveAsTemplateIn) -> TemplateOut`
  - `async list_history(db, user, *, before: datetime | None = None, limit: int = 20) -> HistoryPage`
- REST: `POST /api/workouts/{id}/finish` → `WorkoutOut`, `DELETE /api/workouts/{id}` (204), `POST /api/workouts/{id}/apply-to-template` → `TemplateOut`, `POST /api/workouts/{id}/save-as-template` (201) → `TemplateOut`, `GET /api/workouts?before=&limit=` → `HistoryPage`.

- [ ] **Step 1: Write the failing tests**

`api/tests/test_workouts_finish.py`:

```python
"""Finishing a workout, the template diff and history (needs Postgres)."""

from datetime import UTC, datetime, timedelta

import pytest

from app.models.workout import WorkoutStatus
from app.schemas.workout import (
    FinishIn,
    SaveAsTemplateIn,
    SetPatch,
    TemplateIn,
    WorkoutExerciseAdd,
    WorkoutStart,
)
from app.services import templates, workouts
from app.services.errors import Invalid, NotFound
from tests.factories import GYM, make_exercise, make_user

T0 = datetime(2026, 9, 24, 18, 0, tzinfo=UTC)


@pytest.fixture
def clock(monkeypatch):
    class Clock:
        current = T0

        def advance(self, seconds: int) -> None:
            self.current += timedelta(seconds=seconds)

    c = Clock()
    monkeypatch.setattr(workouts, "now", lambda: c.current)
    return c


async def _squat_template(db, user, squat_id):
    return await templates.create_template(db, user, TemplateIn.model_validate({
        "name": "Giorno 1",
        "exercises": [{"exercise_id": squat_id, "rest_seconds": 90,
                       "sets": [{"weight_kg": 80, "reps": 8}, {"weight_kg": 80, "reps": 8}]}],
    }))


async def test_finish_requires_confirmation_for_incomplete_sets(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    template = await _squat_template(db, user, squat.id)
    workout = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))

    with pytest.raises(Invalid, match="empty_workout"):
        await workouts.finish_workout(db, user, workout.id, FinishIn(discard_incomplete=True))

    first, second = workout.exercises[0].sets
    workout = await workouts.complete_set(
        db, user, workout.id, first.id, SetPatch(weight_kg=85)
    )
    with pytest.raises(Invalid, match="incomplete_sets"):
        await workouts.finish_workout(db, user, workout.id, FinishIn())

    clock.advance(3600)
    finished = await workouts.finish_workout(
        db, user, workout.id, FinishIn(discard_incomplete=True)
    )
    assert finished.status is WorkoutStatus.finished
    assert finished.finished_at == T0 + timedelta(seconds=3600)
    assert finished.rest_ends_at is None
    assert [(s.weight_kg, s.reps) for s in finished.exercises[0].sets] == [(85, 8)]
    assert finished.template_diff == [
        "Zzq Squat: serie 1 80 kg × 8 → 85 kg × 8",
        "Zzq Squat: -1 serie",
    ]
    assert await workouts.get_active(db, user) is None
    with pytest.raises(Invalid, match="not in progress"):
        await workouts.add_set(db, user, workout.id, finished.exercises[0].id)


async def test_finish_drops_exercises_without_done_sets(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    curl = await make_exercise(db, name="Zzq Curl")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    for exercise in (squat, curl):
        workout = await workouts.add_exercise(
            db, user, workout.id, WorkoutExerciseAdd(exercise_id=exercise.id)
        )
    workout = await workouts.complete_set(
        db, user, workout.id, workout.exercises[1].sets[0].id, SetPatch(weight_kg=12, reps=10)
    )
    finished = await workouts.finish_workout(
        db, user, workout.id, FinishIn(discard_incomplete=True)
    )
    assert [e.exercise.name for e in finished.exercises] == ["Zzq Curl"]
    assert finished.template_diff == []  # no template


async def test_apply_to_template_and_next_previous(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    template = await _squat_template(db, user, squat.id)
    workout = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))
    first, second = workout.exercises[0].sets
    await workouts.complete_set(db, user, workout.id, first.id, SetPatch(weight_kg=85))
    await workouts.complete_set(db, user, workout.id, second.id, SetPatch())
    finished = await workouts.finish_workout(db, user, workout.id, FinishIn())
    assert finished.template_diff == ["Zzq Squat: serie 1 80 kg × 8 → 85 kg × 8"]

    updated = await workouts.apply_to_template(db, user, workout.id)
    assert [(s.weight_kg, s.reps) for s in updated.exercises[0].sets] == [(85, 8), (80, 8)]
    assert (await workouts.get_workout(db, user, workout.id)).template_diff == []

    clock.advance(86400)
    again = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))
    assert (again.exercises[0].sets[0].weight_kg, again.exercises[0].sets[0].previous.weight_kg) == (
        85, 85
    )


async def test_save_as_template_links_the_workout(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    await workouts.complete_set(
        db, user, workout.id, workout.exercises[0].sets[0].id, SetPatch(weight_kg=60, reps=5)
    )
    with pytest.raises(Invalid, match="not finished"):
        await workouts.save_as_template(db, user, workout.id, SaveAsTemplateIn(name="Nuovo"))
    await workouts.finish_workout(db, user, workout.id, FinishIn())
    with pytest.raises(Invalid, match="has no template"):
        await workouts.apply_to_template(db, user, workout.id)

    saved = await workouts.save_as_template(db, user, workout.id, SaveAsTemplateIn(name="Nuovo"))
    assert saved.name == "Nuovo"
    assert [(s.weight_kg, s.reps) for s in saved.exercises[0].sets] == [(60, 5)]
    assert (await workouts.get_workout(db, user, workout.id)).template_id == saved.id


async def test_history_pages_and_delete(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    ids = []
    for _ in range(3):
        workout = await workouts.start_workout(db, user, WorkoutStart())
        workout = await workouts.add_exercise(
            db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
        )
        await workouts.complete_set(
            db, user, workout.id, workout.exercises[0].sets[0].id, SetPatch(weight_kg=60, reps=5)
        )
        await workouts.finish_workout(db, user, workout.id, FinishIn())
        ids.append(workout.id)
        clock.advance(3600)

    first = await workouts.list_history(db, user, limit=2)
    assert [item.id for item in first.items] == [ids[2], ids[1]]
    assert first.items[0].exercises[0].name == "Zzq Squat"
    assert first.items[0].exercises[0].sets == 1
    assert first.next_before is not None
    second = await workouts.list_history(db, user, before=first.next_before, limit=2)
    assert [item.id for item in second.items] == [ids[0]]
    assert second.next_before is None

    await workouts.delete_workout(db, user, ids[0])
    with pytest.raises(NotFound):
        await workouts.get_workout(db, user, ids[0])

    # cancelling a live workout
    live = await workouts.start_workout(db, user, WorkoutStart())
    await workouts.delete_workout(db, user, live.id)
    assert await workouts.get_active(db, user) is None
```

Append to `api/tests/test_gym_routers.py`:

```python
async def test_finish_and_history_api(db) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    async with await http_client(db, user) as client:
        workout_id = (await client.post("/api/workouts", json={})).json()["id"]
        body = (await client.post(
            f"/api/workouts/{workout_id}/exercises", json={"exercise_id": squat.id}
        )).json()
        set_id = body["exercises"][0]["sets"][0]["id"]

        empty = await client.post(f"/api/workouts/{workout_id}/finish", json={})
        assert (empty.status_code, empty.json()) == (400, {"detail": "empty_workout"})

        await client.post(f"/api/workouts/{workout_id}/exercises/{body['exercises'][0]['id']}/sets")
        await client.post(
            f"/api/workouts/{workout_id}/sets/{set_id}/complete", json={"weight_kg": 60, "reps": 5}
        )
        pending = await client.post(f"/api/workouts/{workout_id}/finish", json={})
        assert (pending.status_code, pending.json()) == (400, {"detail": "incomplete_sets"})
        done = await client.post(
            f"/api/workouts/{workout_id}/finish", json={"discard_incomplete": True}
        )
        assert done.json()["status"] == "finished"

        saved = await client.post(
            f"/api/workouts/{workout_id}/save-as-template", json={"name": "Da storico"}
        )
        assert saved.status_code == 201
        applied = await client.post(f"/api/workouts/{workout_id}/apply-to-template")
        assert applied.status_code == 200

        history = (await client.get("/api/workouts", params={"limit": 5})).json()
        assert history["items"][0]["id"] == workout_id
        assert (await client.delete(f"/api/workouts/{workout_id}")).status_code == 204
```

- [ ] **Step 2: Verify the new functions are missing**

Run: `.venv\Scripts\python -c "from app.services.workouts import finish_workout"`
Expected: `ImportError: cannot import name 'finish_workout'`.

- [ ] **Step 3: Append the service functions**

Add to the imports of `api/app/services/workouts.py`:

```python
from app.models.workout import TemplateExercise, TemplateSet, WorkoutTemplate
from app.schemas.workout import (
    FinishIn,
    HistoryExercise,
    HistoryItem,
    HistoryPage,
    SaveAsTemplateIn,
    TemplateOut,
)
from app.services.templates import next_template_position, own_folder, template_out
```

(merge them into the existing import statements rather than duplicating `from` lines), then append:

```python
async def finish_workout(
    db: AsyncSession, user: User, workout_id: int, payload: FinishIn
) -> WorkoutOut:
    """Close the session. Undone sets are only dropped when the user confirmed
    (`discard_incomplete`); exercises left without sets are dropped too."""
    workout = await _load_live(db, user, workout_id)
    all_sets = [s for item in workout.exercises for s in item.sets]
    if not any(s.completed_at is not None for s in all_sets):
        raise Invalid("empty_workout")
    if any(s.completed_at is None for s in all_sets) and not payload.discard_incomplete:
        raise Invalid("incomplete_sets")
    for item in workout.exercises:
        item.sets[:] = [s for s in item.sets if s.completed_at is not None]
    workout.exercises[:] = [item for item in workout.exercises if item.sets]
    _renumber(workout)
    workout.status = WorkoutStatus.finished
    workout.finished_at = now()
    _clear_rest(workout)
    return await _save(db, user, workout)


async def delete_workout(db: AsyncSession, user: User, workout_id: int) -> None:
    await db.delete(await load_workout(db, user, workout_id))
    await db.commit()


async def _load_finished(db: AsyncSession, user: User, workout_id: int) -> Workout:
    workout = await load_workout(db, user, workout_id)
    if workout.status is not WorkoutStatus.finished:
        raise Invalid("workout is not finished")
    return workout


def _template_exercises(workout: Workout) -> list[TemplateExercise]:
    return [
        TemplateExercise(
            exercise_id=item.exercise_id, exercise=item.exercise, position=item.position,
            rest_seconds=item.rest_seconds, superset_group=item.superset_group, note=item.note,
            sets=[
                TemplateSet(
                    position=s.position, weight_kg=s.weight_kg, reps=s.reps,
                    duration_s=s.duration_s,
                )
                for s in item.sets
            ],
        )
        for item in workout.exercises
    ]


async def apply_to_template(db: AsyncSession, user: User, workout_id: int) -> TemplateOut:
    """Make the workout's template match what was actually done."""
    workout = await _load_finished(db, user, workout_id)
    if workout.template_id is None:
        raise Invalid("workout has no template")
    template = await own_template(db, user, workout.template_id)
    template.exercises = _template_exercises(workout)
    await db.commit()
    return template_out(await own_template(db, user, template.id))


async def save_as_template(
    db: AsyncSession, user: User, workout_id: int, payload: SaveAsTemplateIn
) -> TemplateOut:
    workout = await _load_finished(db, user, workout_id)
    if payload.folder_id is not None:
        await own_folder(db, user, payload.folder_id)
    template = WorkoutTemplate(
        user_id=user.id, folder_id=payload.folder_id, name=payload.name,
        position=await next_template_position(db, user, payload.folder_id),
        last_used_at=workout.finished_at, exercises=_template_exercises(workout),
    )
    db.add(template)
    await db.flush()
    workout.template_id = template.id
    await db.commit()
    return template_out(await own_template(db, user, template.id))


async def list_history(
    db: AsyncSession, user: User, *, before: datetime | None = None, limit: int = 20
) -> HistoryPage:
    ensure_permission(user, Permission.workouts)
    stmt = (
        sa.select(Workout)
        .where(Workout.user_id == user.id, Workout.status == WorkoutStatus.finished)
        .options(
            selectinload(Workout.exercises).selectinload(WorkoutExercise.exercise),
            selectinload(Workout.exercises).selectinload(WorkoutExercise.sets),
        )
        .order_by(Workout.finished_at.desc(), Workout.id.desc())
        .limit(limit + 1)
    )
    if before is not None:
        stmt = stmt.where(Workout.finished_at < before)
    rows = (await db.scalars(stmt)).all()
    page = rows[:limit]
    return HistoryPage(
        items=[
            HistoryItem(
                id=w.id, name=w.name, started_at=w.started_at, finished_at=w.finished_at,
                exercises=[
                    HistoryExercise(name=item.exercise.name, sets=len(item.sets))
                    for item in w.exercises
                ],
            )
            for w in page
        ],
        next_before=page[-1].finished_at if len(rows) > limit else None,
    )
```

- [ ] **Step 4: Append the routes**

In `api/app/routers/workouts.py` extend the imports:

```python
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.schemas.workout import FinishIn, HistoryPage, SaveAsTemplateIn, TemplateOut
```

(merge with the existing import lines), then add these routes (keep `"/active"` declared first, as it is).

```python
@router.get("", response_model=HistoryPage)
async def history(
    before: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> HistoryPage:
    return await workouts.list_history(session, user, before=before, limit=limit)


@router.post("/{workout_id}/finish", response_model=WorkoutOut)
async def finish(
    workout_id: int,
    payload: FinishIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return await workouts.finish_workout(session, user, workout_id, payload)


@router.delete("/{workout_id}", status_code=204)
async def delete(
    workout_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await workouts.delete_workout(session, user, workout_id)


@router.post("/{workout_id}/apply-to-template", response_model=TemplateOut)
async def apply_to_template(
    workout_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await workouts.apply_to_template(session, user, workout_id)


@router.post("/{workout_id}/save-as-template", response_model=TemplateOut, status_code=201)
async def save_as_template(
    workout_id: int,
    payload: SaveAsTemplateIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await workouts.save_as_template(session, user, workout_id, payload)
```

- [ ] **Step 5: Run local checks**

Run (from `api/`): `.venv\Scripts\python -m ruff check app tests`, `.venv\Scripts\python -c "import app.main"`, `.venv\Scripts\python -m pytest --collect-only -q`.
Expected: clean. DB tests: written, not run locally.

- [ ] **Step 6: Commit**

```bash
git add api/app/services/workouts.py api/app/routers/workouts.py api/tests/test_workouts_finish.py api/tests/test_gym_routers.py
git commit -m "feat(api): finish workouts, update templates from them, history"
```

---

### Task 7: Tool MCP per la palestra

**Files:**
- Create: `api/app/mcp/tools/workouts.py`
- Modify: `api/app/mcp/server.py`
- Test: `api/tests/test_mcp_tools_workouts.py` (DB)

**Interfaces:**
- Consumes: `tool_scope`, `today` from `app.mcp.context`; services `exercises`, `templates`, `workouts`; `TemplateExerciseIn`, `TemplateIn`, `FolderIn`.
- Produces tools: `search_exercises`, `list_workout_templates`, `get_workout_template`, `create_workout_template`, `list_workouts`, `get_workout`, all returning `dict[str, Any]`.

- [ ] **Step 1: Write the failing tests**

`api/tests/test_mcp_tools_workouts.py`:

```python
"""Gym tools over the in-memory MCP transport (needs Postgres)."""

import sqlalchemy as sa

from app.models.user import AuditEvent
from app.schemas.workout import FinishIn, SetPatch, WorkoutExerciseAdd, WorkoutStart
from app.services import workouts
from tests.factories import make_exercise, make_user
from tests.mcp_helpers import call, call_error, mcp_client

BOTH = ["mcp.access", "workouts.use"]


async def test_search_and_create_template(db) -> None:
    user = await make_user(db, permissions=BOTH)
    squat = await make_exercise(db, name="Zzq Squat")
    async with mcp_client(user) as client:
        found = await call(client, "search_exercises", query="Zzq Squat")
        assert found["exercises"][0] == {
            "exercise_id": squat.id, "name": "Zzq Squat", "equipment": "barbell",
            "primary_muscles": ["quadriceps"], "tracking": "weight_reps", "custom": False,
        }
        created = await call(client, "create_workout_template", name="Giorno 1",
                             folder="Settimana 1", exercises=[{
                                 "exercise_id": squat.id, "rest_seconds": 120,
                                 "sets": [{"weight_kg": 80, "reps": 8}] * 3,
                             }])
        assert created["name"] == "Giorno 1"
        assert created["exercises"][0]["sets"] == [
            {"weight_kg": 80.0, "reps": 8, "duration_s": None}
        ] * 3
        again = await call(client, "create_workout_template", name="Giorno 2",
                           folder="settimana 1", exercises=[{
                               "exercise_id": squat.id, "sets": [{"weight_kg": 60, "reps": 10}],
                           }])
        listing = await call(client, "list_workout_templates")
        detail = await call(client, "get_workout_template", template_id=again["template_id"])
    assert [f["name"] for f in listing["folders"]] == ["Settimana 1"]
    assert {t["name"] for t in listing["templates"]} == {"Giorno 1", "Giorno 2"}
    assert all(t["folder"] == "Settimana 1" for t in listing["templates"])
    assert detail["exercises"][0]["rest_seconds"] == 90
    audit = (await db.scalars(sa.select(AuditEvent).where(
        AuditEvent.action == "mcp.create_workout_template"))).all()
    assert len(audit) == 2


async def test_workout_history_tools(db) -> None:
    user = await make_user(db, permissions=BOTH)
    squat = await make_exercise(db, name="Zzq Squat")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    await workouts.complete_set(
        db, user, workout.id, workout.exercises[0].sets[0].id, SetPatch(weight_kg=60, reps=5)
    )
    await workouts.finish_workout(db, user, workout.id, FinishIn())
    async with mcp_client(user) as client:
        listed = await call(client, "list_workouts")
        detail = await call(client, "get_workout", workout_id=workout.id)
    assert listed["workouts"][0]["workout_id"] == workout.id
    assert listed["workouts"][0]["exercises"] == [{"name": "Zzq Squat", "sets": 1}]
    assert detail["exercises"][0]["sets"] == ["60 kg × 5"]


async def test_gym_tools_need_the_workouts_permission(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        message = await call_error(client, "list_workout_templates")
    assert "workouts.use" in message
```

- [ ] **Step 2: Verify it fails**

Run: `.venv\Scripts\python -c "import app.mcp.tools.workouts"`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Write the tools**

`api/app/mcp/tools/workouts.py`:

```python
"""MCP tools for the gym: exercises, workout templates and workout history.

No tool drives the live session: that happens in the app, at the gym.
"""

from datetime import datetime
from typing import Annotated, Any

import sqlalchemy as sa
from mcp.server.mcpserver import MCPServer
from pydantic import Field

from app.mcp.context import tool_scope
from app.models.workout import TemplateFolder
from app.schemas.workout import (
    FolderIn,
    TemplateExerciseIn,
    TemplateIn,
    TemplateOut,
    WorkoutOut,
)
from app.services import exercises as exercise_service
from app.services import templates, workouts
from app.services.gym_rules import format_set


def _exercise(item) -> dict[str, Any]:
    return {
        "exercise_id": item.id,
        "name": item.name,
        "equipment": item.equipment,
        "primary_muscles": item.primary_muscles,
        "tracking": item.tracking.value,
        "custom": item.custom,
    }


def _template(template: TemplateOut) -> dict[str, Any]:
    return {
        "template_id": template.id,
        "name": template.name,
        "folder_id": template.folder_id,
        "exercises": [
            {
                "exercise_id": item.exercise.id,
                "name": item.exercise.name,
                "tracking": item.exercise.tracking.value,
                "rest_seconds": item.rest_seconds,
                "superset_group": item.superset_group,
                "sets": [s.model_dump() for s in item.sets],
            }
            for item in template.exercises
        ],
    }


def _workout(workout: WorkoutOut) -> dict[str, Any]:
    return {
        "workout_id": workout.id,
        "name": workout.name,
        "status": workout.status.value,
        "started_at": workout.started_at.isoformat(),
        "finished_at": workout.finished_at.isoformat() if workout.finished_at else None,
        "exercises": [
            {
                "name": item.exercise.name,
                "sets": [
                    format_set(item.exercise.tracking, (s.weight_kg, s.reps, s.duration_s))
                    for s in item.sets
                ],
            }
            for item in workout.exercises
        ],
    }


def register_workout_tools(server: MCPServer) -> None:
    @server.tool(description=(
        "Search the exercise catalog (English names) plus the user's custom exercises. "
        "Optional filters: equipment (e.g. barbell, dumbbell, body only) and primary muscle "
        "(e.g. chest, quadriceps). Use exercise_id with create_workout_template."
    ))
    async def search_exercises(
        query: Annotated[str, Field(max_length=100)] = "",
        equipment: str | None = None,
        muscle: str | None = None,
        limit: Annotated[int, Field(ge=1, le=50)] = 20,
    ) -> dict[str, Any]:
        async with tool_scope() as scope:
            found = await exercise_service.search_exercises(
                scope.db, scope.user, q=query, equipment=equipment, muscle=muscle, limit=limit
            )
            return {"exercises": [_exercise(item) for item in found.items], "total": found.total}

    @server.tool(description="The user's workout template folders and templates.")
    async def list_workout_templates() -> dict[str, Any]:
        async with tool_scope() as scope:
            listing = await templates.list_templates(scope.db, scope.user)
            names = {folder.id: folder.name for folder in listing.folders}
            return {
                "folders": [{"folder_id": f.id, "name": f.name} for f in listing.folders],
                "templates": [
                    {
                        "template_id": t.id,
                        "name": t.name,
                        "folder": names.get(t.folder_id) if t.folder_id else None,
                        "exercises": t.exercise_names,
                        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
                    }
                    for t in listing.templates
                ],
            }

    @server.tool(description="One workout template with its exercises, sets and rest times.")
    async def get_workout_template(template_id: int) -> dict[str, Any]:
        async with tool_scope() as scope:
            return _template(await templates.get_template(scope.db, scope.user, template_id))

    @server.tool(description=(
        "Create a workout template. Each exercise needs exercise_id and at least one set "
        "(weight_kg + reps, reps only, or duration_s, matching the exercise's tracking); "
        "rest_seconds defaults to 90. Exercises with the same superset_group next to each "
        "other form a superset. `folder` is a folder name, created if missing. "
        "Confirm the plan with the user first."
    ))
    async def create_workout_template(
        name: Annotated[str, Field(min_length=1, max_length=100)],
        exercises: list[TemplateExerciseIn],
        folder: Annotated[str | None, Field(max_length=100)] = None,
    ) -> dict[str, Any]:
        async with tool_scope() as scope:
            folder_id = None
            if folder and folder.strip():
                folder_id = await scope.db.scalar(
                    sa.select(TemplateFolder.id).where(
                        TemplateFolder.user_id == scope.user.id,
                        sa.func.lower(TemplateFolder.name) == folder.strip().lower(),
                    )
                )
                if folder_id is None:
                    created_folder = await templates.create_folder(
                        scope.db, scope.user, FolderIn(name=folder)
                    )
                    folder_id = created_folder.id
            template = await templates.create_template(
                scope.db, scope.user,
                TemplateIn(name=name, folder_id=folder_id, exercises=exercises),
            )
            await scope.audit("create_workout_template", {"template_id": template.id})
            return _template(template)

    @server.tool(description=(
        "Finished workouts, newest first. Pass `before` (from next_before) for older ones."
    ))
    async def list_workouts(
        limit: Annotated[int, Field(ge=1, le=50)] = 10,
        before: datetime | None = None,
    ) -> dict[str, Any]:
        async with tool_scope() as scope:
            page = await workouts.list_history(scope.db, scope.user, before=before, limit=limit)
            return {
                "workouts": [
                    {
                        "workout_id": item.id,
                        "name": item.name,
                        "started_at": item.started_at.isoformat(),
                        "duration_min": round(
                            (item.finished_at - item.started_at).total_seconds() / 60
                        ),
                        "exercises": [e.model_dump() for e in item.exercises],
                    }
                    for item in page.items
                ],
                "next_before": page.next_before.isoformat() if page.next_before else None,
            }

    @server.tool(description="One workout with every set (e.g. '80 kg × 8').")
    async def get_workout(workout_id: int) -> dict[str, Any]:
        async with tool_scope() as scope:
            return _workout(await workouts.get_workout(scope.db, scope.user, workout_id))
```

The service module is imported as `exercise_service` because `create_workout_template` has an argument named `exercises`.

- [ ] **Step 4: Register the tools**

In `api/app/mcp/server.py` add `from app.mcp.tools.workouts import register_workout_tools`, call `register_workout_tools(server)` next to the other `register_*_tools(server)` calls in `build_server()`, and extend `INSTRUCTIONS` with this bullet (before the last one):

```
- Gym: search_exercises finds exercises (English names); create_workout_template
  builds a template from exercise_ids and sets; list_workouts / get_workout read
  finished workouts. Weights are in kg. The live session is only in the app.
```

and change the first line to `YourFitnessPal is the user's personal food diary and gym log. Every tool acts only on the`.

- [ ] **Step 5: Run local checks**

Run (from `api/`): `.venv\Scripts\python -m ruff check app tests`, `.venv\Scripts\python -c "import app.main"`, `.venv\Scripts\python -m pytest --collect-only -q`.
Expected: clean. DB tests: written, not run locally.

- [ ] **Step 6: Commit**

```bash
git add api/app/mcp/tools/workouts.py api/app/mcp/server.py api/tests/test_mcp_tools_workouts.py
git commit -m "feat(api): MCP tools for exercises, workout templates and history"
```

---
### Task 8: Web — client API palestra e librerie

**Files:**
- Create: `web/src/api/gym.ts`
- Create: `web/src/lib/gym.ts`, `web/src/lib/gym.test.ts`
- Create: `web/src/lib/restTimer.ts`, `web/src/lib/restTimer.test.ts`
- Create: `web/src/lib/appMode.ts`, `web/src/lib/appMode.test.ts`
- Create: `web/src/lib/liveErrors.ts`, `web/src/lib/useNow.ts`, `web/src/lib/useDebounced.ts`

**Interfaces:**
- Consumes: `client`, `ApiError` from `web/src/api/client.ts`; REST endpoints of Tasks 3–6.
- Produces (`web/src/api/gym.ts`): types `Tracking`, `Exercise`, `ExerciseDetail`, `ExerciseList`, `ExerciseInput`, `ExerciseFilters`, `SetValues`, `TemplateExercise`, `Template`, `TemplateSummary`, `Folder`, `TemplatesResponse`, `TemplateExerciseInput`, `TemplateInput`, `WorkoutSet`, `WorkoutExercise`, `Workout`, `HistoryItem`, `HistoryPage`, `LayoutItem`, `RestAction`; `EMPTY_FILTERS`; `gymKeys`; `gymApi`; hooks `useExercises`, `useExercise`, `useCreateExercise`, `useUpdateExercise`, `useArchiveExercise`, `useTemplates`, `useTemplate`, `useCreateTemplate`, `useReplaceTemplate`, `usePatchTemplate`, `useDeleteTemplate`, `useDuplicateTemplate`, `useCreateFolder`, `useRenameFolder`, `useDeleteFolder`, `useActiveWorkout`, `useWorkout`, `useLiveMutation`, `useStartWorkout`, `useFinishWorkout`, `useCancelWorkout`, `useHistory`, `useApplyToTemplate`, `useSaveAsTemplate`, `useDeleteWorkout`.
- Produces (`web/src/lib/gym.ts`): `EQUIPMENT_LABELS`, `MUSCLE_LABELS`, `TRACKING_LABELS`, `equipmentLabel`, `muscleLabel`, `exerciseSubtitle`, `SetField`, `FIELD_META`, `setFields`, `setGridColumns`, `formatKg`, `parseDecimal`, `parseInteger`, `formatDuration`, `parseDuration`, `formatSet`, `REST_OPTIONS`, `restLabel`, `elapsedLabel`, `durationLabel`, `lastUsedLabel`, `workoutDateLabel`, `monthLabel`, `normalizeSupersets`, `linkWithNext`, `unlinkFromGroup`, `moveItem`, `liveErrorMessage`.
- Produces (`web/src/lib/restTimer.ts`): `clockOffsetMs(serverNowIso, clientNowMs)`, `remainingSeconds(restEndsAtIso, offsetMs, clientNowMs)`, `unlockAudio()`, `beep()`, `vibrate()`.
- Produces (`web/src/lib/appMode.ts`): `AppMode`, `modeFromPath`, `currentMode`, `rememberPath`, `lastPath`.
- Produces: `LiveErrorContext` (`web/src/lib/liveErrors.ts`), `useNow(intervalMs)`, `useDebounced(value, delayMs)`.

- [ ] **Step 1: Write the failing library tests**

`web/src/lib/gym.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ApiError } from "../api/client";
import {
  durationLabel,
  elapsedLabel,
  formatDuration,
  formatKg,
  formatSet,
  lastUsedLabel,
  linkWithNext,
  liveErrorMessage,
  moveItem,
  normalizeSupersets,
  parseDecimal,
  parseDuration,
  parseInteger,
  unlinkFromGroup,
} from "./gym";

describe("number formatting", () => {
  it("formats and parses kg with a decimal comma", () => {
    expect(formatKg(80)).toBe("80");
    expect(formatKg(37.5)).toBe("37,5");
    expect(parseDecimal("37,5")).toBe(37.5);
    expect(parseDecimal(" 80 ")).toBe(80);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("-1")).toBeNull();
  });

  it("parses integers", () => {
    expect(parseInteger("8")).toBe(8);
    expect(parseInteger("8,5")).toBeNull();
    expect(parseInteger("")).toBeNull();
  });

  it("formats and parses durations", () => {
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(5)).toBe("0:05");
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("45")).toBe(45);
    expect(parseDuration("1:75")).toBeNull();
  });

  it("formats a set like the API does", () => {
    expect(formatSet("weight_reps", { weight_kg: 80, reps: 8, duration_s: null })).toBe("80 kg × 8");
    expect(formatSet("reps", { weight_kg: null, reps: 12, duration_s: null })).toBe("12 rip");
    expect(formatSet("duration", { weight_kg: null, reps: null, duration_s: 75 })).toBe("1:15");
  });
});

describe("time labels", () => {
  it("shows elapsed time", () => {
    const start = "2026-09-24T18:00:00Z";
    expect(elapsedLabel(start, Date.parse("2026-09-24T18:12:34Z"))).toBe("12:34");
    expect(elapsedLabel(start, Date.parse("2026-09-24T19:02:03Z"))).toBe("1:02:03");
  });

  it("shows durations", () => {
    expect(durationLabel("2026-09-24T18:00:00Z", "2026-09-24T18:45:00Z")).toBe("45 min");
    expect(durationLabel("2026-09-24T18:00:00Z", "2026-09-24T19:05:00Z")).toBe("1 h 5 min");
    expect(durationLabel("2026-09-24T18:00:00Z", "2026-09-24T20:00:00Z")).toBe("2 h");
  });

  it("describes when a template was last used", () => {
    const now = new Date(2026, 8, 24, 15, 0);
    expect(lastUsedLabel(null, now)).toBeNull();
    expect(lastUsedLabel(new Date(2026, 8, 24, 8, 0).toISOString(), now)).toBe("Oggi");
    expect(lastUsedLabel(new Date(2026, 8, 23, 22, 0).toISOString(), now)).toBe("Ieri");
    expect(lastUsedLabel(new Date(2026, 8, 18, 10, 0).toISOString(), now)).toBe("6 giorni fa");
    expect(lastUsedLabel(new Date(2025, 10, 21, 10, 0).toISOString(), now)).toContain("2025");
  });
});

describe("supersets", () => {
  it("normalizes groups like the API", () => {
    expect(normalizeSupersets([null, 7, 7, null])).toEqual([null, 1, 1, null]);
    expect(normalizeSupersets([3, null, 5, 5])).toEqual([null, null, 1, 1]);
    expect(normalizeSupersets([2, 2, null, 2, 2])).toEqual([1, 1, null, 2, 2]);
  });

  it("links an exercise with the next one", () => {
    expect(linkWithNext([null, null, null], 0)).toEqual([1, 1, null]);
    expect(linkWithNext([1, 1, null], 1)).toEqual([1, 1, 1]);
    expect(linkWithNext([null, 1, 1], 0)).toEqual([1, 1, 1]);
    expect(linkWithNext([1, 1, 2, 2], 1)).toEqual([1, 1, 1, 1]);
    expect(linkWithNext([null, null], 1)).toEqual([null, null]);
  });

  it("unlinks an exercise", () => {
    expect(unlinkFromGroup([1, 1, 1], 2)).toEqual([1, 1, null]);
    expect(unlinkFromGroup([1, 1], 0)).toEqual([null, null]);
  });

  it("moves items", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});

describe("liveErrorMessage", () => {
  it("translates known API errors and network failures", () => {
    expect(liveErrorMessage(new ApiError(400, "weight and reps are required", null))).toBe(
      "Inserisci kg e ripetizioni",
    );
    expect(liveErrorMessage(new ApiError(400, "something else", null))).toBe("something else");
    expect(liveErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "Non salvato: controlla la connessione",
    );
  });
});
```

`web/src/lib/restTimer.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { clockOffsetMs, remainingSeconds } from "./restTimer";

describe("rest timer math", () => {
  it("computes the server clock offset", () => {
    expect(clockOffsetMs("2026-09-24T18:00:10Z", Date.parse("2026-09-24T18:00:00Z"))).toBe(10_000);
  });

  it("counts down using the server clock", () => {
    const ends = "2026-09-24T18:01:30Z";
    const client = Date.parse("2026-09-24T18:00:00Z");
    expect(remainingSeconds(ends, 0, client)).toBe(90);
    // the phone is 10 s behind the server: 10 s less to wait
    expect(remainingSeconds(ends, 10_000, client)).toBe(80);
    expect(remainingSeconds(ends, 0, client + 89_500)).toBe(1);
    expect(remainingSeconds(ends, 0, client + 95_000)).toBe(0);
    expect(remainingSeconds(null, 0, client)).toBe(0);
  });
});
```

`web/src/lib/appMode.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { currentMode, lastPath, modeFromPath, rememberPath } from "./appMode";

describe("appMode", () => {
  beforeEach(() => window.localStorage.clear());

  it("derives the mode from the path", () => {
    expect(modeFromPath("/")).toBe("diet");
    expect(modeFromPath("/week")).toBe("diet");
    expect(modeFromPath("/search")).toBe("diet");
    expect(modeFromPath("/gym")).toBe("gym");
    expect(modeFromPath("/gym/history/3")).toBe("gym");
    expect(modeFromPath("/settings")).toBeNull();
  });

  it("remembers the last page of each mode", () => {
    expect(lastPath("gym")).toBe("/gym");
    expect(lastPath("diet")).toBe("/");
    rememberPath("/gym/exercises", "");
    rememberPath("/week", "?start=2026-09-21");
    expect(lastPath("gym")).toBe("/gym/exercises");
    expect(lastPath("diet")).toBe("/week?start=2026-09-21");
  });

  it("keeps the last mode on shared pages", () => {
    rememberPath("/gym", "");
    expect(currentMode("/settings")).toBe("gym");
    rememberPath("/", "");
    expect(currentMode("/settings")).toBe("diet");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (from `web/`): `npx vitest run src/lib/gym.test.ts src/lib/restTimer.test.ts src/lib/appMode.test.ts`
Expected: FAIL — cannot resolve `./gym`, `./restTimer`, `./appMode`.

- [ ] **Step 3: Write `web/src/api/gym.ts`**

```ts
import { useContext } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { liveErrorMessage } from "../lib/gym";
import { LiveErrorContext } from "../lib/liveErrors";
import { ApiError, client } from "./client";

/** What a set of an exercise records. Mirrors the backend's `Tracking` enum. */
export type Tracking = "weight_reps" | "reps" | "duration";

export interface Exercise {
  id: number;
  name: string;
  equipment: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  category: string | null;
  tracking: Tracking;
  custom: boolean;
}

export interface ExerciseDetail extends Exercise {
  instructions: string[];
}

export interface ExerciseList {
  items: Exercise[];
  total: number;
}

export interface ExerciseInput {
  name: string;
  equipment: string | null;
  primary_muscle: string | null;
  tracking: Tracking;
}

export interface ExerciseFilters {
  q: string;
  equipment: string;
  muscle: string;
}

export const EMPTY_FILTERS: ExerciseFilters = { q: "", equipment: "", muscle: "" };

export interface SetValues {
  weight_kg: number | null;
  reps: number | null;
  duration_s: number | null;
}

export interface TemplateExercise {
  id: number;
  exercise: Exercise;
  rest_seconds: number;
  superset_group: number | null;
  note: string | null;
  sets: SetValues[];
}

export interface Template {
  id: number;
  name: string;
  folder_id: number | null;
  last_used_at: string | null;
  exercises: TemplateExercise[];
}

export interface TemplateSummary {
  id: number;
  name: string;
  folder_id: number | null;
  last_used_at: string | null;
  exercise_names: string[];
}

export interface Folder {
  id: number;
  name: string;
  position: number;
}

export interface TemplatesResponse {
  folders: Folder[];
  templates: TemplateSummary[];
}

export interface TemplateExerciseInput {
  exercise_id: number;
  rest_seconds: number;
  superset_group: number | null;
  note: string | null;
  sets: SetValues[];
}

export interface TemplateInput {
  name: string;
  folder_id: number | null;
  exercises: TemplateExerciseInput[];
}

export interface WorkoutSet extends SetValues {
  id: number;
  completed_at: string | null;
  /** Same position in the last finished workout with this exercise. */
  previous: SetValues | null;
}

export interface WorkoutExercise {
  id: number;
  exercise: Exercise;
  rest_seconds: number;
  superset_group: number | null;
  note: string | null;
  sets: WorkoutSet[];
}

export interface Workout {
  id: number;
  name: string;
  template_id: number | null;
  status: "in_progress" | "finished";
  started_at: string;
  finished_at: string | null;
  rest_ends_at: string | null;
  rest_total_s: number | null;
  /** Server clock when the response was built: used to correct the phone's clock. */
  server_now: string;
  exercises: WorkoutExercise[];
  /** Finished workouts made from a template: readable differences from it. */
  template_diff: string[];
}

export interface HistoryItem {
  id: number;
  name: string;
  started_at: string;
  finished_at: string;
  exercises: { name: string; sets: number }[];
}

export interface HistoryPage {
  items: HistoryItem[];
  next_before: string | null;
}

export interface LayoutItem {
  id: number;
  superset_group: number | null;
}

export type RestAction = { start_s: number } | { delta_s: number } | { skip: true };

export const gymKeys = {
  exercises: (filters: ExerciseFilters) => ["gym", "exercises", filters] as const,
  exercise: (id: number) => ["gym", "exercise", id] as const,
  templates: ["gym", "templates"] as const,
  template: (id: number) => ["gym", "template", id] as const,
  active: ["gym", "workout", "active"] as const,
  workout: (id: number) => ["gym", "workout", id] as const,
  history: ["gym", "history"] as const,
};

function exercisesPath(filters: ExerciseFilters): string {
  const params = new URLSearchParams({ limit: "200" });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.equipment) params.set("equipment", filters.equipment);
  if (filters.muscle) params.set("muscle", filters.muscle);
  return `/exercises?${params.toString()}`;
}

// ---- exercises ----

export function useExercises(filters: ExerciseFilters) {
  return useQuery({
    queryKey: gymKeys.exercises(filters),
    queryFn: () => client.get<ExerciseList>(exercisesPath(filters)),
    placeholderData: (previous) => previous,
  });
}

export function useExercise(id: number | null) {
  return useQuery({
    queryKey: gymKeys.exercise(id ?? 0),
    queryFn: () => client.get<ExerciseDetail>(`/exercises/${id}`),
    enabled: id !== null,
  });
}

export function useCreateExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ExerciseInput) => client.post<ExerciseDetail>("/exercises", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["gym", "exercises"] }),
  });
}

export function useUpdateExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ExerciseInput & { id: number }) =>
      client.patch<ExerciseDetail>(`/exercises/${id}`, input),
    onSuccess: (exercise) => {
      queryClient.setQueryData(gymKeys.exercise(exercise.id), exercise);
      void queryClient.invalidateQueries({ queryKey: ["gym", "exercises"] });
    },
  });
}

export function useArchiveExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => client.delete<void>(`/exercises/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["gym", "exercises"] }),
  });
}

// ---- templates and folders ----

export function useTemplates() {
  return useQuery({
    queryKey: gymKeys.templates,
    queryFn: () => client.get<TemplatesResponse>("/templates"),
  });
}

export function useTemplate(id: number | null) {
  return useQuery({
    queryKey: gymKeys.template(id ?? 0),
    queryFn: () => client.get<Template>(`/templates/${id}`),
    enabled: id !== null,
  });
}

function useTemplateMutation<V, R>(mutationFn: (variables: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gymKeys.templates });
      void queryClient.invalidateQueries({ queryKey: ["gym", "template"] });
    },
  });
}

export const useCreateTemplate = () =>
  useTemplateMutation((input: TemplateInput) => client.post<Template>("/templates", input));

export const useReplaceTemplate = () =>
  useTemplateMutation(({ id, input }: { id: number; input: TemplateInput }) =>
    client.put<Template>(`/templates/${id}`, input),
  );

export const usePatchTemplate = () =>
  useTemplateMutation(
    ({ id, ...patch }: { id: number; name?: string; folder_id?: number | null }) =>
      client.patch<Template>(`/templates/${id}`, patch),
  );

export const useDeleteTemplate = () =>
  useTemplateMutation((id: number) => client.delete<void>(`/templates/${id}`));

export const useDuplicateTemplate = () =>
  useTemplateMutation((id: number) => client.post<Template>(`/templates/${id}/duplicate`));

export const useCreateFolder = () =>
  useTemplateMutation((name: string) => client.post<Folder>("/template-folders", { name }));

export const useRenameFolder = () =>
  useTemplateMutation(({ id, name }: { id: number; name: string }) =>
    client.patch<Folder>(`/template-folders/${id}`, { name }),
  );

export const useDeleteFolder = () =>
  useTemplateMutation((id: number) => client.delete<void>(`/template-folders/${id}`));

// ---- workouts ----

export function useActiveWorkout(enabled = true) {
  return useQuery({
    queryKey: gymKeys.active,
    // 204 (no live workout) comes back as `undefined`; react-query needs null.
    queryFn: async () => (await client.get<Workout | undefined>("/workouts/active")) ?? null,
    enabled,
  });
}

export function useWorkout(id: number) {
  return useQuery({
    queryKey: gymKeys.workout(id),
    queryFn: () => client.get<Workout>(`/workouts/${id}`),
  });
}

interface WorkoutRef {
  workoutId: number;
}

/** Every live-session endpoint; each answers with the whole workout. */
export const gymApi = {
  renameWorkout: ({ workoutId, name }: WorkoutRef & { name: string }) =>
    client.patch<Workout>(`/workouts/${workoutId}`, { name }),
  addExercise: ({ workoutId, exerciseId }: WorkoutRef & { exerciseId: number }) =>
    client.post<Workout>(`/workouts/${workoutId}/exercises`, { exercise_id: exerciseId }),
  patchExercise: ({
    workoutId,
    id,
    ...body
  }: WorkoutRef & { id: number; exercise_id?: number; rest_seconds?: number; note?: string | null }) =>
    client.patch<Workout>(`/workouts/${workoutId}/exercises/${id}`, body),
  removeExercise: ({ workoutId, id }: WorkoutRef & { id: number }) =>
    client.delete<Workout>(`/workouts/${workoutId}/exercises/${id}`),
  setLayout: ({ workoutId, items }: WorkoutRef & { items: LayoutItem[] }) =>
    client.put<Workout>(`/workouts/${workoutId}/layout`, { items }),
  addSet: ({ workoutId, exerciseId }: WorkoutRef & { exerciseId: number }) =>
    client.post<Workout>(`/workouts/${workoutId}/exercises/${exerciseId}/sets`),
  patchSet: ({ workoutId, id, values }: WorkoutRef & { id: number; values: SetValues }) =>
    client.patch<Workout>(`/workouts/${workoutId}/sets/${id}`, values),
  deleteSet: ({ workoutId, id }: WorkoutRef & { id: number }) =>
    client.delete<Workout>(`/workouts/${workoutId}/sets/${id}`),
  completeSet: ({ workoutId, id, values }: WorkoutRef & { id: number; values: SetValues }) =>
    client.post<Workout>(`/workouts/${workoutId}/sets/${id}/complete`, values),
  uncompleteSet: ({ workoutId, id }: WorkoutRef & { id: number }) =>
    client.post<Workout>(`/workouts/${workoutId}/sets/${id}/uncomplete`),
  rest: ({ workoutId, action }: WorkoutRef & { action: RestAction }) =>
    client.post<Workout>(`/workouts/${workoutId}/rest`, action),
};

/** A live-session edit: runs in the single "live-workout" queue (so responses
 * land in the order the edits were made), retries network failures, writes
 * the returned workout into the cache and reports errors to the page. */
export function useLiveMutation<V>(mutationFn: (variables: V) => Promise<Workout>) {
  const queryClient = useQueryClient();
  const report = useContext(LiveErrorContext);
  return useMutation({
    mutationFn,
    scope: { id: "live-workout" },
    retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 2,
    onSuccess: (workout) => queryClient.setQueryData(gymKeys.active, workout),
    onError: (error) => report(liveErrorMessage(error)),
  });
}

export function useStartWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: number | null) =>
      client.post<Workout>("/workouts", { template_id: templateId }),
    onSuccess: (workout) => {
      queryClient.setQueryData(gymKeys.active, workout);
      void queryClient.invalidateQueries({ queryKey: gymKeys.templates });
    },
  });
}

export function useFinishWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workoutId, discardIncomplete }: WorkoutRef & { discardIncomplete: boolean }) =>
      client.post<Workout>(`/workouts/${workoutId}/finish`, {
        discard_incomplete: discardIncomplete,
      }),
    // Same queue as the live edits: pending set saves reach the server first.
    scope: { id: "live-workout" },
    onSuccess: (workout) => {
      queryClient.setQueryData(gymKeys.active, null);
      queryClient.setQueryData(gymKeys.workout(workout.id), workout);
      void queryClient.invalidateQueries({ queryKey: gymKeys.history });
    },
  });
}

export function useCancelWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workoutId: number) => client.delete<void>(`/workouts/${workoutId}`),
    scope: { id: "live-workout" },
    onSuccess: () => queryClient.setQueryData(gymKeys.active, null),
  });
}

export function useHistory() {
  return useInfiniteQuery({
    queryKey: gymKeys.history,
    queryFn: ({ pageParam }) =>
      client.get<HistoryPage>(
        `/workouts?limit=20${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before,
  });
}

function useWorkoutTemplateMutation<V>(mutationFn: (variables: V) => Promise<Template>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gymKeys.templates });
      void queryClient.invalidateQueries({ queryKey: ["gym", "template"] });
      void queryClient.invalidateQueries({ queryKey: ["gym", "workout"] });
    },
  });
}

export const useApplyToTemplate = () =>
  useWorkoutTemplateMutation((workoutId: number) =>
    client.post<Template>(`/workouts/${workoutId}/apply-to-template`),
  );

export const useSaveAsTemplate = () =>
  useWorkoutTemplateMutation(({ workoutId, name }: WorkoutRef & { name: string }) =>
    client.post<Template>(`/workouts/${workoutId}/save-as-template`, { name }),
  );

export function useDeleteWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workoutId: number) => client.delete<void>(`/workouts/${workoutId}`),
    onSuccess: (_data, workoutId) => {
      queryClient.removeQueries({ queryKey: gymKeys.workout(workoutId) });
      void queryClient.invalidateQueries({ queryKey: gymKeys.history });
    },
  });
}
```

- [ ] **Step 4: Write the libraries**

`web/src/lib/liveErrors.ts`:

```ts
import { createContext } from "react";

/** Where live-session mutations report a failure (the workout page shows a toast). */
export const LiveErrorContext = createContext<(message: string) => void>(() => {});
```

`web/src/lib/useNow.ts`:

```ts
import { useEffect, useState } from "react";

/** `Date.now()`, refreshed every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
```

`web/src/lib/useDebounced.ts`:

```ts
import { useEffect, useState } from "react";

/** `value`, but only after it has stopped changing for `delayMs`. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
```

`web/src/lib/restTimer.ts`:

```ts
/** Rest-timer helpers. The countdown is derived from the absolute
 * `rest_ends_at` the server stores, corrected by the offset between the
 * server clock and the phone clock, so it stays right after the screen
 * sleeps or the page reloads. */

export function clockOffsetMs(serverNowIso: string, clientNowMs: number): number {
  return Date.parse(serverNowIso) - clientNowMs;
}

export function remainingSeconds(
  restEndsAtIso: string | null,
  offsetMs: number,
  clientNowMs: number,
): number {
  if (!restEndsAtIso) return 0;
  const ms = Date.parse(restEndsAtIso) - (clientNowMs + offsetMs);
  return ms <= 0 ? 0 : Math.ceil(ms / 1000);
}

type AudioContextCtor = typeof AudioContext;

let audioContext: AudioContext | null = null;

/** iOS only plays WebAudio after a user gesture: call this from a tap. */
export function unlockAudio(): void {
  try {
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    if (audioContext.state === "suspended") void audioContext.resume();
  } catch {
    // Audio is a nicety; the visual countdown still works.
  }
}

/** Two short beeps. Silent if audio was never unlocked. */
export function beep(): void {
  if (!audioContext) return;
  try {
    for (const offset of [0, 0.3]) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = 880;
      gain.gain.value = 0.2;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      const start = audioContext.currentTime + offset;
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    }
  } catch {
    // ignore
  }
}

export function vibrate(): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([200, 100, 200]);
  }
}
```

`web/src/lib/appMode.ts`:

```ts
/** The app has two sections sharing one shell: the food diary ("diet") and
 * the gym ("gym"). The mode follows the URL; shared pages (settings,
 * account, admin) keep the last one. Each mode remembers its last page so
 * the header switch returns where the user left off. */

export type AppMode = "diet" | "gym";

const MODE_KEY = "yfp.mode";
const pathKey = (mode: AppMode) => `yfp.lastPath.${mode}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / blocked storage: the switch just falls back to defaults.
  }
}

export function modeFromPath(pathname: string): AppMode | null {
  if (pathname === "/gym" || pathname.startsWith("/gym/")) return "gym";
  if (pathname === "/" || pathname.startsWith("/week") || pathname.startsWith("/search")) {
    return "diet";
  }
  return null;
}

export function currentMode(pathname: string): AppMode {
  return modeFromPath(pathname) ?? (read(MODE_KEY) === "gym" ? "gym" : "diet");
}

export function rememberPath(pathname: string, search: string): void {
  const mode = modeFromPath(pathname);
  if (!mode) return;
  write(MODE_KEY, mode);
  write(pathKey(mode), pathname + search);
}

export function lastPath(mode: AppMode): string {
  return read(pathKey(mode)) ?? (mode === "gym" ? "/gym" : "/");
}
```

`web/src/lib/gym.ts`:

```ts
import { ApiError } from "../api/client";
import type { Exercise, SetValues, Tracking } from "../api/gym";

export const EQUIPMENT_LABELS: Record<string, string> = {
  bands: "Elastici",
  barbell: "Bilanciere",
  "body only": "Corpo libero",
  cable: "Cavi",
  dumbbell: "Manubri",
  "e-z curl bar": "Bilanciere EZ",
  "exercise ball": "Fitball",
  "foam roll": "Foam roller",
  kettlebells: "Kettlebell",
  machine: "Macchina",
  "medicine ball": "Palla medica",
  other: "Altro",
};

export const MUSCLE_LABELS: Record<string, string> = {
  abdominals: "Addominali",
  abductors: "Abduttori",
  adductors: "Adduttori",
  biceps: "Bicipiti",
  calves: "Polpacci",
  chest: "Petto",
  forearms: "Avambracci",
  glutes: "Glutei",
  hamstrings: "Femorali",
  lats: "Dorsali",
  "lower back": "Lombari",
  "middle back": "Dorso centrale",
  neck: "Collo",
  quadriceps: "Quadricipiti",
  shoulders: "Spalle",
  traps: "Trapezi",
  triceps: "Tricipiti",
};

export const TRACKING_LABELS: Record<Tracking, string> = {
  weight_reps: "Peso × ripetizioni",
  reps: "Solo ripetizioni",
  duration: "Durata",
};

export function equipmentLabel(value: string | null): string | null {
  return value ? (EQUIPMENT_LABELS[value] ?? value) : null;
}

export function muscleLabel(value: string): string {
  return MUSCLE_LABELS[value] ?? value;
}

export function exerciseSubtitle(exercise: Exercise): string {
  const parts = [equipmentLabel(exercise.equipment)];
  if (exercise.primary_muscles[0]) parts.push(muscleLabel(exercise.primary_muscles[0]));
  return parts.filter(Boolean).join(" · ");
}

export type SetField = keyof SetValues;

export const FIELD_META: Record<SetField, { label: string; kind: "decimal" | "integer" | "duration" }> = {
  weight_kg: { label: "kg", kind: "decimal" },
  reps: { label: "Rip.", kind: "integer" },
  duration_s: { label: "Tempo", kind: "duration" },
};

/** The inputs a set of this exercise shows, left to right. */
export function setFields(tracking: Tracking): SetField[] {
  if (tracking === "weight_reps") return ["weight_kg", "reps"];
  if (tracking === "reps") return ["reps"];
  return ["duration_s"];
}

/** CSS grid columns of a set row: number | previous | inputs... | tick. */
export function setGridColumns(fieldCount: number): string {
  return `2.25rem minmax(0,1.3fr) repeat(${fieldCount}, minmax(0,1fr)) 2.75rem`;
}

export function formatKg(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function parseInteger(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "m:ss", or a plain number of seconds. */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim();
  const match = /^(\d+):([0-5]\d)$/.exec(trimmed);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** Same text as the API's `format_set` ("80 kg × 8", "12 rip", "1:15"). */
export function formatSet(tracking: Tracking, values: SetValues): string {
  if (tracking === "duration") return formatDuration(values.duration_s ?? 0);
  if (tracking === "reps" && values.weight_kg === null) return `${values.reps ?? 0} rip`;
  return `${formatKg(values.weight_kg ?? 0)} kg × ${values.reps ?? 0}`;
}

/** Rest choices: 0:00 to 10:00 in 15 s steps. */
export const REST_OPTIONS: number[] = Array.from({ length: 41 }, (_, i) => i * 15);

export function restLabel(seconds: number): string {
  return seconds === 0 ? "Off" : formatDuration(seconds);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function elapsedLabel(startIso: string, nowMs: number): string {
  const total = Math.max(0, Math.floor((nowMs - Date.parse(startIso)) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function durationLabel(startIso: string, endIso: string): string {
  const minutes = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function lastUsedLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return "Oggi";
  if (days === 1) return "Ieri";
  if (days < 7) return `${days} giorni fa`;
  return then.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
}

export function workoutDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

/** Mirror of the API's `normalize_supersets`: runs of equal values become
 * groups 1..n, a lone member becomes null. */
export function normalizeSupersets(groups: (number | null)[]): (number | null)[] {
  const result: (number | null)[] = groups.map(() => null);
  let next = 1;
  let start = 0;
  while (start < groups.length) {
    let end = start;
    if (groups[start] !== null) {
      while (end + 1 < groups.length && groups[end + 1] === groups[start]) end += 1;
    }
    if (end > start) {
      for (let i = start; i <= end; i += 1) result[i] = next;
      next += 1;
    }
    start = end + 1;
  }
  return result;
}

export function linkWithNext(groups: (number | null)[], index: number): (number | null)[] {
  if (index + 1 >= groups.length) return normalizeSupersets(groups);
  const result = [...groups];
  const used = result.filter((g): g is number => g !== null);
  const group = result[index] ?? result[index + 1] ?? (used.length ? Math.max(...used) + 1 : 1);
  const nextGroup = result[index + 1];
  if (nextGroup !== null && nextGroup !== group) {
    for (let i = index + 1; i < result.length && result[i] === nextGroup; i += 1) result[i] = group;
  } else {
    result[index + 1] = group;
  }
  result[index] = group;
  return normalizeSupersets(result);
}

export function unlinkFromGroup(groups: (number | null)[], index: number): (number | null)[] {
  const result = [...groups];
  result[index] = null;
  return normalizeSupersets(result);
}

export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const result = [...items];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

const LIVE_ERRORS: Record<string, string> = {
  "weight and reps are required": "Inserisci kg e ripetizioni",
  "reps are required": "Inserisci le ripetizioni",
  "duration is required": "Inserisci la durata",
  "no rest timer running": "Nessun timer attivo",
  "workout is not in progress": "L'allenamento è già terminato",
  empty_workout: "Nessuna serie completata",
  incomplete_sets: "Ci sono serie non completate",
};

export function liveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return LIVE_ERRORS[error.message] ?? error.message;
  return "Non salvato: controlla la connessione";
}
```

- [ ] **Step 5: Run the tests and the build**

Run (from `web/`): `npx vitest run src/lib/gym.test.ts src/lib/restTimer.test.ts src/lib/appMode.test.ts` → PASS; then `npm test` → all pass; `npm run build` → success.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/gym.ts web/src/lib/gym.ts web/src/lib/gym.test.ts web/src/lib/restTimer.ts web/src/lib/restTimer.test.ts web/src/lib/appMode.ts web/src/lib/appMode.test.ts web/src/lib/liveErrors.ts web/src/lib/useNow.ts web/src/lib/useDebounced.ts
git commit -m "feat(web): gym API client, formatting, rest-timer and app-mode helpers"
```

---

### Task 9: Web — selettore Dieta/Palestra, tab bar, rotte e barra "Allenamento in corso"

**Files:**
- Create: `web/src/components/ModeSwitch.tsx`, `web/src/components/ModeSwitch.test.tsx`
- Create: `web/src/components/gym/ActiveWorkoutBar.tsx`
- Create: `web/src/auth/PermissionGuard.tsx`
- Create (stubs, replaced by later tasks): `web/src/pages/gym/GymStartPage.tsx`, `ExercisesPage.tsx`, `HistoryPage.tsx`, `WorkoutDetailPage.tsx`, `TemplateEditorPage.tsx`, `WorkoutPage.tsx`
- Modify: `web/src/components/AppShell.tsx`, `web/src/components/AppShell.test.tsx`, `web/src/App.tsx`
- Modify: headers of `web/src/pages/DayPage.tsx`, `WeekPage.tsx`, `SettingsPage.tsx`, `AccountPage.tsx`

**Interfaces:**
- Consumes: `currentMode`, `lastPath`, `rememberPath` (Task 8); `useActiveWorkout` (Task 8); `elapsedLabel`, `useNow` (Task 8); `useHasPermission` (existing).
- Produces: `<ModeSwitch />` (renders nothing without `workouts.use`); `<PermissionGuard permission="..." />`; routes `/gym`, `/gym/exercises`, `/gym/history`, `/gym/history/:id`, `/gym/templates/new`, `/gym/templates/:id` (inside `AppShell`) and `/gym/workout` (full screen, outside `AppShell`); default-exported page components with those file names.

- [ ] **Step 1: Write the failing tests**

`web/src/components/ModeSwitch.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHasPermission } from "../auth/AuthContext";
import ModeSwitch from "./ModeSwitch";

vi.mock("../auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../auth/AuthContext")>("../auth/AuthContext");
  return { ...actual, useHasPermission: vi.fn() };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ModeSwitch />
    </MemoryRouter>,
  );
}

describe("ModeSwitch", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders nothing without the gym permission", () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    const { container } = renderAt("/");
    expect(container).toBeEmptyDOMElement();
  });

  it("links to the other section's last page", () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    window.localStorage.setItem("yfp.lastPath.gym", "/gym/history");
    renderAt("/");
    expect(screen.getByRole("link", { name: "Dieta" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Palestra" })).toHaveAttribute("href", "/gym/history");
  });
});
```

Update `web/src/components/AppShell.test.tsx`: add these mocks at the top (after the imports) and two new tests; the existing tests stay unchanged.

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHasPermission } from "../auth/AuthContext";

vi.mock("../auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../auth/AuthContext")>("../auth/AuthContext");
  return { ...actual, useHasPermission: vi.fn(() => false) };
});

vi.mock("./gym/ActiveWorkoutBar", () => ({
  default: () => <div data-testid="active-workout-bar" />,
}));
```

In `renderShell`, add the gym routes next to the existing ones:

```tsx
          <Route path="/gym" element={<div>Gym Page</div>} />
          <Route path="/gym/history" element={<div>History Page</div>} />
```

Add `beforeEach(() => { window.localStorage.clear(); vi.mocked(useHasPermission).mockReturnValue(false); });` inside the `describe`, and these tests:

```tsx
  it("shows the gym tabs on gym pages", () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    renderShell("/gym");

    expect(screen.getByRole("link", { name: "Storico" })).toHaveAttribute("href", "/gym/history");
    expect(screen.getByRole("link", { name: "Inizia" })).toHaveAttribute("href", "/gym");
    expect(screen.getByRole("link", { name: "Esercizi" })).toHaveAttribute("href", "/gym/exercises");
    expect(screen.getByRole("link", { name: "Impostazioni" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("link", { name: "Giorno" })).not.toBeInTheDocument();
    expect(screen.getByTestId("active-workout-bar")).toBeInTheDocument();
  });

  it("keeps the gym tabs on settings after visiting the gym", async () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    const user = userEvent.setup();
    renderShell("/gym");

    await user.click(screen.getByRole("link", { name: "Impostazioni" }));

    expect(screen.getByText("Settings Page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Storico" })).toBeInTheDocument();
  });
```

(Replace the file's existing `import { describe, expect, it } from "vitest";` with the `vitest` import above.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/ModeSwitch.test.tsx src/components/AppShell.test.tsx`
Expected: FAIL — `./ModeSwitch` not found; the gym tab tests fail.

- [ ] **Step 3: Write `ModeSwitch`, `PermissionGuard` and `ActiveWorkoutBar`**

`web/src/components/ModeSwitch.tsx`:

```tsx
import { Link, useLocation } from "react-router-dom";

import { useHasPermission } from "../auth/AuthContext";
import { type AppMode, currentMode, lastPath } from "../lib/appMode";

const MODES: { mode: AppMode; label: string }[] = [
  { mode: "diet", label: "Dieta" },
  { mode: "gym", label: "Palestra" },
];

/** Segmented "Dieta | Palestra" control at the top of each section's page
 * headers. Switching goes back to the last page seen in that section.
 * Hidden for accounts without the gym permission. */
function ModeSwitch() {
  const canGym = useHasPermission("workouts.use");
  const { pathname, search } = useLocation();
  if (!canGym) return null;
  const mode = currentMode(pathname);
  return (
    <div className="mx-auto flex max-w-2xl justify-center px-4 pt-2">
      <div role="group" aria-label="Sezione" className="inline-flex rounded-lg bg-slate-200/70 p-0.5">
        {MODES.map((item) => (
          <Link
            key={item.mode}
            to={item.mode === mode ? pathname + search : lastPath(item.mode)}
            aria-current={item.mode === mode ? "page" : undefined}
            className={`rounded-md px-5 py-1 text-[13px] font-semibold transition ${
              item.mode === mode ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default ModeSwitch;
```

`web/src/auth/PermissionGuard.tsx`:

```tsx
import { Navigate, Outlet } from "react-router-dom";

import type { Permission } from "../lib/permissions";
import { useHasPermission } from "./AuthContext";

export default function PermissionGuard({ permission }: { permission: Permission }) {
  return useHasPermission(permission) ? <Outlet /> : <Navigate to="/" replace />;
}
```

`web/src/components/gym/ActiveWorkoutBar.tsx`:

```tsx
import { Link } from "react-router-dom";

import { useActiveWorkout } from "../../api/gym";
import { elapsedLabel } from "../../lib/gym";
import { useNow } from "../../lib/useNow";

/** Green strip above the tab bar while a workout is live, on every page of
 * both sections; tapping it reopens the session. */
function ActiveWorkoutBar() {
  const { data: workout } = useActiveWorkout();
  const now = useNow(1000);
  if (!workout) return null;
  return (
    <>
      <div aria-hidden className="h-11" />
      <Link
        to="/gym/workout"
        className="fixed inset-x-0 bottom-[var(--nav-height)] z-30 flex items-center justify-between gap-3 bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sheet"
      >
        <span className="truncate">Allenamento in corso · {workout.name}</span>
        <span className="tabular-nums">{elapsedLabel(workout.started_at, now)}</span>
      </Link>
    </>
  );
}

export default ActiveWorkoutBar;
```

- [ ] **Step 4: Rewrite `AppShell`**

Replace `web/src/components/AppShell.tsx` with:

```tsx
import { type ReactNode, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { useHasPermission } from "../auth/AuthContext";
import { currentMode, rememberPath } from "../lib/appMode";
import ActiveWorkoutBar from "./gym/ActiveWorkoutBar";

interface Tab {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

/** Tab icons: 24px stroked line icons (Apple's tab bars are icon-first,
 * label-second -- a bar of four bare words is hard to scan and gives no
 * anchor for muscle memory). `currentColor` so the active/inactive tint is
 * driven entirely by the link's text colour. */
const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-6 w-6",
  "aria-hidden": true,
};

const SETTINGS_TAB: Tab = {
  to: "/settings",
  label: "Impostazioni",
  icon: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  ),
};

const DIET_TABS: Tab[] = [
  {
    to: "/",
    label: "Giorno",
    end: true,
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    to: "/search",
    label: "Cerca",
    icon: (
      <svg {...iconProps}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    ),
  },
  {
    to: "/week",
    label: "Settimana",
    icon: (
      <svg {...iconProps}>
        <path d="M4 19V9M10 19V5M16 19v-7M4 19h16" />
      </svg>
    ),
  },
  SETTINGS_TAB,
];

const GYM_TABS: Tab[] = [
  {
    to: "/gym/history",
    label: "Storico",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    to: "/gym",
    label: "Inizia",
    end: true,
    icon: (
      <svg {...iconProps}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    to: "/gym/exercises",
    label: "Esercizi",
    icon: (
      <svg {...iconProps}>
        <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
      </svg>
    ),
  },
  SETTINGS_TAB,
];

/** Persistent app shell for every authenticated route: renders the current
 * page via `<Outlet>` plus a bottom navigation bar. The bar shows the diet
 * tabs or the gym tabs depending on the section (see lib/appMode.ts); shared
 * pages such as settings keep the last section's tabs.
 *
 * iOS layout notes: the bar is translucent + blurred (content scrolls
 * visibly under it, as in a native tab bar) and pads itself by
 * `env(safe-area-inset-bottom)`, so on a gesture-navigation iPhone the
 * labels sit ABOVE the home indicator instead of underneath it. Page
 * content is padded by the resulting total height (`--nav-height`, see
 * index.css) so the last row of any page is never hidden by the bar. */
function AppShell() {
  const { pathname, search } = useLocation();
  const canGym = useHasPermission("workouts.use");

  useEffect(() => {
    rememberPath(pathname, search);
  }, [pathname, search]);

  const tabs = canGym && currentMode(pathname) === "gym" ? GYM_TABS : DIET_TABS;

  return (
    <div className="min-h-screen bg-app pb-[calc(var(--nav-height)+0.5rem)]">
      <Outlet />
      {canGym && <ActiveWorkoutBar />}
      <nav
        aria-label="Navigazione principale"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200/80 bg-white/85 backdrop-blur-xl pb-[var(--safe-bottom)]"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex h-[var(--nav-content-height)] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                isActive ? "text-brand-600" : "text-slate-400"
              }`
            }
          >
            {tab.icon}
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default AppShell;
```

- [ ] **Step 5: Add the page stubs and the routes**

Create each stub below (Tasks 10–14 replace them entirely). Example for `web/src/pages/gym/GymStartPage.tsx`; the others are identical except for the component name and title — `ExercisesPage` ("Esercizi"), `HistoryPage` ("Storico"), `WorkoutDetailPage` ("Allenamento"), `TemplateEditorPage` ("Modello"), `WorkoutPage` ("Allenamento in corso"):

```tsx
import ModeSwitch from "../../components/ModeSwitch";

function GymStartPage() {
  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3">
          <h1 className="text-[17px] font-semibold text-slate-900">Inizia allenamento</h1>
        </div>
      </header>
    </div>
  );
}

export default GymStartPage;
```

In `web/src/App.tsx` import `PermissionGuard` and the six pages, then change the protected routes block to:

```tsx
          <Route element={<AuthGuard />}>
            <Route element={<PermissionGuard permission="workouts.use" />}>
              <Route path="/gym/workout" element={<WorkoutPage />} />
            </Route>
            <Route element={<AppShell />}>
              <Route path="/" element={<DayPage />} />
              <Route path="/week" element={<WeekPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route element={<PermissionGuard permission="workouts.use" />}>
                <Route path="/gym" element={<GymStartPage />} />
                <Route path="/gym/exercises" element={<ExercisesPage />} />
                <Route path="/gym/history" element={<HistoryPage />} />
                <Route path="/gym/history/:id" element={<WorkoutDetailPage />} />
                <Route path="/gym/templates/new" element={<TemplateEditorPage />} />
                <Route path="/gym/templates/:id" element={<TemplateEditorPage />} />
              </Route>
              <Route element={<AdminGuard />}>
                <Route path="/admin/users" element={<AdminUsersPage />} />
              </Route>
            </Route>
          </Route>
```

- [ ] **Step 6: Put the switch in the diet headers**

In `DayPage.tsx`, `WeekPage.tsx`, `SettingsPage.tsx` and `AccountPage.tsx`, add `import ModeSwitch from "../components/ModeSwitch";` and insert `<ModeSwitch />` as the **first child** of the `<header className="app-header">` element. (`AccountPage`'s header is on one line: change `<header className="app-header"><div ...>` to `<header className="app-header"><ModeSwitch /><div ...>`.) `SearchPage` is a sub-flow of the diary and does not get the switch.

- [ ] **Step 7: Run tests and build**

Run: `npm test` → all pass (existing page tests render without the permission, so `ModeSwitch` renders nothing); `npm run build` → success.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/ModeSwitch.tsx web/src/components/ModeSwitch.test.tsx web/src/components/gym/ActiveWorkoutBar.tsx web/src/auth/PermissionGuard.tsx web/src/components/AppShell.tsx web/src/components/AppShell.test.tsx web/src/App.tsx web/src/pages/gym web/src/pages/DayPage.tsx web/src/pages/WeekPage.tsx web/src/pages/SettingsPage.tsx web/src/pages/AccountPage.tsx
git commit -m "feat(web): Dieta/Palestra switch, gym tab bar, routes and live-workout bar"
```

---
### Task 10: Web — pagina Esercizi, selettore esercizi, esercizi custom

**Files:**
- Create: `web/src/components/gym/Sheet.tsx`
- Create: `web/src/components/gym/ActionMenu.tsx`
- Create: `web/src/components/gym/ExerciseFilterBar.tsx`
- Create: `web/src/components/gym/ExerciseList.tsx`
- Create: `web/src/components/gym/CustomExerciseForm.tsx`, `web/src/components/gym/CustomExerciseForm.test.tsx`
- Create: `web/src/components/gym/ExerciseDetailSheet.tsx`
- Create: `web/src/components/gym/ExercisePicker.tsx`, `web/src/components/gym/ExercisePicker.test.tsx`
- Replace: `web/src/pages/gym/ExercisesPage.tsx`

**Interfaces:**
- Consumes: `useExercises`, `useExercise`, `useCreateExercise`, `useUpdateExercise`, `useArchiveExercise`, `EMPTY_FILTERS`, types (Task 8); `EQUIPMENT_LABELS`, `MUSCLE_LABELS`, `TRACKING_LABELS`, `equipmentLabel`, `muscleLabel`, `exerciseSubtitle` (Task 8); `useDebounced` (Task 8); `ModeSwitch` (Task 9).
- Produces:
  - `Sheet({ title, onClose, children, footer?, full?, headerAction? })` — bottom sheet dialog.
  - `ActionMenu({ label, actions, trigger?, triggerClassName? })` with `export interface Action { label: string; onSelect: () => void; destructive?: boolean }`.
  - `ExerciseFilterBar({ value, onChange })`.
  - `ExerciseList({ query, selectedIds?, onSelect })` where `query` is the `useExercises` result.
  - `CustomExerciseForm({ initial?, onClose, onSaved })`.
  - `ExerciseDetailSheet({ exerciseId, onClose })`.
  - `ExercisePicker({ title?, multiple?, onPick, onClose })` — `onPick(exercises: Exercise[])`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/gym/ExercisePicker.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Exercise } from "../../api/gym";
import { useExercises } from "../../api/gym";
import ExercisePicker from "./ExercisePicker";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return { ...actual, useExercises: vi.fn() };
});

vi.mock("./CustomExerciseForm", () => ({ default: () => <div data-testid="custom-form" /> }));

const squat: Exercise = {
  id: 1, name: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"],
  secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
};
const curl: Exercise = { ...squat, id: 2, name: "Dumbbell Curl", equipment: "dumbbell", primary_muscles: ["biceps"] };

describe("ExercisePicker", () => {
  beforeEach(() => {
    vi.mocked(useExercises).mockReturnValue({
      data: { items: [squat, curl], total: 2 }, isLoading: false, isError: false,
    } as unknown as ReturnType<typeof useExercises>);
  });

  it("returns every selected exercise in multiple mode", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ExercisePicker onPick={onPick} onClose={vi.fn()} />);

    expect(screen.getByText("Bilanciere · Quadricipiti")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Barbell Squat/ }));
    await user.click(screen.getByRole("button", { name: /Dumbbell Curl/ }));
    await user.click(screen.getByRole("button", { name: "Aggiungi (2)" }));

    expect(onPick).toHaveBeenCalledWith([squat, curl]);
  });

  it("returns right away in single mode", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ExercisePicker multiple={false} onPick={onPick} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Dumbbell Curl/ }));

    expect(onPick).toHaveBeenCalledWith([curl]);
  });

  it("opens the custom exercise form", async () => {
    const user = userEvent.setup();
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "+ Nuovo" }));
    expect(screen.getByTestId("custom-form")).toBeInTheDocument();
  });
});
```

`web/src/components/gym/CustomExerciseForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useCreateExercise, useUpdateExercise } from "../../api/gym";
import CustomExerciseForm from "./CustomExerciseForm";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return { ...actual, useCreateExercise: vi.fn(), useUpdateExercise: vi.fn() };
});

describe("CustomExerciseForm", () => {
  it("creates an exercise with the chosen fields", async () => {
    const mutate = vi.fn();
    vi.mocked(useCreateExercise).mockReturnValue({ mutate, isPending: false, isError: false } as unknown as ReturnType<typeof useCreateExercise>);
    vi.mocked(useUpdateExercise).mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<typeof useUpdateExercise>);
    const user = userEvent.setup();
    render(<CustomExerciseForm onClose={vi.fn()} onSaved={vi.fn()} />);

    const save = screen.getByRole("button", { name: "Salva" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Nome"), "Landmine Press");
    await user.selectOptions(screen.getByLabelText("Attrezzo"), "barbell");
    await user.selectOptions(screen.getByLabelText("Muscolo principale"), "shoulders");
    await user.click(screen.getByRole("radio", { name: "Solo ripetizioni" }));
    await user.click(save);

    expect(mutate).toHaveBeenCalledWith(
      { name: "Landmine Press", equipment: "barbell", primary_muscle: "shoulders", tracking: "reps" },
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/gym`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the shared building blocks**

`web/src/components/gym/Sheet.tsx`:

```tsx
import type { ReactNode } from "react";

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Nearly full height (pickers, long lists). */
  full?: boolean;
  headerAction?: ReactNode;
}

/** Bottom sheet on phones, centred dialog from `sm:` up -- the same overlay,
 * grabber and safe-area footer as `EditEntrySheet`. */
function Sheet({ title, onClose, children, footer, full = false, headerAction }: SheetProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`flex w-full max-w-lg flex-col overflow-hidden rounded-t-sheet bg-white shadow-sheet sm:rounded-sheet ${
          full ? "h-[92vh]" : "max-h-[85vh]"
        }`}
      >
        <div className="flex justify-center pt-2 sm:hidden">
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-slate-300" />
        </div>
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 pb-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Chiudi
          </button>
          <h2 className="truncate text-[17px] font-semibold text-slate-900">{title}</h2>
          <div className="flex min-w-[4.5rem] justify-end">{headerAction}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && (
          <div className="border-t border-slate-100 px-4 pb-[calc(0.75rem+var(--safe-bottom))] pt-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Sheet;
```

`web/src/components/gym/ActionMenu.tsx`:

```tsx
import { type ReactNode, useState } from "react";

export interface Action {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

interface ActionMenuProps {
  /** Accessible name of the trigger button. */
  label: string;
  actions: Action[];
  /** Custom trigger content; defaults to "•••". */
  trigger?: ReactNode;
  triggerClassName?: string;
}

/** The "•••" menu used on cards, exercises and sets. */
function ActionMenu({ label, actions, trigger, triggerClassName }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={
          triggerClassName ??
          "rounded-lg bg-sky-50 px-2.5 py-1 text-sm font-bold tracking-widest text-sky-600 active:bg-sky-100"
        }
      >
        {trigger ?? "•••"}
      </button>
      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <ul
            role="menu"
            className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-card"
          >
            {actions.map((action) => (
              <li key={action.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    action.onSelect();
                  }}
                  className={`block w-full px-4 py-2.5 text-left text-[15px] active:bg-slate-100 ${
                    action.destructive ? "text-red-600" : "text-slate-800"
                  }`}
                >
                  {action.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default ActionMenu;
```

`web/src/components/gym/ExerciseFilterBar.tsx`:

```tsx
import type { ExerciseFilters } from "../../api/gym";
import { EQUIPMENT_LABELS, MUSCLE_LABELS } from "../../lib/gym";

interface ExerciseFilterBarProps {
  value: ExerciseFilters;
  onChange: (next: ExerciseFilters) => void;
}

function ExerciseFilterBar({ value, onChange }: ExerciseFilterBarProps) {
  return (
    <div className="space-y-2">
      <input
        type="search"
        aria-label="Cerca esercizio"
        placeholder="Cerca esercizio (nome inglese)"
        className="field"
        value={value.q}
        onChange={(event) => onChange({ ...value, q: event.target.value })}
      />
      <div className="flex gap-2">
        <select
          aria-label="Attrezzo"
          className="field"
          value={value.equipment}
          onChange={(event) => onChange({ ...value, equipment: event.target.value })}
        >
          <option value="">Tutti gli attrezzi</option>
          {Object.entries(EQUIPMENT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Muscolo"
          className="field"
          value={value.muscle}
          onChange={(event) => onChange({ ...value, muscle: event.target.value })}
        >
          <option value="">Tutti i muscoli</option>
          {Object.entries(MUSCLE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default ExerciseFilterBar;
```

`web/src/components/gym/ExerciseList.tsx`:

```tsx
import type { Exercise, useExercises } from "../../api/gym";
import { exerciseSubtitle } from "../../lib/gym";

interface ExerciseListProps {
  query: ReturnType<typeof useExercises>;
  /** When given, rows are toggles and show a check when selected. */
  selectedIds?: Set<number>;
  onSelect: (exercise: Exercise) => void;
}

function ExerciseList({ query, selectedIds, onSelect }: ExerciseListProps) {
  if (query.isLoading) return <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>;
  if (query.isError) {
    return <p className="card px-4 py-3 text-center text-sm text-red-600">Errore nel caricamento.</p>;
  }
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Nessun esercizio trovato.</p>;
  }
  return (
    <div className="space-y-2">
      <ul className="card divide-y divide-slate-100 overflow-hidden">
        {items.map((exercise) => {
          const selected = selectedIds?.has(exercise.id) ?? false;
          return (
            <li key={exercise.id}>
              <button
                type="button"
                onClick={() => onSelect(exercise)}
                aria-pressed={selectedIds ? selected : undefined}
                className={`row w-full text-left active:bg-slate-50 ${selected ? "bg-sky-50" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-slate-900">
                    {exercise.name}
                  </span>
                  <span className="block truncate text-[13px] text-slate-500">
                    {exerciseSubtitle(exercise)}
                    {exercise.custom && " · Personalizzato"}
                  </span>
                </span>
                {selected && <span aria-hidden className="text-lg text-sky-600">✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {query.data && query.data.total > items.length && (
        <p className="text-center text-xs text-slate-500">
          Mostrati {items.length} di {query.data.total}: affina la ricerca.
        </p>
      )}
    </div>
  );
}

export default ExerciseList;
```

- [ ] **Step 4: Write the form, the detail sheet and the picker**

`web/src/components/gym/CustomExerciseForm.tsx`:

```tsx
import { useState } from "react";

import type { Exercise, ExerciseDetail, ExerciseInput, Tracking } from "../../api/gym";
import { useCreateExercise, useUpdateExercise } from "../../api/gym";
import { EQUIPMENT_LABELS, MUSCLE_LABELS, TRACKING_LABELS } from "../../lib/gym";
import Sheet from "./Sheet";

interface CustomExerciseFormProps {
  initial?: ExerciseDetail;
  onClose: () => void;
  onSaved: (exercise: Exercise) => void;
}

function CustomExerciseForm({ initial, onClose, onSaved }: CustomExerciseFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [equipment, setEquipment] = useState(initial?.equipment ?? "");
  const [muscle, setMuscle] = useState(initial?.primary_muscles[0] ?? "");
  const [tracking, setTracking] = useState<Tracking>(initial?.tracking ?? "weight_reps");
  const create = useCreateExercise();
  const update = useUpdateExercise();
  const pending = create.isPending || update.isPending;
  const failed = create.isError || update.isError;

  function save() {
    const input: ExerciseInput = {
      name: name.trim(),
      equipment: equipment || null,
      primary_muscle: muscle || null,
      tracking,
    };
    const options = { onSuccess: (exercise: ExerciseDetail) => onSaved(exercise) };
    if (initial) update.mutate({ id: initial.id, ...input }, options);
    else create.mutate(input, options);
  }

  return (
    <Sheet
      title={initial ? "Modifica esercizio" : "Nuovo esercizio"}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          disabled={!name.trim() || pending}
          onClick={save}
        >
          Salva
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="exercise-name" className="field-label">
            Nome
          </label>
          <input
            id="exercise-name"
            className="field mt-1.5"
            value={name}
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="exercise-equipment" className="field-label">
            Attrezzo
          </label>
          <select
            id="exercise-equipment"
            className="field mt-1.5"
            value={equipment}
            onChange={(event) => setEquipment(event.target.value)}
          >
            <option value="">Nessuno</option>
            {Object.entries(EQUIPMENT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="exercise-muscle" className="field-label">
            Muscolo principale
          </label>
          <select
            id="exercise-muscle"
            className="field mt-1.5"
            value={muscle}
            onChange={(event) => setMuscle(event.target.value)}
          >
            <option value="">Nessuno</option>
            {Object.entries(MUSCLE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="field-label">Cosa registri</legend>
          <div className="mt-1.5 space-y-2">
            {(Object.keys(TRACKING_LABELS) as Tracking[]).map((key) => (
              <label key={key} className="flex items-center gap-3 text-[15px] text-slate-800">
                <input
                  type="radio"
                  name="tracking"
                  checked={tracking === key}
                  onChange={() => setTracking(key)}
                />
                {TRACKING_LABELS[key]}
              </label>
            ))}
          </div>
        </fieldset>
        {failed && <p className="text-sm text-red-600">Salvataggio non riuscito.</p>}
      </div>
    </Sheet>
  );
}

export default CustomExerciseForm;
```

`web/src/components/gym/ExerciseDetailSheet.tsx`:

```tsx
import { useState } from "react";

import { useArchiveExercise, useExercise } from "../../api/gym";
import { equipmentLabel, muscleLabel, TRACKING_LABELS } from "../../lib/gym";
import CustomExerciseForm from "./CustomExerciseForm";
import Sheet from "./Sheet";

interface ExerciseDetailSheetProps {
  exerciseId: number;
  onClose: () => void;
}

function ExerciseDetailSheet({ exerciseId, onClose }: ExerciseDetailSheetProps) {
  const { data, isLoading, isError } = useExercise(exerciseId);
  const archive = useArchiveExercise();
  const [editing, setEditing] = useState(false);

  function remove() {
    if (!window.confirm("Eliminare l'esercizio? Resterà visibile nello storico.")) return;
    archive.mutate(exerciseId, { onSuccess: onClose });
  }

  return (
    <Sheet title={data?.name ?? "Esercizio"} onClose={onClose}>
      {isLoading && <p className="py-6 text-center text-sm text-slate-500">Caricamento...</p>}
      {isError && <p className="text-sm text-red-600">Errore nel caricamento.</p>}
      {data && (
        <div className="space-y-4 text-[15px] text-slate-800">
          <dl className="card divide-y divide-slate-100">
            <div className="row justify-between">
              <dt className="text-slate-500">Attrezzo</dt>
              <dd>{equipmentLabel(data.equipment) ?? "—"}</dd>
            </div>
            <div className="row justify-between">
              <dt className="text-slate-500">Muscoli principali</dt>
              <dd className="text-right">{data.primary_muscles.map(muscleLabel).join(", ") || "—"}</dd>
            </div>
            {data.secondary_muscles.length > 0 && (
              <div className="row justify-between">
                <dt className="text-slate-500">Secondari</dt>
                <dd className="text-right">{data.secondary_muscles.map(muscleLabel).join(", ")}</dd>
              </div>
            )}
            <div className="row justify-between">
              <dt className="text-slate-500">Registra</dt>
              <dd>{TRACKING_LABELS[data.tracking]}</dd>
            </div>
          </dl>
          {data.instructions.length > 0 && (
            <section>
              <h3 className="section-label">Istruzioni (inglese)</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-[14px] leading-relaxed text-slate-700">
                {data.instructions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </section>
          )}
          {data.custom && (
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1" onClick={() => setEditing(true)}>
                Modifica
              </button>
              <button
                type="button"
                className="btn-secondary flex-1 text-red-600"
                onClick={remove}
                disabled={archive.isPending}
              >
                Elimina
              </button>
            </div>
          )}
        </div>
      )}
      {editing && data && (
        <CustomExerciseForm initial={data} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
      )}
    </Sheet>
  );
}

export default ExerciseDetailSheet;
```

`web/src/components/gym/ExercisePicker.tsx`:

```tsx
import { useState } from "react";

import type { Exercise } from "../../api/gym";
import { EMPTY_FILTERS, useExercises } from "../../api/gym";
import { useDebounced } from "../../lib/useDebounced";
import CustomExerciseForm from "./CustomExerciseForm";
import ExerciseFilterBar from "./ExerciseFilterBar";
import ExerciseList from "./ExerciseList";
import Sheet from "./Sheet";

interface ExercisePickerProps {
  title?: string;
  /** Several exercises at once (add) or exactly one (replace). */
  multiple?: boolean;
  onPick: (exercises: Exercise[]) => void;
  onClose: () => void;
}

function ExercisePicker({ title = "Aggiungi esercizi", multiple = true, onPick, onClose }: ExercisePickerProps) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const q = useDebounced(filters.q, 250);
  const query = useExercises({ ...filters, q });
  const [selected, setSelected] = useState<Exercise[]>([]);
  const [creating, setCreating] = useState(false);

  function select(exercise: Exercise) {
    if (!multiple) {
      onPick([exercise]);
      return;
    }
    setSelected((current) =>
      current.some((item) => item.id === exercise.id)
        ? current.filter((item) => item.id !== exercise.id)
        : [...current, exercise],
    );
  }

  return (
    <Sheet
      title={title}
      full
      onClose={onClose}
      headerAction={
        <button type="button" className="btn-ghost text-sky-600" onClick={() => setCreating(true)}>
          + Nuovo
        </button>
      }
      footer={
        multiple ? (
          <button
            type="button"
            className="btn-primary w-full"
            disabled={selected.length === 0}
            onClick={() => onPick(selected)}
          >
            Aggiungi ({selected.length})
          </button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <ExerciseFilterBar value={filters} onChange={setFilters} />
        <ExerciseList
          query={query}
          selectedIds={multiple ? new Set(selected.map((item) => item.id)) : undefined}
          onSelect={select}
        />
      </div>
      {creating && (
        <CustomExerciseForm
          onClose={() => setCreating(false)}
          onSaved={(exercise) => {
            setCreating(false);
            select(exercise);
          }}
        />
      )}
    </Sheet>
  );
}

export default ExercisePicker;
```

- [ ] **Step 5: Write the Exercises page**

Replace `web/src/pages/gym/ExercisesPage.tsx`:

```tsx
import { useState } from "react";

import { EMPTY_FILTERS, useExercises } from "../../api/gym";
import ModeSwitch from "../../components/ModeSwitch";
import CustomExerciseForm from "../../components/gym/CustomExerciseForm";
import ExerciseDetailSheet from "../../components/gym/ExerciseDetailSheet";
import ExerciseFilterBar from "../../components/gym/ExerciseFilterBar";
import ExerciseList from "../../components/gym/ExerciseList";
import { useDebounced } from "../../lib/useDebounced";

/** Browse the catalog plus the user's custom exercises; tap for details,
 * "+ Nuovo" to create a custom one. */
function ExercisesPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const q = useDebounced(filters.q, 250);
  const query = useExercises({ ...filters, q });
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl space-y-2 px-4 py-2">
          <div className="flex items-center justify-between">
            <h1 className="text-[17px] font-semibold text-slate-900">Esercizi</h1>
            <button type="button" className="btn-ghost text-sky-600" onClick={() => setCreating(true)}>
              + Nuovo
            </button>
          </div>
          <ExerciseFilterBar value={filters} onChange={setFilters} />
        </div>
      </header>
      <div className="mx-auto max-w-2xl p-4">
        <ExerciseList query={query} onSelect={(exercise) => setOpenId(exercise.id)} />
      </div>
      {openId !== null && <ExerciseDetailSheet exerciseId={openId} onClose={() => setOpenId(null)} />}
      {creating && (
        <CustomExerciseForm
          onClose={() => setCreating(false)}
          onSaved={(exercise) => {
            setCreating(false);
            setOpenId(exercise.id);
          }}
        />
      )}
    </div>
  );
}

export default ExercisesPage;
```

- [ ] **Step 6: Run the tests and build**

Run: `npx vitest run src/components/gym` → PASS; `npm test` → all pass; `npm run build` → success.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/gym web/src/pages/gym/ExercisesPage.tsx
git commit -m "feat(web): exercises page, exercise picker and custom exercises"
```

---

### Task 11: Web — pagina Inizia (modelli e cartelle) ed editor modello

**Files:**
- Create: `web/src/components/gym/NumberInput.tsx`, `web/src/components/gym/NumberInput.test.tsx`
- Create: `web/src/components/gym/RestPicker.tsx`
- Create: `web/src/components/gym/TemplateCard.tsx`
- Create: `web/src/components/gym/TemplatePreviewSheet.tsx`
- Create: `web/src/components/gym/MoveToFolderSheet.tsx`
- Replace: `web/src/pages/gym/GymStartPage.tsx`, `web/src/pages/gym/TemplateEditorPage.tsx`
- Test: `web/src/pages/gym/TemplateEditorPage.test.tsx`

**Interfaces:**
- Consumes: template/folder hooks, `useActiveWorkout`, `useStartWorkout` (Task 8); `Sheet`, `ActionMenu`, `ExercisePicker` (Task 10); `lib/gym` helpers (Task 8).
- Produces:
  - `NumberInput({ value, kind, onChange, onBlur?, label, placeholder? })` — `kind: "decimal" | "integer" | "duration"`; shows `37,5` / `1:30`; calls `onChange(number | null)` on every valid edit (empty = `null`, invalid text is ignored).
  - `RestPicker({ value, onChange, onClose, title? })`.
  - `TemplateCard({ template, onOpen, onEdit, onDuplicate, onMove, onDelete })`.
  - `TemplatePreviewSheet({ templateId, starting, onStart, onEdit, onClose })`.
  - `MoveToFolderSheet({ folders, currentFolderId, onPick, onClose })`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/gym/NumberInput.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import NumberInput from "./NumberInput";

describe("NumberInput", () => {
  it("shows and accepts a decimal comma", () => {
    const onChange = vi.fn();
    render(<NumberInput label="kg" kind="decimal" value={37.5} onChange={onChange} />);
    const input = screen.getByLabelText("kg");
    expect(input).toHaveValue("37,5");
    fireEvent.change(input, { target: { value: "40,25" } });
    expect(onChange).toHaveBeenLastCalledWith(40.25);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("ignores invalid text and values over the limit", () => {
    const onChange = vi.fn();
    render(<NumberInput label="Rip." kind="integer" value={8} onChange={onChange} />);
    const input = screen.getByLabelText("Rip.");
    fireEvent.change(input, { target: { value: "8a" } });
    fireEvent.change(input, { target: { value: "5000" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("formats durations as m:ss", () => {
    const onChange = vi.fn();
    render(<NumberInput label="Tempo" kind="duration" value={90} onChange={onChange} />);
    const input = screen.getByLabelText("Tempo");
    expect(input).toHaveValue("1:30");
    fireEvent.change(input, { target: { value: "2:05" } });
    expect(onChange).toHaveBeenLastCalledWith(125);
  });
});
```

`web/src/pages/gym/TemplateEditorPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Exercise } from "../../api/gym";
import { useCreateTemplate, useReplaceTemplate, useTemplate, useTemplates } from "../../api/gym";
import TemplateEditorPage from "./TemplateEditorPage";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return {
    ...actual,
    useTemplate: vi.fn(),
    useTemplates: vi.fn(),
    useCreateTemplate: vi.fn(),
    useReplaceTemplate: vi.fn(),
  };
});

const squat: Exercise = {
  id: 7, name: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"],
  secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
};

vi.mock("../../components/gym/ExercisePicker", () => ({
  default: ({ onPick }: { onPick: (list: Exercise[]) => void }) => (
    <button type="button" onClick={() => onPick([squat])}>
      pick squat
    </button>
  ),
}));

const create = vi.fn();

describe("TemplateEditorPage", () => {
  beforeEach(() => {
    create.mockReset();
    vi.mocked(useTemplate).mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useTemplate>);
    vi.mocked(useTemplates).mockReturnValue({
      data: { folders: [{ id: 3, name: "Settimana 1", position: 0 }], templates: [] },
    } as unknown as ReturnType<typeof useTemplates>);
    vi.mocked(useCreateTemplate).mockReturnValue({ mutate: create, isPending: false, isError: false } as unknown as ReturnType<typeof useCreateTemplate>);
    vi.mocked(useReplaceTemplate).mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<typeof useReplaceTemplate>);
  });

  it("builds a new template", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/gym/templates/new"]}>
        <Routes>
          <Route path="/gym/templates/new" element={<TemplateEditorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Nome del modello"), "Giorno 1");
    await user.selectOptions(screen.getByLabelText("Cartella"), "3");
    await user.click(screen.getByRole("button", { name: "+ Aggiungi esercizio" }));
    await user.click(screen.getByRole("button", { name: "pick squat" }));
    await user.type(screen.getByLabelText("kg serie 1"), "80");
    await user.type(screen.getByLabelText("Rip. serie 1"), "8");
    await user.click(screen.getByRole("button", { name: "+ Aggiungi serie" }));
    await user.click(screen.getByRole("button", { name: "Salva" }));

    expect(create).toHaveBeenCalledWith(
      {
        name: "Giorno 1",
        folder_id: 3,
        exercises: [
          {
            exercise_id: 7,
            rest_seconds: 90,
            superset_group: null,
            note: null,
            sets: [
              { weight_kg: 80, reps: 8, duration_s: null },
              { weight_kg: 80, reps: 8, duration_s: null },
            ],
          },
        ],
      },
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/gym/NumberInput.test.tsx src/pages/gym/TemplateEditorPage.test.tsx`
Expected: FAIL — `./NumberInput` not found; the editor stub has no form.

- [ ] **Step 3: Write `NumberInput` and `RestPicker`**

`web/src/components/gym/NumberInput.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";

import { formatDuration, formatKg, parseDecimal, parseDuration, parseInteger } from "../../lib/gym";

type Kind = "decimal" | "integer" | "duration";

const LIMITS: Record<Kind, number> = { decimal: 1000, integer: 1000, duration: 36000 };

function format(value: number | null, kind: Kind): string {
  if (value === null) return "";
  if (kind === "decimal") return formatKg(value);
  if (kind === "duration") return formatDuration(value);
  return String(value);
}

function parse(text: string, kind: Kind): number | null {
  if (kind === "decimal") return parseDecimal(text);
  if (kind === "duration") return parseDuration(text);
  return parseInteger(text);
}

interface NumberInputProps {
  value: number | null;
  kind: Kind;
  onChange: (value: number | null) => void;
  onBlur?: () => void;
  /** Accessible name, e.g. "kg serie 1". */
  label: string;
  placeholder?: string;
}

/** Grey pill input used for kg / reps / time. Keeps the typed text while
 * focused (so "37," can become "37,5") and re-formats on blur. */
function NumberInput({ value, kind, onChange, onBlur, label, placeholder }: NumberInputProps) {
  const [text, setText] = useState(() => format(value, kind));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(format(value, kind));
  }, [value, kind]);

  return (
    <input
      aria-label={label}
      inputMode={kind === "integer" ? "numeric" : kind === "decimal" ? "decimal" : "text"}
      placeholder={placeholder}
      value={text}
      onFocus={(event) => {
        focused.current = true;
        event.target.select();
      }}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (next.trim() === "") {
          onChange(null);
          return;
        }
        const parsed = parse(next, kind);
        if (parsed !== null && parsed <= LIMITS[kind]) onChange(parsed);
      }}
      onBlur={() => {
        focused.current = false;
        setText(format(value, kind));
        onBlur?.();
      }}
      className="h-9 w-full min-w-0 rounded-lg bg-slate-100 text-center text-[16px] font-semibold tabular-nums text-slate-900 placeholder:text-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
    />
  );
}

export default NumberInput;
```

`web/src/components/gym/RestPicker.tsx`:

```tsx
import { REST_OPTIONS, restLabel } from "../../lib/gym";
import Sheet from "./Sheet";

interface RestPickerProps {
  value: number;
  onChange: (seconds: number) => void;
  onClose: () => void;
  title?: string;
}

function RestPicker({ value, onChange, onClose, title = "Riposo" }: RestPickerProps) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="grid grid-cols-4 gap-2">
        {REST_OPTIONS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            aria-pressed={seconds === value}
            onClick={() => onChange(seconds)}
            className={`rounded-lg py-2 text-[15px] font-semibold tabular-nums ${
              seconds === value ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700 active:bg-slate-200"
            }`}
          >
            {restLabel(seconds)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export default RestPicker;
```

- [ ] **Step 4: Write the template card, preview and move sheet**

`web/src/components/gym/TemplateCard.tsx`:

```tsx
import type { TemplateSummary } from "../../api/gym";
import { lastUsedLabel } from "../../lib/gym";
import ActionMenu from "./ActionMenu";

interface TemplateCardProps {
  template: TemplateSummary;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onMove: () => void;
  onDelete: () => void;
}

function TemplateCard({ template, onOpen, onEdit, onDuplicate, onMove, onDelete }: TemplateCardProps) {
  const lastUsed = lastUsedLabel(template.last_used_at);
  return (
    <div className="card flex min-h-[9.5rem] flex-col p-3">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 text-left text-[17px] font-semibold leading-tight text-slate-900"
        >
          {template.name}
        </button>
        <ActionMenu
          label={`Azioni ${template.name}`}
          actions={[
            { label: "Modifica", onSelect: onEdit },
            { label: "Duplica", onSelect: onDuplicate },
            { label: "Sposta in cartella", onSelect: onMove },
            { label: "Elimina", onSelect: onDelete, destructive: true },
          ]}
        />
      </div>
      <button type="button" onClick={onOpen} tabIndex={-1} className="mt-1 flex-1 text-left">
        <p className="line-clamp-3 text-[14px] leading-snug text-slate-500">
          {template.exercise_names.join(", ") || "Nessun esercizio"}
        </p>
      </button>
      {lastUsed && (
        <p className="mt-2 flex items-center gap-1 text-xs italic text-slate-500">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.4 3 1.8-.8 1.3-3.7-2.2V7h1.5v5.4Z" />
          </svg>
          {lastUsed}
        </p>
      )}
    </div>
  );
}

export default TemplateCard;
```

`web/src/components/gym/TemplatePreviewSheet.tsx`:

```tsx
import { useTemplate } from "../../api/gym";
import Sheet from "./Sheet";

interface TemplatePreviewSheetProps {
  templateId: number;
  starting: boolean;
  onStart: (templateId: number) => void;
  onEdit: (templateId: number) => void;
  onClose: () => void;
}

function TemplatePreviewSheet({ templateId, starting, onStart, onEdit, onClose }: TemplatePreviewSheetProps) {
  const { data, isLoading } = useTemplate(templateId);
  return (
    <Sheet
      title={data?.name ?? "Modello"}
      onClose={onClose}
      headerAction={
        <button type="button" className="btn-ghost text-sky-600" onClick={() => onEdit(templateId)}>
          Modifica
        </button>
      }
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          disabled={starting || !data}
          onClick={() => onStart(templateId)}
        >
          Inizia allenamento
        </button>
      }
    >
      {isLoading && <p className="py-6 text-center text-sm text-slate-500">Caricamento...</p>}
      {data && (
        <ul className="card divide-y divide-slate-100">
          {data.exercises.map((item) => (
            <li key={item.id} className="row">
              <span className="w-10 shrink-0 font-semibold tabular-nums text-slate-500">
                {item.sets.length} ×
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] text-slate-900">
                {item.exercise.name}
              </span>
              {item.superset_group !== null && (
                <span className="text-xs font-semibold uppercase text-sky-600">Superserie</span>
              )}
            </li>
          ))}
          {data.exercises.length === 0 && (
            <li className="row text-sm text-slate-500">Nessun esercizio</li>
          )}
        </ul>
      )}
    </Sheet>
  );
}

export default TemplatePreviewSheet;
```

`web/src/components/gym/MoveToFolderSheet.tsx`:

```tsx
import type { Folder } from "../../api/gym";
import Sheet from "./Sheet";

interface MoveToFolderSheetProps {
  folders: Folder[];
  currentFolderId: number | null;
  onPick: (folderId: number | null) => void;
  onClose: () => void;
}

function MoveToFolderSheet({ folders, currentFolderId, onPick, onClose }: MoveToFolderSheetProps) {
  const options: { id: number | null; name: string }[] = [{ id: null, name: "Nessuna cartella" }, ...folders];
  return (
    <Sheet title="Sposta in cartella" onClose={onClose}>
      <ul className="card divide-y divide-slate-100">
        {options.map((option) => (
          <li key={option.id ?? "none"}>
            <button
              type="button"
              aria-pressed={option.id === currentFolderId}
              onClick={() => onPick(option.id)}
              className="row w-full justify-between text-left text-[15px] text-slate-900 active:bg-slate-50"
            >
              {option.name}
              {option.id === currentFolderId && <span className="text-sky-600">✓</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export default MoveToFolderSheet;
```

- [ ] **Step 5: Write the Start page**

Replace `web/src/pages/gym/GymStartPage.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Folder, TemplateSummary } from "../../api/gym";
import {
  useActiveWorkout,
  useCreateFolder,
  useDeleteFolder,
  useDeleteTemplate,
  useDuplicateTemplate,
  usePatchTemplate,
  useRenameFolder,
  useStartWorkout,
  useTemplates,
} from "../../api/gym";
import ModeSwitch from "../../components/ModeSwitch";
import ActionMenu from "../../components/gym/ActionMenu";
import MoveToFolderSheet from "../../components/gym/MoveToFolderSheet";
import TemplateCard from "../../components/gym/TemplateCard";
import TemplatePreviewSheet from "../../components/gym/TemplatePreviewSheet";

const folderIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
);

/** "Inizia": start an empty workout or one from a template; templates are
 * grouped in collapsible folders (like Strong's "Modelli"). */
function GymStartPage() {
  const navigate = useNavigate();
  const templates = useTemplates();
  const active = useActiveWorkout();
  const start = useStartWorkout();
  const createFolder = useCreateFolder();
  const renameFolder = useRenameFolder();
  const deleteFolder = useDeleteFolder();
  const duplicate = useDuplicateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const patchTemplate = usePatchTemplate();
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<number[]>([]);

  function startWorkout(templateId: number | null) {
    if (active.data) {
      if (window.confirm("C'è già un allenamento in corso. Vuoi riprenderlo?")) navigate("/gym/workout");
      return;
    }
    start.mutate(templateId, { onSuccess: () => navigate("/gym/workout") });
  }

  function newFolder() {
    const name = window.prompt("Nome della cartella")?.trim();
    if (name) createFolder.mutate(name);
  }

  function renameFolderPrompt(folder: Folder) {
    const name = window.prompt("Nuovo nome della cartella", folder.name)?.trim();
    if (name && name !== folder.name) renameFolder.mutate({ id: folder.id, name });
  }

  function removeFolder(folder: Folder) {
    if (window.confirm(`Eliminare la cartella "${folder.name}"? I modelli restano.`)) {
      deleteFolder.mutate(folder.id);
    }
  }

  function removeTemplate(template: TemplateSummary) {
    if (window.confirm(`Eliminare il modello "${template.name}"?`)) deleteTemplate.mutate(template.id);
  }

  function toggle(folderId: number) {
    setCollapsed((current) =>
      current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId],
    );
  }

  function cards(list: TemplateSummary[]) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {list.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onOpen={() => setPreviewId(template.id)}
            onEdit={() => navigate(`/gym/templates/${template.id}`)}
            onDuplicate={() => duplicate.mutate(template.id)}
            onMove={() => setMovingId(template.id)}
            onDelete={() => removeTemplate(template)}
          />
        ))}
      </div>
    );
  }

  const data = templates.data;
  const loose = data?.templates.filter((template) => template.folder_id === null) ?? [];
  const moving = data?.templates.find((template) => template.id === movingId);

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3 text-center">
          <h1 className="text-[17px] font-semibold text-slate-900">Inizia allenamento</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-5 p-4">
        <button
          type="button"
          className="btn-primary w-full bg-sky-500 active:bg-sky-600"
          onClick={() => startWorkout(null)}
          disabled={start.isPending}
        >
          {active.data ? "Riprendi allenamento" : "Inizia un allenamento vuoto"}
        </button>

        <div className="flex items-center justify-between gap-2">
          <h2 className="text-2xl font-bold text-slate-900">Modelli</h2>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary px-3 text-sky-600" onClick={() => navigate("/gym/templates/new")}>
              + Modello
            </button>
            <button type="button" className="btn-secondary px-3 text-sky-600" aria-label="Nuova cartella" onClick={newFolder}>
              {folderIcon}
            </button>
          </div>
        </div>

        {templates.isLoading && <p className="py-6 text-center text-sm text-slate-500">Caricamento...</p>}
        {templates.isError && (
          <p className="card px-4 py-3 text-center text-sm text-red-600">Errore nel caricamento dei modelli.</p>
        )}

        {data?.folders.map((folder) => {
          const list = data.templates.filter((template) => template.folder_id === folder.id);
          const isCollapsed = collapsed.includes(folder.id);
          return (
            <section key={folder.id} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(folder.id)}
                  className="flex min-w-0 items-center gap-2 text-[17px] font-semibold text-slate-800"
                >
                  {folderIcon}
                  <span className="truncate">
                    {folder.name} ({list.length})
                  </span>
                </button>
                <ActionMenu
                  label={`Azioni cartella ${folder.name}`}
                  actions={[
                    { label: "Rinomina", onSelect: () => renameFolderPrompt(folder) },
                    { label: "Elimina cartella", onSelect: () => removeFolder(folder), destructive: true },
                  ]}
                />
              </div>
              {!isCollapsed &&
                (list.length ? cards(list) : <p className="text-sm text-slate-500">Cartella vuota</p>)}
            </section>
          );
        })}

        {loose.length > 0 && (
          <section className="space-y-3">
            {data && data.folders.length > 0 && <h3 className="section-label">Altri modelli</h3>}
            {cards(loose)}
          </section>
        )}

        {data && data.templates.length === 0 && (
          <p className="card px-4 py-6 text-center text-sm text-slate-500">
            Nessun modello. Crea il primo con "+ Modello".
          </p>
        )}
      </div>

      {previewId !== null && (
        <TemplatePreviewSheet
          templateId={previewId}
          starting={start.isPending}
          onClose={() => setPreviewId(null)}
          onStart={(id) => startWorkout(id)}
          onEdit={(id) => navigate(`/gym/templates/${id}`)}
        />
      )}
      {moving && data && (
        <MoveToFolderSheet
          folders={data.folders}
          currentFolderId={moving.folder_id}
          onClose={() => setMovingId(null)}
          onPick={(folderId) => {
            patchTemplate.mutate({ id: moving.id, folder_id: folderId });
            setMovingId(null);
          }}
        />
      )}
    </div>
  );
}

export default GymStartPage;
```

- [ ] **Step 6: Write the template editor**

Replace `web/src/pages/gym/TemplateEditorPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { Exercise, SetValues, Template, TemplateInput } from "../../api/gym";
import { useCreateTemplate, useReplaceTemplate, useTemplate, useTemplates } from "../../api/gym";
import ActionMenu, { type Action } from "../../components/gym/ActionMenu";
import ExercisePicker from "../../components/gym/ExercisePicker";
import NumberInput from "../../components/gym/NumberInput";
import RestPicker from "../../components/gym/RestPicker";
import {
  exerciseSubtitle,
  FIELD_META,
  linkWithNext,
  moveItem,
  restLabel,
  setFields,
  unlinkFromGroup,
} from "../../lib/gym";

interface DraftExercise {
  key: string;
  exercise: Exercise;
  rest_seconds: number;
  superset_group: number | null;
  note: string | null;
  sets: SetValues[];
}

let keySequence = 0;
const nextKey = () => `draft-${(keySequence += 1)}`;
const emptySet = (): SetValues => ({ weight_kg: null, reps: null, duration_s: null });

function toDraft(template: Template): DraftExercise[] {
  return template.exercises.map((item) => ({
    key: nextKey(),
    exercise: item.exercise,
    rest_seconds: item.rest_seconds,
    superset_group: item.superset_group,
    note: item.note,
    sets: item.sets.map((set) => ({ ...set })),
  }));
}

/** Create or edit a template. Edits stay in a local draft; "Salva" sends the
 * whole template in one request (POST for new, PUT for existing). */
function TemplateEditorPage() {
  const { id } = useParams();
  const templateId = id ? Number(id) : null;
  const navigate = useNavigate();
  const existing = useTemplate(templateId);
  const templates = useTemplates();
  const create = useCreateTemplate();
  const replace = useReplaceTemplate();
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [items, setItems] = useState<DraftExercise[]>([]);
  const [loaded, setLoaded] = useState(templateId === null);
  const [picking, setPicking] = useState(false);
  const [restFor, setRestFor] = useState<string | null>(null);

  useEffect(() => {
    if (existing.data && !loaded) {
      setName(existing.data.name);
      setFolderId(existing.data.folder_id);
      setItems(toDraft(existing.data));
      setLoaded(true);
    }
  }, [existing.data, loaded]);

  function update(key: string, patch: Partial<DraftExercise>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function updateSet(key: string, index: number, patch: Partial<SetValues>) {
    setItems((current) =>
      current.map((item) =>
        item.key === key
          ? { ...item, sets: item.sets.map((set, n) => (n === index ? { ...set, ...patch } : set)) }
          : item,
      ),
    );
  }

  function addSet(key: string) {
    setItems((current) =>
      current.map((item) =>
        item.key === key
          ? { ...item, sets: [...item.sets, { ...(item.sets[item.sets.length - 1] ?? emptySet()) }] }
          : item,
      ),
    );
  }

  function removeSet(key: string, index: number) {
    setItems((current) =>
      current.map((item) =>
        item.key === key && item.sets.length > 1
          ? { ...item, sets: item.sets.filter((_, n) => n !== index) }
          : item,
      ),
    );
  }

  function setGroups(groups: (number | null)[]) {
    setItems((current) => current.map((item, n) => ({ ...item, superset_group: groups[n] })));
  }

  function addExercises(list: Exercise[]) {
    setItems((current) => [
      ...current,
      ...list.map((exercise) => ({
        key: nextKey(),
        exercise,
        rest_seconds: 90,
        superset_group: null,
        note: null,
        sets: [emptySet()],
      })),
    ]);
    setPicking(false);
  }

  function actionsFor(item: DraftExercise, index: number): Action[] {
    const groups = items.map((entry) => entry.superset_group);
    const actions: Action[] = [{ label: "Riposo", onSelect: () => setRestFor(item.key) }];
    if (index > 0) actions.push({ label: "Sposta su", onSelect: () => setItems(moveItem(items, index, -1)) });
    if (index < items.length - 1) {
      actions.push({ label: "Sposta giù", onSelect: () => setItems(moveItem(items, index, 1)) });
      actions.push({ label: "Collega al successivo", onSelect: () => setGroups(linkWithNext(groups, index)) });
    }
    if (item.superset_group !== null) {
      actions.push({ label: "Scollega superserie", onSelect: () => setGroups(unlinkFromGroup(groups, index)) });
    }
    actions.push({
      label: "Rimuovi esercizio",
      destructive: true,
      onSelect: () => setItems((current) => current.filter((entry) => entry.key !== item.key)),
    });
    return actions;
  }

  const saving = create.isPending || replace.isPending;
  const canSave = loaded && name.trim().length > 0 && !saving;

  function save() {
    const input: TemplateInput = {
      name: name.trim(),
      folder_id: folderId,
      exercises: items.map((item) => ({
        exercise_id: item.exercise.id,
        rest_seconds: item.rest_seconds,
        superset_group: item.superset_group,
        note: item.note,
        sets: item.sets,
      })),
    };
    const options = { onSuccess: () => navigate("/gym") };
    if (templateId === null) create.mutate(input, options);
    else replace.mutate({ id: templateId, input }, options);
  }

  const restItem = items.find((item) => item.key === restFor);

  return (
    <div>
      <header className="app-header">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-2 py-2">
          <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>
            Annulla
          </button>
          <h1 className="text-[17px] font-semibold text-slate-900">
            {templateId === null ? "Nuovo modello" : "Modifica modello"}
          </h1>
          <button type="button" className="btn-ghost font-semibold text-sky-600" disabled={!canSave} onClick={save}>
            Salva
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {!loaded && <p className="py-6 text-center text-sm text-slate-500">Caricamento...</p>}
        {(create.isError || replace.isError) && (
          <p className="card px-4 py-3 text-sm text-red-600">Salvataggio non riuscito.</p>
        )}

        <div className="card space-y-3 p-4">
          <div>
            <label htmlFor="template-name" className="field-label">
              Nome del modello
            </label>
            <input
              id="template-name"
              className="field mt-1.5"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="template-folder" className="field-label">
              Cartella
            </label>
            <select
              id="template-folder"
              className="field mt-1.5"
              value={folderId ?? ""}
              onChange={(event) => setFolderId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Nessuna cartella</option>
              {templates.data?.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {items.map((item, index) => {
          const fields = setFields(item.exercise.tracking);
          return (
            <section
              key={item.key}
              aria-label={item.exercise.name}
              className={`card p-3 ${item.superset_group !== null ? "border-l-4 border-l-sky-400" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-[17px] font-semibold text-sky-600">{item.exercise.name}</h2>
                  <p className="truncate text-[13px] text-slate-500">
                    {exerciseSubtitle(item.exercise)}
                    {item.superset_group !== null && " · Superserie"}
                  </p>
                </div>
                <ActionMenu label={`Azioni ${item.exercise.name}`} actions={actionsFor(item, index)} />
              </div>

              <div
                className="mt-3 grid items-center gap-2 text-center text-[13px] font-semibold text-slate-600"
                style={{ gridTemplateColumns: `2.25rem repeat(${fields.length}, minmax(0,1fr)) 2.25rem` }}
              >
                <span>Serie</span>
                {fields.map((field) => (
                  <span key={field}>{FIELD_META[field].label}</span>
                ))}
                <span />
                {item.sets.map((set, n) => (
                  <div key={n} className="contents">
                    <span className="rounded-lg bg-slate-100 py-1.5 text-[15px] text-slate-700">{n + 1}</span>
                    {fields.map((field) => (
                      <NumberInput
                        key={field}
                        label={`${FIELD_META[field].label} serie ${n + 1}`}
                        kind={FIELD_META[field].kind}
                        value={set[field]}
                        onChange={(value) => updateSet(item.key, n, { [field]: value } as Partial<SetValues>)}
                      />
                    ))}
                    <button
                      type="button"
                      aria-label={`Elimina serie ${n + 1}`}
                      disabled={item.sets.length === 1}
                      onClick={() => removeSet(item.key, n)}
                      className="text-xl text-slate-400 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => addSet(item.key)}
                className="mt-2 w-full rounded-lg bg-slate-100 py-2 text-[15px] font-semibold text-slate-700 active:bg-slate-200"
              >
                + Aggiungi serie
              </button>
              <button
                type="button"
                onClick={() => setRestFor(item.key)}
                className="mt-2 w-full text-center text-[13px] font-semibold text-sky-600"
              >
                Riposo {restLabel(item.rest_seconds)}
              </button>
            </section>
          );
        })}

        <button type="button" className="btn-secondary w-full text-sky-600" onClick={() => setPicking(true)}>
          + Aggiungi esercizio
        </button>
      </div>

      {picking && <ExercisePicker onPick={addExercises} onClose={() => setPicking(false)} />}
      {restItem && (
        <RestPicker
          value={restItem.rest_seconds}
          onClose={() => setRestFor(null)}
          onChange={(seconds) => {
            update(restItem.key, { rest_seconds: seconds });
            setRestFor(null);
          }}
        />
      )}
    </div>
  );
}

export default TemplateEditorPage;
```

- [ ] **Step 7: Run tests and build**

Run: `npx vitest run src/components/gym/NumberInput.test.tsx src/pages/gym/TemplateEditorPage.test.tsx` → PASS; `npm test` → all pass; `npm run build` → success.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/gym web/src/pages/gym/GymStartPage.tsx web/src/pages/gym/TemplateEditorPage.tsx web/src/pages/gym/TemplateEditorPage.test.tsx
git commit -m "feat(web): template folders, start page and template editor"
```

---
### Task 12: Web — riga serie, timer di riposo, card esercizio live

**Files:**
- Create: `web/src/components/gym/SetRow.tsx`, `web/src/components/gym/SetRow.test.tsx`
- Create: `web/src/components/gym/RestTimerBar.tsx`, `web/src/components/gym/RestTimerBar.test.tsx`
- Create: `web/src/components/gym/WorkoutExerciseCard.tsx`

**Interfaces:**
- Consumes: `useLiveMutation`, `gymApi`, types (Task 8); `formatSet`, `formatDuration`, `FIELD_META`, `setFields`, `setGridColumns`, `restLabel` (Task 8); `clockOffsetMs`, `remainingSeconds`, `beep`, `vibrate` (Task 8); `useNow` (Task 8); `NumberInput` (Task 11); `ActionMenu` (Task 10).
- Produces:
  - `SetRow({ index, tracking, set, onSave, onComplete, onUncomplete, onDelete })` — `onSave(values: SetValues)` debounced 500 ms and flushed on blur/unmount; `onComplete(values)` sends the current values (pending save cancelled).
  - `RestTimerBar({ workout, onAdjust, onSkip })` — must stay mounted while the workout page is open; renders nothing when no rest is running; beeps and vibrates once when a running rest reaches zero.
  - `WorkoutExerciseCard({ workoutId, item, actions, onShowExercise, onPickRest })`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/gym/SetRow.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkoutSet } from "../../api/gym";
import SetRow from "./SetRow";

const baseSet: WorkoutSet = {
  id: 11, weight_kg: 80, reps: 8, duration_s: null, completed_at: null,
  previous: { weight_kg: 77.5, reps: 8, duration_s: null },
};

function setup(set: WorkoutSet = baseSet) {
  const handlers = {
    onSave: vi.fn(), onComplete: vi.fn(), onUncomplete: vi.fn(), onDelete: vi.fn(),
  };
  render(<SetRow index={0} tracking="weight_reps" set={set} {...handlers} />);
  return handlers;
}

describe("SetRow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the previous values and copies them on tap", () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Usa precedente serie 1" }));
    expect(screen.getByLabelText("kg serie 1")).toHaveValue("77,5");
    act(() => vi.advanceTimersByTime(500));
    expect(onSave).toHaveBeenCalledWith({ weight_kg: 77.5, reps: 8, duration_s: null });
  });

  it("debounces edits", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("kg serie 1"), { target: { value: "85" } });
    fireEvent.change(screen.getByLabelText("Rip. serie 1"), { target: { value: "6" } });
    expect(onSave).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ weight_kg: 85, reps: 6, duration_s: null });
  });

  it("completes with the typed values and drops the pending save", () => {
    const { onSave, onComplete } = setup();
    fireEvent.change(screen.getByLabelText("kg serie 1"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Completa serie 1" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(onComplete).toHaveBeenCalledWith({ weight_kg: 90, reps: 8, duration_s: null });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("unticks a completed set", () => {
    const { onUncomplete } = setup({ ...baseSet, completed_at: "2026-09-24T18:00:00Z" });
    fireEvent.click(screen.getByRole("button", { name: "Annulla serie 1" }));
    expect(onUncomplete).toHaveBeenCalled();
  });
});
```

`web/src/components/gym/RestTimerBar.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workout } from "../../api/gym";
import { beep, vibrate } from "../../lib/restTimer";
import RestTimerBar from "./RestTimerBar";

vi.mock("../../lib/restTimer", async () => {
  const actual = await vi.importActual<typeof import("../../lib/restTimer")>("../../lib/restTimer");
  return { ...actual, beep: vi.fn(), vibrate: vi.fn() };
});

const NOW = Date.parse("2026-09-24T18:00:00Z");

function workout(restEndsAt: string | null): Workout {
  return {
    id: 1, name: "Giorno 1", template_id: null, status: "in_progress",
    started_at: "2026-09-24T17:30:00Z", finished_at: null, rest_ends_at: restEndsAt,
    rest_total_s: 90, server_now: new Date(NOW).toISOString(), exercises: [], template_diff: [],
  };
}

describe("RestTimerBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing without a running rest", () => {
    render(<RestTimerBar workout={workout(null)} onAdjust={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("counts down, then beeps once and hides", () => {
    render(<RestTimerBar workout={workout("2026-09-24T18:00:05Z")} onAdjust={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByRole("timer")).toHaveTextContent("0:05");
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("timer")).toHaveTextContent("0:03");
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(beep).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(4000));
    expect(beep).toHaveBeenCalledTimes(1);
  });

  it("adjusts and skips", () => {
    const onAdjust = vi.fn();
    const onSkip = vi.fn();
    render(<RestTimerBar workout={workout("2026-09-24T18:01:00Z")} onAdjust={onAdjust} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "-15s" }));
    fireEvent.click(screen.getByRole("button", { name: "+15s" }));
    fireEvent.click(screen.getByRole("button", { name: "Salta" }));
    expect(onAdjust.mock.calls).toEqual([[-15], [15]]);
    expect(onSkip).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/gym/SetRow.test.tsx src/components/gym/RestTimerBar.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `SetRow`**

`web/src/components/gym/SetRow.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";

import type { SetValues, Tracking, WorkoutSet } from "../../api/gym";
import { FIELD_META, formatSet, setFields, setGridColumns } from "../../lib/gym";
import ActionMenu from "./ActionMenu";
import NumberInput from "./NumberInput";

const SAVE_DELAY_MS = 500;

function pick(values: SetValues): SetValues {
  return { weight_kg: values.weight_kg, reps: values.reps, duration_s: values.duration_s };
}

interface SetRowProps {
  index: number;
  tracking: Tracking;
  set: WorkoutSet;
  onSave: (values: SetValues) => void;
  onComplete: (values: SetValues) => void;
  onUncomplete: () => void;
  onDelete: () => void;
}

/** One row of the live table: Serie | Precedente | kg | Rip. | ✓.
 *
 * Typed values live here first and reach the server after 500 ms of quiet,
 * on blur or on unmount. The tick sends the current values together with
 * the completion (and cancels the pending save), so nothing typed is lost
 * when the user ticks right after typing. While no local edit is pending the
 * row follows the server's values. */
function SetRow({ index, tracking, set, onSave, onComplete, onUncomplete, onDelete }: SetRowProps) {
  const [values, setValues] = useState<SetValues>(() => pick(set));
  const latest = useRef(values);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    if (timer.current === null) {
      const next = pick(set);
      latest.current = next;
      setValues(next);
    }
  }, [set.weight_kg, set.reps, set.duration_s]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        saveRef.current(latest.current);
      }
    },
    [],
  );

  function flush() {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    onSave(latest.current);
  }

  function change(patch: Partial<SetValues>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setValues(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }

  function toggle() {
    if (set.completed_at) {
      onUncomplete();
      return;
    }
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    onComplete(latest.current);
  }

  const done = set.completed_at !== null;
  const fields = setFields(tracking);
  const number = index + 1;

  return (
    <div
      className={`grid items-center gap-2 rounded-lg px-1 py-1 transition-colors ${done ? "bg-brand-50" : ""}`}
      style={{ gridTemplateColumns: setGridColumns(fields.length) }}
    >
      <ActionMenu
        label={`Serie ${number}`}
        trigger={number}
        triggerClassName="h-9 w-full rounded-lg bg-slate-100 text-[15px] font-semibold text-slate-700"
        actions={[{ label: "Elimina serie", onSelect: onDelete, destructive: true }]}
      />
      <button
        type="button"
        aria-label={`Usa precedente serie ${number}`}
        disabled={!set.previous}
        onClick={() => set.previous && change(pick(set.previous))}
        className="truncate text-center text-[14px] text-slate-400"
      >
        {set.previous ? formatSet(tracking, set.previous) : "—"}
      </button>
      {fields.map((field) => (
        <NumberInput
          key={field}
          label={`${FIELD_META[field].label} serie ${number}`}
          kind={FIELD_META[field].kind}
          value={values[field]}
          onChange={(value) => change({ [field]: value } as Partial<SetValues>)}
          onBlur={flush}
        />
      ))}
      <button
        type="button"
        aria-label={done ? `Annulla serie ${number}` : `Completa serie ${number}`}
        aria-pressed={done}
        onClick={toggle}
        className={`flex h-9 w-full items-center justify-center rounded-lg transition ${
          done ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500 active:bg-slate-200"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
          <path d="m5 12 5 5 9-10" />
        </svg>
      </button>
    </div>
  );
}

export default SetRow;
```

(The project has no eslint config; the `eslint-disable-line` comment documents the intentional dependency list. Drop it if it causes a lint error.)

- [ ] **Step 4: Write `RestTimerBar`**

`web/src/components/gym/RestTimerBar.tsx`:

```tsx
import { useEffect, useMemo, useRef } from "react";

import type { Workout } from "../../api/gym";
import { formatDuration } from "../../lib/gym";
import { beep, clockOffsetMs, remainingSeconds, vibrate } from "../../lib/restTimer";
import { useNow } from "../../lib/useNow";

interface RestTimerBarProps {
  workout: Workout;
  onAdjust: (deltaSeconds: number) => void;
  onSkip: () => void;
}

/** Countdown under the workout header. Keep it mounted: it renders nothing
 * when no rest runs, but still has to notice the moment a rest reaches zero
 * to beep (once per `rest_ends_at`). */
function RestTimerBar({ workout, onAdjust, onSkip }: RestTimerBarProps) {
  const now = useNow(250);
  const offset = useMemo(() => clockOffsetMs(workout.server_now, Date.now()), [workout.server_now]);
  const remaining = remainingSeconds(workout.rest_ends_at, offset, now);
  const seenRunning = useRef<string | null>(null);
  const fired = useRef<string | null>(null);

  useEffect(() => {
    const endsAt = workout.rest_ends_at;
    if (!endsAt) return;
    if (remaining > 0) {
      seenRunning.current = endsAt;
      return;
    }
    if (seenRunning.current === endsAt && fired.current !== endsAt) {
      fired.current = endsAt;
      beep();
      vibrate();
    }
  }, [remaining, workout.rest_ends_at]);

  if (remaining <= 0) return null;
  const total = workout.rest_total_s ?? remaining;

  return (
    <div role="timer" aria-label="Riposo" className="border-t border-sky-100 bg-sky-50">
      <div className="h-1 bg-sky-100">
        <div
          className="h-1 bg-sky-500 transition-[width] duration-200"
          style={{ width: `${Math.min(100, (remaining / total) * 100)}%` }}
        />
      </div>
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-2">
        <button type="button" className="btn-secondary min-h-[36px] px-3" onClick={() => onAdjust(-15)}>
          -15s
        </button>
        <span className="text-2xl font-semibold tabular-nums text-sky-700">{formatDuration(remaining)}</span>
        <button type="button" className="btn-secondary min-h-[36px] px-3" onClick={() => onAdjust(15)}>
          +15s
        </button>
        <button type="button" className="btn-ghost min-h-[36px] text-sky-700" onClick={onSkip}>
          Salta
        </button>
      </div>
    </div>
  );
}

export default RestTimerBar;
```

- [ ] **Step 5: Write `WorkoutExerciseCard`**

`web/src/components/gym/WorkoutExerciseCard.tsx`:

```tsx
import { Fragment } from "react";

import type { WorkoutExercise } from "../../api/gym";
import { gymApi, useLiveMutation } from "../../api/gym";
import { FIELD_META, formatDuration, restLabel, setFields, setGridColumns } from "../../lib/gym";
import ActionMenu, { type Action } from "./ActionMenu";
import SetRow from "./SetRow";

interface WorkoutExerciseCardProps {
  workoutId: number;
  item: WorkoutExercise;
  /** Exercise-level menu, built by the page (it knows the whole layout). */
  actions: Action[];
  onShowExercise: () => void;
  onPickRest: () => void;
}

function WorkoutExerciseCard({ workoutId, item, actions, onShowExercise, onPickRest }: WorkoutExerciseCardProps) {
  const patchSet = useLiveMutation(gymApi.patchSet);
  const completeSet = useLiveMutation(gymApi.completeSet);
  const uncompleteSet = useLiveMutation(gymApi.uncompleteSet);
  const deleteSet = useLiveMutation(gymApi.deleteSet);
  const addSet = useLiveMutation(gymApi.addSet);
  const fields = setFields(item.exercise.tracking);
  const inSuperset = item.superset_group !== null;

  return (
    <section
      aria-label={item.exercise.name}
      className={`card p-3 ${inSuperset ? "border-l-4 border-l-sky-400" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onShowExercise}
          className="min-w-0 truncate text-left text-[17px] font-semibold text-sky-600"
        >
          {item.exercise.name}
        </button>
        <ActionMenu label={`Azioni ${item.exercise.name}`} actions={actions} />
      </div>
      {inSuperset && <p className="text-xs font-semibold uppercase tracking-wide text-sky-500">Superserie</p>}
      {item.note && <p className="mt-1 text-sm italic text-slate-500">{item.note}</p>}

      <div
        className="mt-2 grid gap-2 px-1 text-center text-[13px] font-semibold text-slate-600"
        style={{ gridTemplateColumns: setGridColumns(fields.length) }}
      >
        <span>Serie</span>
        <span>Precedente</span>
        {fields.map((field) => (
          <span key={field}>{FIELD_META[field].label}</span>
        ))}
        <span aria-hidden>✓</span>
      </div>

      <div className="mt-1 space-y-1">
        {item.sets.map((set, index) => (
          <Fragment key={set.id}>
            <SetRow
              index={index}
              tracking={item.exercise.tracking}
              set={set}
              onSave={(values) => patchSet.mutate({ workoutId, id: set.id, values })}
              onComplete={(values) => completeSet.mutate({ workoutId, id: set.id, values })}
              onUncomplete={() => uncompleteSet.mutate({ workoutId, id: set.id })}
              onDelete={() => deleteSet.mutate({ workoutId, id: set.id })}
            />
            {item.rest_seconds > 0 && (
              <button
                type="button"
                onClick={onPickRest}
                aria-label={`Riposo ${restLabel(item.rest_seconds)}`}
                className="flex w-full items-center gap-2 text-[13px] font-semibold tabular-nums text-sky-600"
              >
                <span className="h-0.5 flex-1 rounded bg-sky-100" />
                {formatDuration(item.rest_seconds)}
                <span className="h-0.5 flex-1 rounded bg-sky-100" />
              </button>
            )}
          </Fragment>
        ))}
      </div>

      <button
        type="button"
        onClick={() => addSet.mutate({ workoutId, exerciseId: item.id })}
        className="mt-2 w-full rounded-lg bg-slate-100 py-2 text-[15px] font-semibold text-slate-700 active:bg-slate-200"
      >
        + Aggiungi serie ({restLabel(item.rest_seconds)})
      </button>
    </section>
  );
}

export default WorkoutExerciseCard;
```

- [ ] **Step 6: Run tests and build**

Run: `npx vitest run src/components/gym` → PASS; `npm test`; `npm run build` → success.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/gym/SetRow.tsx web/src/components/gym/SetRow.test.tsx web/src/components/gym/RestTimerBar.tsx web/src/components/gym/RestTimerBar.test.tsx web/src/components/gym/WorkoutExerciseCard.tsx
git commit -m "feat(web): live set rows, rest timer bar and exercise cards"
```

---

### Task 13: Web — pagina allenamento in corso

**Files:**
- Replace: `web/src/pages/gym/WorkoutPage.tsx`
- Test: `web/src/pages/gym/WorkoutPage.test.tsx`

**Interfaces:**
- Consumes: `useActiveWorkout`, `useLiveMutation`, `gymApi`, `useFinishWorkout`, `useCancelWorkout` (Task 8); `LiveErrorContext` (Task 8); `liveErrorMessage`, `elapsedLabel`, `linkWithNext`, `unlinkFromGroup`, `moveItem` (Task 8); `unlockAudio` (Task 8); `useNow` (Task 8); `WorkoutExerciseCard`, `RestTimerBar` (Task 12); `ExercisePicker`, `ExerciseDetailSheet` (Task 10); `RestPicker` (Task 11); `Action` (Task 10).
- Produces: default export `WorkoutPage` at `/gym/workout`. On finish it navigates to `/gym/history/:id?summary=1` (page from Task 14).

- [ ] **Step 1: Write the failing test**

`web/src/pages/gym/WorkoutPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workout } from "../../api/gym";
import { useActiveWorkout, useCancelWorkout, useFinishWorkout, useLiveMutation } from "../../api/gym";
import WorkoutPage from "./WorkoutPage";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return {
    ...actual,
    useActiveWorkout: vi.fn(),
    useLiveMutation: vi.fn(),
    useFinishWorkout: vi.fn(),
    useCancelWorkout: vi.fn(),
  };
});

const workout: Workout = {
  id: 5, name: "Giorno 1", template_id: 2, status: "in_progress",
  started_at: new Date().toISOString(), finished_at: null, rest_ends_at: null, rest_total_s: null,
  server_now: new Date().toISOString(), template_diff: [],
  exercises: [
    {
      id: 21, rest_seconds: 90, superset_group: null, note: null,
      exercise: {
        id: 7, name: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"],
        secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
      },
      sets: [
        { id: 31, weight_kg: 80, reps: 8, duration_s: null, completed_at: "2026-09-24T18:00:00Z", previous: null },
        { id: 32, weight_kg: 80, reps: 8, duration_s: null, completed_at: null, previous: null },
      ],
    },
  ],
};

const finish = vi.fn();

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/gym/workout"]}>
      <Routes>
        <Route path="/gym/workout" element={<WorkoutPage />} />
        <Route path="/gym/history/:id" element={<div>Summary</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkoutPage", () => {
  beforeEach(() => {
    finish.mockReset();
    vi.mocked(useActiveWorkout).mockReturnValue({ data: workout, isLoading: false, isError: false } as unknown as ReturnType<typeof useActiveWorkout>);
    vi.mocked(useLiveMutation).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useLiveMutation>);
    vi.mocked(useFinishWorkout).mockReturnValue({ mutate: finish, isPending: false } as unknown as ReturnType<typeof useFinishWorkout>);
    vi.mocked(useCancelWorkout).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useCancelWorkout>);
  });

  it("shows the exercises with their sets", () => {
    renderPage();
    expect(screen.getByRole("region", { name: "Barbell Squat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annulla serie 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Completa serie 2" })).toBeInTheDocument();
  });

  it("asks before discarding undone sets, then finishes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Termina" }));

    expect(confirm).toHaveBeenCalledWith("Ci sono 1 serie non completate. Verranno scartate.");
    expect(finish).toHaveBeenCalledWith({ workoutId: 5, discardIncomplete: true }, expect.anything());
  });

  it("does not finish when the user keeps the undone sets", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Termina" }));
    expect(finish).not.toHaveBeenCalled();
  });

  it("explains when there is no live workout", () => {
    vi.mocked(useActiveWorkout).mockReturnValue({ data: null, isLoading: false, isError: false } as unknown as ReturnType<typeof useActiveWorkout>);
    renderPage();
    expect(screen.getByText("Nessun allenamento in corso.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pages/gym/WorkoutPage.test.tsx`
Expected: FAIL (the stub renders no exercises).

- [ ] **Step 3: Write the page**

Replace `web/src/pages/gym/WorkoutPage.tsx`:

```tsx
import { useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { Exercise, WorkoutExercise } from "../../api/gym";
import {
  gymApi,
  useActiveWorkout,
  useCancelWorkout,
  useFinishWorkout,
  useLiveMutation,
} from "../../api/gym";
import type { Action } from "../../components/gym/ActionMenu";
import ExerciseDetailSheet from "../../components/gym/ExerciseDetailSheet";
import ExercisePicker from "../../components/gym/ExercisePicker";
import RestPicker from "../../components/gym/RestPicker";
import RestTimerBar from "../../components/gym/RestTimerBar";
import WorkoutExerciseCard from "../../components/gym/WorkoutExerciseCard";
import {
  elapsedLabel,
  linkWithNext,
  liveErrorMessage,
  moveItem,
  unlinkFromGroup,
} from "../../lib/gym";
import { LiveErrorContext } from "../../lib/liveErrors";
import { unlockAudio } from "../../lib/restTimer";
import { useNow } from "../../lib/useNow";

type PickerState = { mode: "add" } | { mode: "replace"; itemId: number } | null;

/** The live session (Strong's workout sheet): full screen, no tab bar.
 * Every edit is saved at once through `useLiveMutation`; failures show up
 * as a toast via `LiveErrorContext`. */
function WorkoutPage() {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  return (
    <LiveErrorContext.Provider value={setToast}>
      <WorkoutSession />
      {toast && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-[calc(1rem+var(--safe-bottom))] z-[60] mx-auto max-w-sm rounded-xl bg-red-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-sheet"
        >
          {toast}
        </div>
      )}
    </LiveErrorContext.Provider>
  );
}

function WorkoutSession() {
  const navigate = useNavigate();
  const report = useContext(LiveErrorContext);
  const { data: workout, isLoading, isError } = useActiveWorkout();
  const now = useNow(1000);
  const rename = useLiveMutation(gymApi.renameWorkout);
  const addExercise = useLiveMutation(gymApi.addExercise);
  const patchExercise = useLiveMutation(gymApi.patchExercise);
  const removeExercise = useLiveMutation(gymApi.removeExercise);
  const setLayout = useLiveMutation(gymApi.setLayout);
  const rest = useLiveMutation(gymApi.rest);
  const finish = useFinishWorkout();
  const cancel = useCancelWorkout();
  const [picker, setPicker] = useState<PickerState>(null);
  const [restFor, setRestFor] = useState<number | null>(null);
  const [manualRest, setManualRest] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  if (isLoading) return <p className="py-16 text-center text-sm text-slate-500">Caricamento...</p>;
  if (isError) {
    return <p className="p-6 text-center text-sm text-red-600">Errore nel caricamento dell'allenamento.</p>;
  }
  if (!workout) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-app p-6 text-center">
        <p className="text-slate-600">Nessun allenamento in corso.</p>
        <Link to="/gym" className="btn-primary">
          Vai ai modelli
        </Link>
      </div>
    );
  }

  const workoutId = workout.id;
  const items = workout.exercises;
  const groups = items.map((item) => item.superset_group);

  function layout(order: WorkoutExercise[], nextGroups: (number | null)[]) {
    setLayout.mutate({
      workoutId,
      items: order.map((item, n) => ({ id: item.id, superset_group: nextGroups[n] })),
    });
  }

  function actionsFor(item: WorkoutExercise, index: number): Action[] {
    const actions: Action[] = [
      { label: "Sostituisci esercizio", onSelect: () => setPicker({ mode: "replace", itemId: item.id }) },
      { label: "Riposo", onSelect: () => setRestFor(item.id) },
      {
        label: item.note ? "Modifica nota" : "Aggiungi nota",
        onSelect: () => {
          const note = window.prompt("Nota", item.note ?? "");
          if (note !== null) patchExercise.mutate({ workoutId, id: item.id, note: note.trim() || null });
        },
      },
    ];
    if (index > 0) {
      actions.push({
        label: "Sposta su",
        onSelect: () => layout(moveItem(items, index, -1), moveItem(groups, index, -1)),
      });
    }
    if (index < items.length - 1) {
      actions.push({
        label: "Sposta giù",
        onSelect: () => layout(moveItem(items, index, 1), moveItem(groups, index, 1)),
      });
      actions.push({ label: "Collega al successivo", onSelect: () => layout(items, linkWithNext(groups, index)) });
    }
    if (item.superset_group !== null) {
      actions.push({ label: "Scollega superserie", onSelect: () => layout(items, unlinkFromGroup(groups, index)) });
    }
    actions.push({
      label: "Rimuovi esercizio",
      destructive: true,
      onSelect: () => {
        if (window.confirm(`Rimuovere ${item.exercise.name} dall'allenamento?`)) {
          removeExercise.mutate({ workoutId, id: item.id });
        }
      },
    });
    return actions;
  }

  function pickExercises(list: Exercise[]) {
    if (picker?.mode === "replace") {
      patchExercise.mutate({ workoutId, id: picker.itemId, exercise_id: list[0].id });
    } else {
      for (const exercise of list) addExercise.mutate({ workoutId, exerciseId: exercise.id });
    }
    setPicker(null);
  }

  function handleFinish() {
    const sets = items.flatMap((item) => item.sets);
    const done = sets.filter((set) => set.completed_at !== null).length;
    const pending = sets.length - done;
    if (done === 0) {
      window.alert("Nessuna serie completata. Completa almeno una serie o annulla l'allenamento.");
      return;
    }
    if (pending > 0 && !window.confirm(`Ci sono ${pending} serie non completate. Verranno scartate.`)) return;
    finish.mutate(
      { workoutId, discardIncomplete: pending > 0 },
      {
        onSuccess: (finished) => navigate(`/gym/history/${finished.id}?summary=1`, { replace: true }),
        onError: (error) => report(liveErrorMessage(error)),
      },
    );
  }

  function handleCancel() {
    if (!window.confirm("Annullare l'allenamento? Le serie registrate verranno eliminate.")) return;
    cancel.mutate(workoutId, {
      onSuccess: () => navigate("/gym", { replace: true }),
      onError: (error) => report(liveErrorMessage(error)),
    });
  }

  const restItem = items.find((item) => item.id === restFor);

  return (
    <div className="min-h-screen bg-app pb-[calc(2rem+var(--safe-bottom))]" onPointerDown={unlockAudio}>
      <header className="app-header">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-2 py-2">
          <div className="flex">
            <button type="button" aria-label="Riduci" className="btn-ghost w-11" onClick={() => navigate("/gym")}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <button type="button" aria-label="Timer di riposo" className="btn-ghost w-11" onClick={() => setManualRest(true)}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <circle cx="12" cy="13" r="8" />
                <path d="M12 9v4l2 2M10 2h4" />
              </svg>
            </button>
          </div>
          <span className="text-[15px] font-semibold tabular-nums text-slate-600">
            {elapsedLabel(workout.started_at, now)}
          </span>
          <button type="button" className="btn-primary px-5" onClick={handleFinish} disabled={finish.isPending}>
            Termina
          </button>
        </div>
        <RestTimerBar
          workout={workout}
          onAdjust={(delta) => rest.mutate({ workoutId, action: { delta_s: delta } })}
          onSkip={() => rest.mutate({ workoutId, action: { skip: true } })}
        />
      </header>

      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <input
          key={workout.name}
          aria-label="Nome allenamento"
          defaultValue={workout.name}
          maxLength={100}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== workout.name) rename.mutate({ workoutId, name });
          }}
          className="w-full bg-transparent text-2xl font-bold text-slate-900 focus:outline-none"
        />

        {items.map((item, index) => (
          <WorkoutExerciseCard
            key={item.id}
            workoutId={workoutId}
            item={item}
            actions={actionsFor(item, index)}
            onShowExercise={() => setDetailId(item.exercise.id)}
            onPickRest={() => setRestFor(item.id)}
          />
        ))}

        <button type="button" className="btn-secondary w-full text-sky-600" onClick={() => setPicker({ mode: "add" })}>
          + Aggiungi esercizio
        </button>
        <button type="button" className="btn-ghost w-full text-red-600" onClick={handleCancel} disabled={cancel.isPending}>
          Annulla allenamento
        </button>
      </div>

      {picker && (
        <ExercisePicker
          title={picker.mode === "replace" ? "Sostituisci esercizio" : "Aggiungi esercizi"}
          multiple={picker.mode === "add"}
          onPick={pickExercises}
          onClose={() => setPicker(null)}
        />
      )}
      {restItem && (
        <RestPicker
          value={restItem.rest_seconds}
          onClose={() => setRestFor(null)}
          onChange={(seconds) => {
            patchExercise.mutate({ workoutId, id: restItem.id, rest_seconds: seconds });
            setRestFor(null);
          }}
        />
      )}
      {manualRest && (
        <RestPicker
          title="Avvia timer"
          value={90}
          onClose={() => setManualRest(false)}
          onChange={(seconds) => {
            if (seconds > 0) rest.mutate({ workoutId, action: { start_s: seconds } });
            setManualRest(false);
          }}
        />
      )}
      {detailId !== null && <ExerciseDetailSheet exerciseId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

export default WorkoutPage;
```

- [ ] **Step 4: Run tests and build**

Run: `npx vitest run src/pages/gym/WorkoutPage.test.tsx` → PASS; `npm test`; `npm run build` → success.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/gym/WorkoutPage.tsx web/src/pages/gym/WorkoutPage.test.tsx
git commit -m "feat(web): live workout page with finish, cancel and superset actions"
```

---

### Task 14: Web — riepilogo, dettaglio e storico

**Files:**
- Replace: `web/src/pages/gym/WorkoutDetailPage.tsx`, `web/src/pages/gym/HistoryPage.tsx`
- Test: `web/src/pages/gym/WorkoutDetailPage.test.tsx`

**Interfaces:**
- Consumes: `useWorkout`, `useApplyToTemplate`, `useSaveAsTemplate`, `useDeleteWorkout`, `useHistory` (Task 8); `formatSet`, `durationLabel`, `workoutDateLabel`, `monthLabel` (Task 8); `ActionMenu` (Task 10); `ModeSwitch` (Task 9).
- Produces: `/gym/history/:id` — with `?summary=1` it is the end-of-workout summary: shows the `template_diff` box with "Aggiorna modello" / "Mantieni modello", or "Salva come modello" when the workout has no template. `/gym/history` — list grouped by month with "Carica altri".

- [ ] **Step 1: Write the failing test**

`web/src/pages/gym/WorkoutDetailPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workout } from "../../api/gym";
import { useApplyToTemplate, useDeleteWorkout, useSaveAsTemplate, useWorkout } from "../../api/gym";
import WorkoutDetailPage from "./WorkoutDetailPage";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return {
    ...actual,
    useWorkout: vi.fn(),
    useApplyToTemplate: vi.fn(),
    useSaveAsTemplate: vi.fn(),
    useDeleteWorkout: vi.fn(),
  };
});

const finished: Workout = {
  id: 9, name: "Giorno 1", template_id: 2, status: "finished",
  started_at: "2026-09-24T18:00:00Z", finished_at: "2026-09-24T19:05:00Z",
  rest_ends_at: null, rest_total_s: null, server_now: "2026-09-24T19:05:00Z",
  template_diff: ["Barbell Squat: serie 1 80 kg × 8 → 85 kg × 8"],
  exercises: [
    {
      id: 21, rest_seconds: 90, superset_group: null, note: null,
      exercise: {
        id: 7, name: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"],
        secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
      },
      sets: [{ id: 31, weight_kg: 85, reps: 8, duration_s: null, completed_at: "2026-09-24T18:10:00Z", previous: null }],
    },
  ],
};

const apply = vi.fn();
const saveAs = vi.fn();

function mockWorkout(workout: Workout) {
  vi.mocked(useWorkout).mockReturnValue({ data: workout, isLoading: false, isError: false } as unknown as ReturnType<typeof useWorkout>);
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/gym/history/:id" element={<WorkoutDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkoutDetailPage", () => {
  beforeEach(() => {
    apply.mockReset();
    saveAs.mockReset();
    vi.mocked(useApplyToTemplate).mockReturnValue({ mutate: apply, isPending: false, isSuccess: false } as unknown as ReturnType<typeof useApplyToTemplate>);
    vi.mocked(useSaveAsTemplate).mockReturnValue({ mutate: saveAs, isPending: false, isSuccess: false } as unknown as ReturnType<typeof useSaveAsTemplate>);
    vi.mocked(useDeleteWorkout).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useDeleteWorkout>);
  });

  it("offers to update the template in the summary", async () => {
    mockWorkout(finished);
    const user = userEvent.setup();
    renderAt("/gym/history/9?summary=1");

    expect(screen.getByText("Allenamento completato")).toBeInTheDocument();
    expect(screen.getByText("1 h 5 min")).toBeInTheDocument();
    expect(screen.getByText("85 kg × 8")).toBeInTheDocument();
    expect(screen.getByText("Barbell Squat: serie 1 80 kg × 8 → 85 kg × 8")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Aggiorna modello" }));
    expect(apply).toHaveBeenCalledWith(9);
  });

  it("hides the diff when the user keeps the template", async () => {
    mockWorkout(finished);
    const user = userEvent.setup();
    renderAt("/gym/history/9?summary=1");
    await user.click(screen.getByRole("button", { name: "Mantieni modello" }));
    expect(screen.queryByRole("button", { name: "Aggiorna modello" })).not.toBeInTheDocument();
  });

  it("does not show the diff outside the summary", () => {
    mockWorkout(finished);
    renderAt("/gym/history/9");
    expect(screen.queryByText("Modifiche rispetto al modello")).not.toBeInTheDocument();
  });

  it("offers to save a workout without template as a template", async () => {
    mockWorkout({ ...finished, template_id: null, template_diff: [] });
    vi.spyOn(window, "prompt").mockReturnValue("Nuovo modello");
    const user = userEvent.setup();
    renderAt("/gym/history/9?summary=1");
    await user.click(screen.getByRole("button", { name: "Salva come modello" }));
    expect(saveAs).toHaveBeenCalledWith({ workoutId: 9, name: "Nuovo modello" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pages/gym/WorkoutDetailPage.test.tsx`
Expected: FAIL (stub page).

- [ ] **Step 3: Write the detail page**

Replace `web/src/pages/gym/WorkoutDetailPage.tsx`:

```tsx
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useApplyToTemplate, useDeleteWorkout, useSaveAsTemplate, useWorkout } from "../../api/gym";
import ActionMenu from "../../components/gym/ActionMenu";
import { durationLabel, formatSet, workoutDateLabel } from "../../lib/gym";

/** A finished workout. With `?summary=1` (right after "Termina") it is the
 * end-of-workout summary: if the sets differ from the template it offers to
 * update the template; a workout without template can become one. */
function WorkoutDetailPage() {
  const { id } = useParams();
  const workoutId = Number(id);
  const [params] = useSearchParams();
  const summary = params.get("summary") === "1";
  const navigate = useNavigate();
  const { data: workout, isLoading, isError } = useWorkout(workoutId);
  const apply = useApplyToTemplate();
  const saveAs = useSaveAsTemplate();
  const remove = useDeleteWorkout();
  const [keepTemplate, setKeepTemplate] = useState(false);

  function saveAsTemplate() {
    if (!workout) return;
    const name = window.prompt("Nome del modello", workout.name)?.trim();
    if (name) saveAs.mutate({ workoutId: workout.id, name });
  }

  function deleteWorkout() {
    if (!window.confirm("Eliminare questo allenamento dallo storico?")) return;
    remove.mutate(workoutId, { onSuccess: () => navigate("/gym/history", { replace: true }) });
  }

  const showDiff = summary && !keepTemplate && (workout?.template_diff.length ?? 0) > 0;

  return (
    <div>
      <header className="app-header">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-2 py-2">
          <button type="button" className="btn-ghost" onClick={() => navigate(summary ? "/gym" : "/gym/history")}>
            {summary ? "Chiudi" : "‹ Storico"}
          </button>
          <h1 className="truncate text-[17px] font-semibold text-slate-900">
            {summary ? "Allenamento completato" : (workout?.name ?? "Allenamento")}
          </h1>
          <ActionMenu
            label="Azioni allenamento"
            actions={[
              { label: "Salva come modello", onSelect: saveAsTemplate },
              { label: "Elimina", onSelect: deleteWorkout, destructive: true },
            ]}
          />
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {isLoading && <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>}
        {isError && <p className="card px-4 py-3 text-center text-sm text-red-600">Allenamento non trovato.</p>}

        {workout && (
          <>
            <div className="card p-4">
              <h2 className="text-xl font-bold text-slate-900">{workout.name}</h2>
              <p className="text-sm capitalize text-slate-500">{workoutDateLabel(workout.started_at)}</p>
              {workout.finished_at && (
                <p className="mt-1 text-sm font-semibold text-slate-700">
                  {durationLabel(workout.started_at, workout.finished_at)}
                </p>
              )}
            </div>

            {showDiff && (
              <section className="card border-sky-200 bg-sky-50 p-4">
                <h2 className="text-[15px] font-semibold text-slate-900">Modifiche rispetto al modello</h2>
                <ul className="mt-2 space-y-1 text-[14px] text-slate-700">
                  {workout.template_diff.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="btn-primary flex-1"
                    disabled={apply.isPending}
                    onClick={() => apply.mutate(workout.id)}
                  >
                    Aggiorna modello
                  </button>
                  <button type="button" className="btn-secondary flex-1" onClick={() => setKeepTemplate(true)}>
                    Mantieni modello
                  </button>
                </div>
              </section>
            )}
            {apply.isSuccess && (
              <p role="status" className="text-center text-sm font-semibold text-brand-700">
                Modello aggiornato.
              </p>
            )}

            {summary && workout.template_id === null && !saveAs.isSuccess && (
              <button type="button" className="btn-secondary w-full" onClick={saveAsTemplate}>
                Salva come modello
              </button>
            )}
            {saveAs.isSuccess && (
              <p role="status" className="text-center text-sm font-semibold text-brand-700">
                Modello salvato.
              </p>
            )}

            {workout.exercises.map((item) => (
              <section key={item.id} className="card p-4" aria-label={item.exercise.name}>
                <h3 className="text-[16px] font-semibold text-sky-600">{item.exercise.name}</h3>
                <ol className="mt-2 space-y-1">
                  {item.sets.map((set, index) => (
                    <li key={set.id} className="flex gap-3 text-[15px] text-slate-700">
                      <span className="w-6 font-semibold text-slate-400">{index + 1}</span>
                      <span>{formatSet(item.exercise.tracking, set)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}

            {summary && (
              <Link to="/gym" className="btn-primary w-full">
                Fine
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default WorkoutDetailPage;
```

- [ ] **Step 4: Write the history page**

Replace `web/src/pages/gym/HistoryPage.tsx`:

```tsx
import { Link } from "react-router-dom";

import type { HistoryItem } from "../../api/gym";
import { useHistory } from "../../api/gym";
import ModeSwitch from "../../components/ModeSwitch";
import { durationLabel, monthLabel, workoutDateLabel } from "../../lib/gym";

const SHOWN_EXERCISES = 4;

/** Finished workouts, newest first, grouped by month. */
function HistoryPage() {
  const history = useHistory();
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const groups: { label: string; items: HistoryItem[] }[] = [];
  for (const item of items) {
    const label = monthLabel(item.finished_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3 text-center">
          <h1 className="text-[17px] font-semibold text-slate-900">Storico</h1>
        </div>
      </header>
      <div className="mx-auto max-w-2xl space-y-5 p-4">
        {history.isLoading && <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>}
        {history.isError && (
          <p className="card px-4 py-3 text-center text-sm text-red-600">Errore nel caricamento dello storico.</p>
        )}
        {history.data && items.length === 0 && (
          <p className="card px-4 py-6 text-center text-sm text-slate-500">Nessun allenamento completato.</p>
        )}

        {groups.map((group) => (
          <section key={group.label} className="space-y-3">
            <h2 className="section-label capitalize">{group.label}</h2>
            {group.items.map((item) => (
              <Link key={item.id} to={`/gym/history/${item.id}`} className="card block p-4 active:bg-slate-50">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-[16px] font-semibold text-slate-900">{item.name}</h3>
                  <span className="shrink-0 text-xs text-slate-500">
                    {durationLabel(item.started_at, item.finished_at)}
                  </span>
                </div>
                <p className="text-[13px] capitalize text-slate-500">{workoutDateLabel(item.started_at)}</p>
                <ul className="mt-2 space-y-0.5 text-[14px] text-slate-700">
                  {item.exercises.slice(0, SHOWN_EXERCISES).map((exercise, index) => (
                    <li key={`${exercise.name}-${index}`}>
                      {exercise.sets} × {exercise.name}
                    </li>
                  ))}
                  {item.exercises.length > SHOWN_EXERCISES && (
                    <li className="text-slate-400">+{item.exercises.length - SHOWN_EXERCISES} altri</li>
                  )}
                </ul>
              </Link>
            ))}
          </section>
        ))}

        {history.hasNextPage && (
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            Carica altri
          </button>
        )}
      </div>
    </div>
  );
}

export default HistoryPage;
```

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run src/pages/gym/WorkoutDetailPage.test.tsx` → PASS; `npm test`; `npm run build` → success.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/gym/WorkoutDetailPage.tsx web/src/pages/gym/WorkoutDetailPage.test.tsx web/src/pages/gym/HistoryPage.tsx
git commit -m "feat(web): workout summary with template update, detail and history"
```

---

### Task 15: Documentazione e verifica finale

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Document the feature**

In `README.md`:
- In "What it does", add a bullet: `Gym log (Strong-style): exercise catalog from free-exercise-db plus custom exercises, workout templates in folders, a live session with previous values, per-exercise rest timer and supersets, a summary that can update the template, and workout history.`
- In "API", add the endpoint groups `/api/exercises`, `/api/templates`, `/api/template-folders`, `/api/workouts` with one line each, matching the style of the existing entries.
- In "Connecting an AI assistant (MCP)", list the gym tools: `search_exercises`, `list_workout_templates`, `get_workout_template`, `create_workout_template`, `list_workouts`, `get_workout` (need the `workouts.use` permission too).
- In "Deploying updates", note that this release has two migrations (`9a4d2c7e1f03` schema, `b81f5e3a6c42` catalog load) run by the usual `docker compose exec api alembic upgrade head`, and that the catalog lives in `api/app/data/exercises.json` (see `api/app/data/README.md`).

- [ ] **Step 2: Full local verification**

From `api/`:
- `.venv\Scripts\python -m ruff check app tests scripts` → clean
- `.venv\Scripts\python -c "import app.main"` → no output
- `.venv\Scripts\python -m pytest tests/test_gym_rules.py tests/test_gym_permission.py tests/test_exercise_catalog.py -k "not upsert" -v` → PASS
- `.venv\Scripts\python -m pytest --collect-only -q` → every module imports

From `web/`: `npm test` → all pass; `npm run build` → success.

Report the DB-backed modules that were written but not run: `test_gym_models.py`, `test_exercise_catalog.py::test_upsert_is_idempotent`, `test_exercises_service.py`, `test_templates_service.py`, `test_workouts_live.py`, `test_workouts_finish.py`, `test_gym_routers.py`, `test_mcp_tools_workouts.py`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the gym section, its API, MCP tools and migrations"
```

- [ ] **Step 4: Remote verification (orchestrator + user)**

Push the branch; on the deploy machine: `git pull`, `docker compose up -d --build`, `docker compose exec api alembic upgrade head`, then run the full pytest suite against the isolated `yfp_test` database (same procedure used for the MCP feature) and check the acceptance criteria of the spec on the phone.
