import enum
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Role(str, enum.Enum):
    """Application roles stored in the PostgreSQL ``user_role`` enum."""

    admin = "admin"
    user = "user"


class User(Base):
    """An administrator-managed account and its authentication state."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    username: Mapped[str] = mapped_column(sa.String(32), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    role: Mapped[Role] = mapped_column(
        sa.Enum(Role, name="user_role", values_callable=lambda cls: [x.value for x in cls]),
        nullable=False,
        server_default="user",
    )
    permissions: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
    )
    password_hash: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    must_change_password: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.true()
    )
    totp_secret_enc: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    totp_pending_secret_enc: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.false()
    )
    totp_last_used_step: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True)
    auth_version: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("1")
    )
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.true()
    )
    failed_login_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("0")
    )
    locked_until: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()
    )

    sessions: Mapped[list["UserSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    recovery_codes: Mapped[list["RecoveryCode"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserSession(Base):
    """Server-side session token metadata; raw tokens are never persisted."""

    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(sa.String(64), unique=True, nullable=False)
    auth_version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(sa.String(255))
    ip: Mapped[str | None] = mapped_column(sa.String(64))
    user: Mapped[User] = relationship(back_populates="sessions")


class RecoveryCode(Base):
    """One hashed, one-time recovery code for an account."""

    __tablename__ = "recovery_codes"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    user: Mapped[User] = relationship(back_populates="recovery_codes")


class AuditEvent(Base):
    """Security and administration event retained for the admin audit view."""

    __tablename__ = "audit_log"
    __table_args__ = (sa.Index("ix_audit_log_created_at", sa.text("created_at DESC")),)

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"), index=True)
    target_user_id: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    ip: Mapped[str | None] = mapped_column(sa.String(64))
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=sa.text("'{}'::jsonb"))
