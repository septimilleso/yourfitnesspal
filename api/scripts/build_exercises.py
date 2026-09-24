"""Rebuild app/data/exercises.json from yuhonas/free-exercise-db (Unlicense).

Run from api/:  .venv\\Scripts\\python scripts/build_exercises.py
Pinned to one upstream commit so the file is reproducible; bump COMMIT and
add a new data migration to ship catalog updates.
"""

import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.exercise_catalog import CATALOG_PATH, reduce_exercise

COMMIT = "a859101d633a01c4a1a920d6a8ce41dabba0705f"
SOURCE_URL = (
    f"https://raw.githubusercontent.com/yuhonas/free-exercise-db/{COMMIT}/dist/exercises.json"
)


def main() -> None:
    with urllib.request.urlopen(SOURCE_URL, timeout=60) as response:
        raw = json.load(response)
    reduced = sorted((reduce_exercise(item) for item in raw), key=lambda row: row["id"])
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(
        json.dumps(reduced, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"wrote {len(reduced)} exercises to {CATALOG_PATH}")


if __name__ == "__main__":
    main()
