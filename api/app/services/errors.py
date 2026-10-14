"""Domain errors shared by the REST routers and the MCP tools.

Services raise these instead of `HTTPException` so the same code can serve
both transports: `app.main` maps them to HTTP responses (keeping the exact
status codes and `detail` strings the REST API always had), and
`app.mcp.context.tool_scope` turns them into MCP tool errors.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.schemas.workout import WorkoutOut


class ServiceError(Exception):
    """Base class; `str(exc)` is a safe, user-facing message."""


class NotFound(ServiceError):
    """The entity does not exist or belongs to another user (never distinguished)."""


class Invalid(ServiceError):
    """The request is well-formed but not acceptable."""


class PermissionMissing(ServiceError):
    """The user lacks a permission from `app.permissions.Permission`."""

    def __init__(self, permission: str) -> None:
        super().__init__(f"Permission {permission} is not enabled for this account")
        self.permission = permission


class Conflict(ServiceError):
    """The write clashes with the stored workout (409). `reason` is the code the client
    branches on; `current` is the stored copy, or None when there is none to show."""

    def __init__(self, reason: str, current: "WorkoutOut | None") -> None:
        super().__init__(reason)
        self.reason = reason
        self.current = current
