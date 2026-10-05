"""REST API tests for saved weeks (require the remote Postgres test database)."""

from datetime import date

import sqlalchemy as sa

from app.models.diary import DiaryEntry, Meal
from app.models.saved_week import SavedWeek, SavedWeekItem
from app.models.user import User
from tests.factories import http_client, make_food, make_user

COPY = ["diary.copy"]


async def _add_entry(
    db,
    user: User,
    food_id: int,
    *,
    for_date: date,
    meal: Meal,
    grams: float = 100,
    portion_label: str | None = None,
    position: int = 0,
) -> DiaryEntry:
    entry = DiaryEntry(
        user_id=user.id,
        food_id=food_id,
        date=for_date,
        meal=meal,
        grams=grams,
        portion_label=portion_label,
        position=position,
        nutriments_snapshot={},
    )
    db.add(entry)
    await db.flush()
    return entry


async def test_create_saved_week_copies_entries_and_trims_name(db) -> None:
    user = await make_user(db, permissions=COPY)
    lunch_food = await make_food(db, name="Monday lunch")
    dinner_food = await make_food(db, name="Thursday dinner")
    start = date(2026, 7, 6)
    await _add_entry(
        db,
        user,
        lunch_food.id,
        for_date=start,
        meal=Meal.lunch,
        grams=150,
        portion_label="large plate",
        position=2,
    )
    await _add_entry(
        db,
        user,
        dinner_food.id,
        for_date=date(2026, 7, 9),
        meal=Meal.dinner,
        grams=75,
        portion_label="small bowl",
        position=1,
    )

    async with await http_client(db, user) as client:
        response = await client.post(
            "/api/saved-weeks", json={"name": "  Dieta A  ", "start": start.isoformat()}
        )
        duplicate = await client.post(
            "/api/saved-weeks", json={"name": "Dieta A", "start": start.isoformat()}
        )

    assert response.status_code == 201
    assert response.json()["name"] == "Dieta A"
    assert response.json()["entries_count"] == 2
    assert duplicate.status_code == 201
    assert duplicate.json()["name"] == "Dieta A"

    saved = (
        await db.scalars(
            sa.select(SavedWeekItem)
            .where(SavedWeekItem.saved_week_id == response.json()["id"])
            .order_by(SavedWeekItem.day_index)
        )
    ).all()
    assert [
        (
            item.day_index,
            item.meal,
            item.food_id,
            float(item.grams),
            item.portion_label,
            item.position,
        )
        for item in saved
    ] == [
        (0, Meal.lunch, lunch_food.id, 150.0, "large plate", 2),
        (3, Meal.dinner, dinner_food.id, 75.0, "small bowl", 1),
    ]


async def test_create_saved_week_rejects_empty_week_non_monday_and_bad_name(db) -> None:
    user = await make_user(db, permissions=COPY)
    async with await http_client(db, user) as client:
        empty = await client.post("/api/saved-weeks", json={"name": "Empty", "start": "2026-07-06"})
        not_monday = await client.post(
            "/api/saved-weeks", json={"name": "Wrong day", "start": "2026-07-07"}
        )
        blank = await client.post("/api/saved-weeks", json={"name": "   ", "start": "2026-07-06"})

    assert empty.status_code == 400
    assert empty.json()["detail"] == "la settimana non ha nessun pasto"
    assert not_monday.status_code == 400
    assert blank.status_code == 400
    assert await db.scalar(sa.select(sa.func.count()).select_from(SavedWeek)) == 0


async def test_list_saved_weeks_is_user_scoped_newest_first_with_counts(db) -> None:
    user = await make_user(db, permissions=COPY)
    food = await make_food(db)
    await _add_entry(db, user, food.id, for_date=date(2026, 7, 6), meal=Meal.lunch)
    await _add_entry(db, user, food.id, for_date=date(2026, 7, 7), meal=Meal.dinner)
    async with await http_client(db, user) as client:
        first = await client.post("/api/saved-weeks", json={"name": "First", "start": "2026-07-06"})
        second = await client.post(
            "/api/saved-weeks", json={"name": "Second", "start": "2026-07-06"}
        )
        response = await client.get("/api/saved-weeks")

    assert response.status_code == 200
    body = response.json()
    assert [week["name"] for week in body] == ["Second", "First"]
    assert [week["entries_count"] for week in body] == [2, 2]
    assert [week["avg_kcal"] for week in body] == [200.0, 200.0]
    assert [week["id"] for week in body] == [second.json()["id"], first.json()["id"]]


async def test_get_saved_week_returns_seven_days_items_and_totals(db) -> None:
    user = await make_user(db, permissions=COPY)
    lunch = await make_food(db, name="Lunch food", brand="Brand")
    dinner = await make_food(db, name="Dinner food")
    start = date(2026, 7, 6)
    await _add_entry(
        db,
        user,
        lunch.id,
        for_date=start,
        meal=Meal.lunch,
        grams=150,
        portion_label="plate",
        position=1,
    )
    await _add_entry(db, user, dinner.id, for_date=date(2026, 7, 9), meal=Meal.dinner, grams=50)

    async with await http_client(db, user) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "Totals", "start": start.isoformat()}
        )
        response = await client.get(f"/api/saved-weeks/{created.json()['id']}")

    assert response.status_code == 200
    body = response.json()
    assert len(body["days"]) == 7
    monday = body["days"][0]
    assert monday["meals"]["lunch"] == [
        {
            "id": monday["meals"]["lunch"][0]["id"],
            "food_id": lunch.id,
            "food_name": "Lunch food",
            "food_brand": "Brand",
            "grams": 150.0,
            "portion_label": "plate",
            "position": 1,
        }
    ]
    assert monday["total"]["kcal"] == 300.0
    assert monday["total"]["protein_g"] == 30.0
    assert body["days"][3]["meals"]["dinner"][0]["food_name"] == "Dinner food"
    assert body["days"][3]["total"]["kcal"] == 100.0
    for day_index in (1, 2, 4, 5, 6):
        assert body["days"][day_index]["total"]["kcal"] == 0
        assert all(not items for items in body["days"][day_index]["meals"].values())


async def test_get_saved_week_hides_another_users_week(db) -> None:
    owner = await make_user(db, username="owner", permissions=COPY)
    other = await make_user(db, username="other", permissions=COPY)
    food = await make_food(db)
    await _add_entry(db, owner, food.id, for_date=date(2026, 7, 6), meal=Meal.lunch)
    async with await http_client(db, owner) as owner_client:
        created = await owner_client.post(
            "/api/saved-weeks", json={"name": "Private", "start": "2026-07-06"}
        )
    async with await http_client(db, other) as client:
        response = await client.get(f"/api/saved-weeks/{created.json()['id']}")

    assert response.status_code == 404


async def test_saved_week_endpoints_require_diary_copy_permission(db) -> None:
    user = await make_user(db, permissions=[])
    async with await http_client(db, user) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "No permission", "start": "2026-07-06"}
        )
        listing = await client.get("/api/saved-weeks")
        detail = await client.get("/api/saved-weeks/1")

    assert created.status_code == 403
    assert listing.status_code == 403
    assert detail.status_code == 403
    assert created.json() == listing.json() == detail.json() == {"detail": "forbidden"}
