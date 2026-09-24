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
