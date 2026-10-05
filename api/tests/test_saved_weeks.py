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


async def test_rename_saved_week_updates_name_and_rejects_blank_name(db) -> None:
    user = await make_user(db, permissions=COPY)
    food = await make_food(db)
    await _add_entry(db, user, food.id, for_date=date(2026, 7, 6), meal=Meal.lunch)

    async with await http_client(db, user) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "Dieta A", "start": "2026-07-06"}
        )
        week_id = created.json()["id"]
        renamed = await client.patch(f"/api/saved-weeks/{week_id}", json={"name": "Dieta B"})
        listing = await client.get("/api/saved-weeks")
        blank = await client.patch(f"/api/saved-weeks/{week_id}", json={"name": "   "})

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Dieta B"
    assert [week["name"] for week in listing.json()] == ["Dieta B"]
    assert blank.status_code == 400
    assert blank.json()["detail"] == "name must be between 1 and 100 characters"


async def test_rename_and_delete_saved_week_hide_another_users_week(db) -> None:
    owner = await make_user(db, username="owner", permissions=COPY)
    other = await make_user(db, username="other", permissions=COPY)
    food = await make_food(db)
    await _add_entry(db, owner, food.id, for_date=date(2026, 7, 6), meal=Meal.lunch)
    async with await http_client(db, owner) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "Private", "start": "2026-07-06"}
        )
    week_id = created.json()["id"]

    async with await http_client(db, other) as client:
        renamed = await client.patch(f"/api/saved-weeks/{week_id}", json={"name": "Stolen"})
        deleted = await client.delete(f"/api/saved-weeks/{week_id}")

    assert renamed.status_code == 404
    assert deleted.status_code == 404


async def test_delete_saved_week_removes_items_but_preserves_diary_entries(db) -> None:
    user = await make_user(db, permissions=COPY)
    food = await make_food(db)
    async with await http_client(db, user) as client:
        entry = await client.post(
            "/api/diary/entries",
            json={"date": "2026-07-06", "meal": "lunch", "food_id": food.id, "grams": 100},
        )
        assert entry.status_code == 201
        created = await client.post(
            "/api/saved-weeks", json={"name": "To delete", "start": "2026-07-06"}
        )
        week_id = created.json()["id"]
        deleted = await client.delete(f"/api/saved-weeks/{week_id}")
        listing = await client.get("/api/saved-weeks")
        diary = await client.get("/api/diary/day/2026-07-06")

    assert deleted.status_code == 204
    assert await db.scalar(sa.select(sa.func.count()).select_from(SavedWeek)) == 0
    assert await db.scalar(sa.select(sa.func.count()).select_from(SavedWeekItem)) == 0
    assert await db.scalar(sa.select(sa.func.count()).select_from(DiaryEntry)) == 1
    assert listing.json() == []
    assert diary.status_code == 200
    assert diary.json()["entries"]["lunch"][0]["id"] == entry.json()["id"]


async def test_saved_week_endpoints_require_diary_copy_permission(db) -> None:
    user = await make_user(db, permissions=[])
    async with await http_client(db, user) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "No permission", "start": "2026-07-06"}
        )
        listing = await client.get("/api/saved-weeks")
        detail = await client.get("/api/saved-weeks/1")
        renamed = await client.patch("/api/saved-weeks/1", json={"name": "Denied"})
        deleted = await client.delete("/api/saved-weeks/1")
        applied = await client.post(
            "/api/saved-weeks/1/apply", json={"days": None, "target_start": "2026-07-13"}
        )

    assert created.status_code == 403
    assert listing.status_code == 403
    assert detail.status_code == 403
    assert renamed.status_code == 403
    assert deleted.status_code == 403
    assert applied.status_code == 403
    assert (
        created.json()
        == listing.json()
        == detail.json()
        == renamed.json()
        == deleted.json()
        == applied.json()
        == {"detail": "forbidden"}
    )


