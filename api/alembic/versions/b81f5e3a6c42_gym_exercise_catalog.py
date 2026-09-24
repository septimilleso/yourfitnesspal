"""Load the bundled exercise catalog (app/data/exercises.json).

Revision ID: b81f5e3a6c42
Revises: 9a4d2c7e1f03
"""

from collections.abc import Sequence

from alembic import op
from app.services.exercise_catalog import upsert_catalog

revision: str = "b81f5e3a6c42"
down_revision: str | Sequence[str] | None = "9a4d2c7e1f03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    upsert_catalog(op.get_bind())


def downgrade() -> None:
    # Catalog rows referenced by templates/history cannot be removed; only
    # drop the ones nothing uses.
    op.execute(
        "DELETE FROM exercises e WHERE e.source = 'catalog' "
        "AND NOT EXISTS (SELECT 1 FROM template_exercises t WHERE t.exercise_id = e.id) "
        "AND NOT EXISTS (SELECT 1 FROM workout_exercises w WHERE w.exercise_id = e.id)"
    )
