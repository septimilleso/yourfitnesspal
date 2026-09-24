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
