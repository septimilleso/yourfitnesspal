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
