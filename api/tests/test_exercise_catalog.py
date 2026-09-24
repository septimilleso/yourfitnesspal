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
