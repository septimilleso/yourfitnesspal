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
