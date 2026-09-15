"""The single registry for user-level permissions."""

import enum

from app.models.user import Role, User


class Permission(str, enum.Enum):
    foods_off_lookup = "foods.off_lookup"
    foods_custom_create = "foods.custom_create"
    diary_copy = "diary.copy"
    goals_edit = "goals.edit"


PERMISSION_LABELS: dict[Permission, str] = {
    Permission.foods_off_lookup: "Ricerca su OpenFoodFacts",
    Permission.foods_custom_create: "Crea alimenti personalizzati",
    Permission.diary_copy: "Copia giorni del diario",
    Permission.goals_edit: "Modifica gli obiettivi",
}
DEFAULT_PERMISSIONS = frozenset(Permission)


def effective_permissions(user: User) -> set[Permission]:
    """Return all permissions for an admin, validated stored values otherwise."""
    if user.role is Role.admin:
        return set(Permission)
    return {permission for permission in Permission if permission.value in user.permissions}
