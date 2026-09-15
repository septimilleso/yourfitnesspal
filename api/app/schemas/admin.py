"""Schemas for administrator-managed user accounts."""

import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.user import Role
from app.permissions import Permission

USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")


class _UserInput(BaseModel):
    username: str | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    role: Role | None = None
    permissions: list[Permission] | None = None

    @field_validator("username")
    @classmethod
    def username_is_normalized(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip().lower()
        if not USERNAME_RE.fullmatch(value):
            raise ValueError("username non valido")
        return value

    @field_validator("permissions")
    @classmethod
    def unique_permissions(cls, value: list[Permission] | None) -> list[Permission] | None:
        return sorted(set(value), key=lambda item: item.value) if value is not None else None


class PermissionOut(BaseModel):
    key: Permission
    label: str
    default: bool


class AdminUserOut(BaseModel):
    id: int
    username: str
    display_name: str
    role: Role
    permissions: list[Permission]
    is_active: bool
    totp_enabled: bool
    must_change_password: bool
    failed_login_count: int
    locked_until: datetime | None
    last_login_at: datetime | None
    active_sessions: int = 0


class AdminUserCreate(_UserInput):
    username: str
    display_name: str = Field(min_length=1, max_length=64)
    role: Role = Role.user
    permissions: list[Permission] | None = None


class AdminUserCreateResponse(AdminUserOut):
    temporary_password: str


class AdminUserPatch(_UserInput):
    is_active: bool | None = None


class TemporaryPasswordResponse(BaseModel):
    temporary_password: str


class AdminDeleteRequest(BaseModel):
    confirm_username: str


class AuditEventOut(BaseModel):
    id: int
    created_at: datetime
    actor_user_id: int | None
    target_user_id: int | None
    action: str
    ip: str | None
    details: dict
