"""The gym permission exists and is on by default (DB-free)."""

from app.permissions import DEFAULT_PERMISSIONS, PERMISSION_LABELS, Permission


def test_workouts_permission_is_default() -> None:
    assert Permission.workouts.value == "workouts.use"
    assert Permission.workouts in DEFAULT_PERMISSIONS
    assert PERMISSION_LABELS[Permission.workouts] == "Allenamenti"
