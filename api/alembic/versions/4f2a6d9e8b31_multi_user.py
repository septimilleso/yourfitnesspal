"""Add multi-user accounts and scope existing data to the bootstrap admin.

This migration is handwritten. Downgrading intentionally discards data owned
by users other than the bootstrap administrator.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "4f2a6d9e8b31"
down_revision: str | Sequence[str] | None = "162b1885de07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    # create_type=False: the type is created explicitly below, once. Without
    # this, create_table() below tries to CREATE TYPE again for the "role"
    # column and fails with DuplicateObjectError on a fresh database.
    role_enum = postgresql.ENUM("admin", "user", name="user_role", create_type=False)
    role_enum.create(bind, checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(32), nullable=False),
        sa.Column("display_name", sa.String(64), nullable=False),
        sa.Column("role", role_enum, nullable=False, server_default="user"),
        sa.Column("permissions", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("totp_secret_enc", sa.Text(), nullable=True),
        sa.Column("totp_pending_secret_enc", sa.Text(), nullable=True),
        sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("totp_last_used_step", sa.BigInteger(), nullable=True),
        sa.Column("auth_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("failed_login_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "user_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("auth_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_agent", sa.String(255), nullable=True),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token_hash", name="uq_user_sessions_token_hash"),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])

    op.create_table(
        "recovery_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_recovery_codes_user_id", "recovery_codes", ["user_id"])

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("target_user_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("details", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_audit_log_created_at", "audit_log", [sa.text("created_at DESC")])

    admin_id = bind.execute(
        sa.text(
            "INSERT INTO users (username, display_name, role, permissions, password_hash, must_change_password) "
            "VALUES ('admin', 'Admin', 'admin', '[]'::jsonb, NULL, true) RETURNING id"
        )
    ).scalar_one()

    for table in ("diary_entries", "goals", "meal_templates"):
        op.add_column(table, sa.Column("user_id", sa.Integer(), nullable=True))
        bind.execute(sa.text(f"UPDATE {table} SET user_id = :admin_id"), {"admin_id": admin_id})
        op.alter_column(table, "user_id", nullable=False)
        op.create_foreign_key(f"fk_{table}_user_id", table, "users", ["user_id"], ["id"], ondelete="CASCADE")
        op.create_index(f"ix_{table}_user_id", table, ["user_id"])

    op.add_column("foods", sa.Column("owner_user_id", sa.Integer(), nullable=True))
    bind.execute(sa.text("UPDATE foods SET owner_user_id = :admin_id WHERE source = 'custom'"), {"admin_id": admin_id})
    op.create_foreign_key("fk_foods_owner_user_id", "foods", "users", ["owner_user_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_foods_owner_user_id", "foods", ["owner_user_id"])
    op.create_check_constraint("ck_foods_owner_only_custom", "foods", "source = 'custom' OR owner_user_id IS NULL")
    op.drop_index("ix_diary_entries_date", table_name="diary_entries")
    op.create_index("ix_diary_entries_user_date", "diary_entries", ["user_id", "date"])


def downgrade() -> None:
    bind = op.get_bind()
    admin_id = bind.execute(sa.text("SELECT min(id) FROM users WHERE role = 'admin'")).scalar()
    if admin_id is not None:
        for table in ("diary_entries", "goals", "meal_templates"):
            bind.execute(sa.text(f"DELETE FROM {table} WHERE user_id <> :admin_id"), {"admin_id": admin_id})
        bind.execute(
            sa.text("DELETE FROM foods f WHERE f.source = 'custom' AND f.owner_user_id <> :admin_id "
                    "AND NOT EXISTS (SELECT 1 FROM diary_entries d WHERE d.food_id = f.id)"),
            {"admin_id": admin_id},
        )

    op.drop_index("ix_diary_entries_user_date", table_name="diary_entries")
    op.create_index("ix_diary_entries_date", "diary_entries", ["date"])
    for table in ("diary_entries", "goals", "meal_templates"):
        op.drop_index(f"ix_{table}_user_id", table_name=table)
        op.drop_constraint(f"fk_{table}_user_id", table_name=table, type_="foreignkey")
        op.drop_column(table, "user_id")
    op.drop_constraint("ck_foods_owner_only_custom", table_name="foods", type_="check")
    op.drop_index("ix_foods_owner_user_id", table_name="foods")
    op.drop_constraint("fk_foods_owner_user_id", table_name="foods", type_="foreignkey")
    op.drop_column("foods", "owner_user_id")
    op.drop_index("ix_audit_log_created_at", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_index("ix_recovery_codes_user_id", table_name="recovery_codes")
    op.drop_table("recovery_codes")
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
    postgresql.ENUM(name="user_role").drop(bind, checkfirst=True)