async def test_apply_saved_week_copies_all_seven_days(db) -> None:
    user = await make_user(db, permissions=COPY)
    lunch = await make_food(db, name="Monday lunch")
    dinner = await make_food(db, name="Thursday dinner")
    await _add_entry(db, user, lunch.id, for_date=date(2026, 7, 6), meal=Meal.lunch, grams=150)
    await _add_entry(db, user, dinner.id, for_date=date(2026, 7, 9), meal=Meal.dinner, grams=75)

    async with await http_client(db, user) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "Apply all", "start": "2026-07-06"}
        )
        response = await client.post(
            f"/api/saved-weeks/{created.json()['id']}/apply",
            json={"days": None, "target_start": "2026-07-13"},
        )
        target_days = [
            await client.get(f"/api/diary/day/2026-07-{day:02d}") for day in range(13, 20)
        ]

    assert response.status_code == 200
    body = response.json()
    assert body["entries_created"] == 2
    assert body["days"] == [
        {"date": f"2026-07-{day:02d}", "entries_created": count}
        for day, count in zip(range(13, 20), [1, 0, 0, 1, 0, 0, 0], strict=True)
    ]
    assert [day.status_code for day in target_days] == [200] * 7
    assert target_days[0].json()["entries"]["lunch"][0]["food_id"] == lunch.id
    assert target_days[0].json()["entries"]["lunch"][0]["grams"] == 150.0
    assert target_days[3].json()["entries"]["dinner"][0]["food_id"] == dinner.id
    assert target_days[3].json()["entries"]["dinner"][0]["grams"] == 75.0
    assert all(
        not any(day.json()["entries"].values())
        for index, day in enumerate(target_days)
        if index not in (0, 3)
    )


async def test_apply_saved_week_selected_days_map_positionally(db) -> None:
    user = await make_user(db, permissions=COPY)
    tuesday_food = await make_food(db, name="Tuesday food")
    thursday_food = await make_food(db, name="Thursday food")
    await _add_entry(db, user, tuesday_food.id, for_date=date(2026, 7, 7), meal=Meal.breakfast)
    await _add_entry(db, user, thursday_food.id, for_date=date(2026, 7, 9), meal=Meal.dinner)

    async with await http_client(db, user) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "Selected", "start": "2026-07-06"}
        )
        response = await client.post(
            f"/api/saved-weeks/{created.json()['id']}/apply",
            json={"days": [1, 3], "target_start": "2026-10-12"},
        )
        first_target = await client.get("/api/diary/day/2026-10-12")
        second_target = await client.get("/api/diary/day/2026-10-13")
        untouched_target = await client.get("/api/diary/day/2026-10-14")

    assert response.status_code == 200
    body = response.json()
    assert body["entries_created"] == 2
    assert body["days"] == [
        {"date": "2026-10-12", "entries_created": 1},
        {"date": "2026-10-13", "entries_created": 1},
    ]
    assert first_target.json()["entries"]["breakfast"][0]["food_id"] == tuesday_food.id
    assert second_target.json()["entries"]["dinner"][0]["food_id"] == thursday_food.id
    assert all(not items for items in untouched_target.json()["entries"].values())


async def test_apply_saved_week_append_preserves_existing_positions(db) -> None:
    user = await make_user(db, permissions=COPY)
    source_food = await make_food(db, name="Saved breakfast")
    existing_food = await make_food(db, name="Existing breakfast")
    await _add_entry(db, user, source_food.id, for_date=date(2026, 7, 6), meal=Meal.breakfast)
    await _add_entry(db, user, existing_food.id, for_date=date(2026, 7, 13), meal=Meal.breakfast)

    async with await http_client(db, user) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "Append", "start": "2026-07-06"}
        )
        response = await client.post(
            f"/api/saved-weeks/{created.json()['id']}/apply",
            json={"days": [0], "target_start": "2026-07-13", "mode": "append"},
        )
        day = await client.get("/api/diary/day/2026-07-13")

    assert response.status_code == 200
    assert response.json()["entries_created"] == 1
    assert [
        (entry["food_id"], entry["position"]) for entry in day.json()["entries"]["breakfast"]
    ] == [(existing_food.id, 0), (source_food.id, 1)]


async def test_apply_saved_week_replace_filters_meals_and_clears_empty_source_day(db) -> None:
    user = await make_user(db, permissions=COPY)
    saved_lunch = await make_food(db, name="Saved lunch")
    old_lunch = await make_food(db, name="Old lunch")
    breakfast = await make_food(db, name="Breakfast")
    dinner = await make_food(db, name="Dinner")
    snack = await make_food(db, name="Snack")
    await _add_entry(db, user, saved_lunch.id, for_date=date(2026, 7, 7), meal=Meal.lunch)
    await _add_entry(db, user, old_lunch.id, for_date=date(2026, 7, 13), meal=Meal.lunch)
    await _add_entry(db, user, breakfast.id, for_date=date(2026, 7, 13), meal=Meal.breakfast)
    await _add_entry(db, user, dinner.id, for_date=date(2026, 7, 13), meal=Meal.dinner)
    await _add_entry(db, user, snack.id, for_date=date(2026, 7, 13), meal=Meal.snack)
    await _add_entry(db, user, old_lunch.id, for_date=date(2026, 7, 14), meal=Meal.lunch)

    async with await http_client(db, user) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "Replace", "start": "2026-07-06"}
        )
        replaced = await client.post(
            f"/api/saved-weeks/{created.json()['id']}/apply",
            json={
                "days": [1],
                "target_start": "2026-07-13",
                "meals": ["lunch"],
                "mode": "replace",
            },
        )
        replaced_day = await client.get("/api/diary/day/2026-07-13")
        cleared = await client.post(
            f"/api/saved-weeks/{created.json()['id']}/apply",
            json={
                "days": [0],
                "target_start": "2026-07-14",
                "meals": ["lunch"],
                "mode": "replace",
            },
        )
        cleared_day = await client.get("/api/diary/day/2026-07-14")

    assert replaced.status_code == 200
    assert replaced.json()["entries_created"] == 1
    assert replaced_day.json()["entries"]["lunch"][0]["food_id"] == saved_lunch.id
    assert replaced_day.json()["entries"]["breakfast"][0]["food_id"] == breakfast.id
    assert replaced_day.json()["entries"]["dinner"][0]["food_id"] == dinner.id
    assert replaced_day.json()["entries"]["snack"][0]["food_id"] == snack.id
    assert cleared.status_code == 200
    assert cleared.json()["entries_created"] == 0
    assert cleared.json()["days"] == [{"date": "2026-07-14", "entries_created": 0}]
    assert not cleared_day.json()["entries"]["lunch"]


