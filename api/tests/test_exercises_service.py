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
    with pytest.raises(PermissionMissing):
        await exercises.get_visible_exercises(db, user, [])
