"""GET /api/diary/range (needs Postgres)."""

from tests.factories import http_client, make_food, make_user


async def test_range_includes_empty_days_and_totals(db) -> None:
    user = await make_user(db)
    food = await make_food(db)
    async with await http_client(db, user) as client:
        for day, grams in (("2026-09-01", 150), ("2026-09-03", 100), ("2026-09-03", 50)):
            created = await client.post("/api/diary/entries", json={
                "date": day, "meal": "lunch", "food_id": food.id, "grams": grams,
            })
            assert created.status_code == 201
        response = await client.get("/api/diary/range", params={"start": "2026-09-01", "end": "2026-09-04"})
    assert response.status_code == 200
    body = response.json()
    assert body["start"] == "2026-09-01"
    assert body["end"] == "2026-09-04"
    assert [d["date"] for d in body["days"]] == ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]
    assert [d["total"]["kcal"] for d in body["days"]] == [300, 0, 300, 0]


async def test_range_is_scoped_to_the_user(db) -> None:
    alice = await make_user(db)
    bob = await make_user(db, username="bob")
    food = await make_food(db)
    async with await http_client(db, alice) as client:
        await client.post("/api/diary/entries", json={
            "date": "2026-09-01", "meal": "lunch", "food_id": food.id, "grams": 100,
        })
    async with await http_client(db, bob) as client:
        response = await client.get("/api/diary/range", params={"start": "2026-09-01", "end": "2026-09-01"})
    assert response.json()["days"][0]["total"]["kcal"] == 0


async def test_range_validation(db) -> None:
    user = await make_user(db)
    async with await http_client(db, user) as client:
        backwards = await client.get("/api/diary/range", params={"start": "2026-09-05", "end": "2026-09-01"})
        too_long = await client.get("/api/diary/range", params={"start": "2025-01-01", "end": "2026-01-02"})
        max_ok = await client.get("/api/diary/range", params={"start": "2025-01-01", "end": "2026-01-01"})
    assert backwards.status_code == 400
    assert too_long.status_code == 400
    assert max_ok.status_code == 200
    assert len(max_ok.json()["days"]) == 366
