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