async def test_apply_saved_week_uses_current_food_nutrients(db) -> None:
    user = await make_user(db, permissions=COPY)
    food = await make_food(db)
    await _add_entry(db, user, food.id, for_date=date(2026, 7, 6), meal=Meal.lunch)

    async with await http_client(db, user) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "Current food", "start": "2026-07-06"}
        )
        food.nutriments = {**food.nutriments, "kcal": 350.0}
        await db.commit()
        applied = await client.post(
            f"/api/saved-weeks/{created.json()['id']}/apply",
            json={"days": [0], "target_start": "2026-07-13"},
        )
        day = await client.get("/api/diary/day/2026-07-13")

    assert applied.status_code == 200
    entry = day.json()["entries"]["lunch"][0]
    assert entry["nutriments_snapshot"]["kcal"] == 350.0
    assert day.json()["totals"]["total"]["kcal"] == 350.0


async def test_apply_saved_week_validates_days_and_hides_other_users_week(db) -> None:
    owner = await make_user(db, username="owner", permissions=COPY)
    other = await make_user(db, username="other", permissions=COPY)
    food = await make_food(db)
    await _add_entry(db, owner, food.id, for_date=date(2026, 7, 6), meal=Meal.lunch)
    async with await http_client(db, owner) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "Private", "start": "2026-07-06"}
        )
    week_id = created.json()["id"]

    async with await http_client(db, owner) as client:
        empty_days = await client.post(
            f"/api/saved-weeks/{week_id}/apply",
            json={"days": [], "target_start": "2026-07-13"},
        )
        invalid_day = await client.post(
            f"/api/saved-weeks/{week_id}/apply",
            json={"days": [7], "target_start": "2026-07-13"},
        )
    async with await http_client(db, other) as client:
        hidden = await client.post(
            f"/api/saved-weeks/{week_id}/apply",
            json={"days": None, "target_start": "2026-07-13"},
        )
        untouched = await client.get("/api/diary/day/2026-07-13")

    assert empty_days.status_code == 400
    assert invalid_day.status_code == 400
    assert hidden.status_code == 404
    assert all(not items for items in untouched.json()["entries"].values())


async def test_apply_saved_week_matches_diary_copy_plan_counts(db) -> None:
    user = await make_user(db, permissions=COPY)
    monday_food = await make_food(db, name="Monday food")
    thursday_food = await make_food(db, name="Thursday food")
    await _add_entry(db, user, monday_food.id, for_date=date(2026, 7, 6), meal=Meal.lunch)
    await _add_entry(db, user, thursday_food.id, for_date=date(2026, 7, 9), meal=Meal.dinner)

    async with await http_client(db, user) as client:
        created = await client.post(
            "/api/saved-weeks", json={"name": "Equivalent", "start": "2026-07-06"}
        )
        applied = await client.post(
            f"/api/saved-weeks/{created.json()['id']}/apply",
            json={"days": [0, 3], "target_start": "2026-07-13"},
        )
        copied = await client.post(
            "/api/diary/copy",
            json={
                "source_dates": ["2026-07-06", "2026-07-09"],
                "target_start": "2026-07-20",
            },
        )

    assert applied.status_code == copied.status_code == 200
    assert applied.json()["entries_created"] == copied.json()["entries_created"] == 2
    assert (
        [day["entries_created"] for day in applied.json()["days"]]
        == [day["entries_created"] for day in copied.json()["days"]]
        == [1, 1]
    )
