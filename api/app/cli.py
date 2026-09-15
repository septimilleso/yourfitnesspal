"""Emergency administration commands for first bootstrap and account recovery."""

import argparse
import asyncio
import getpass

import sqlalchemy as sa

from app.auth.passwords import generate_temp_password, hash_password, validate_password_policy
from app.auth.sessions import revoke_all
from app.db import AsyncSessionLocal
from app.models.user import RecoveryCode, Role, User
from app.services.audit import record


async def _user(session, username: str) -> User:
    user = await session.scalar(sa.select(User).where(User.username == username.strip().lower()))
    if not user:
        raise ValueError("utente non trovato")
    return user


async def set_password(username: str, password: str | None = None, temporary: bool = False) -> str | None:
    async with AsyncSessionLocal() as session:
        user = await _user(session, username)
        password = generate_temp_password() if temporary else password
        if password is None:
            raise ValueError("password obbligatoria")
        validate_password_policy(password)
        user.password_hash, user.must_change_password = hash_password(password), temporary
        user.auth_version += 1
        await revoke_all(session, user.id)
        await record(session, None, "password.change", user.id, {"source": "cli"})
        await session.commit()
        return password if temporary else None


async def reset_totp(username: str) -> None:
    async with AsyncSessionLocal() as session:
        user = await _user(session, username)
        user.totp_secret_enc = user.totp_pending_secret_enc = None
        user.totp_enabled, user.totp_last_used_step = False, None
        user.auth_version += 1
        user.locked_until, user.failed_login_count = None, 0
        await session.execute(sa.delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
        await revoke_all(session, user.id)
        await record(session, None, "admin.totp_reset", user.id, {"source": "cli"})
        await session.commit()


async def create_admin(username: str, display_name: str | None = None) -> str:
    async with AsyncSessionLocal() as session:
        username = username.strip().lower()
        if await session.scalar(sa.select(User.id).where(User.username == username)):
            raise ValueError("username già in uso")
        password = generate_temp_password()
        user = User(username=username, display_name=display_name or username, role=Role.admin,
                    permissions=[], password_hash=hash_password(password), must_change_password=True)
        session.add(user)
        await session.flush()
        await record(session, None, "admin.user_create", user.id, {"source": "cli"})
        await session.commit()
        return password


async def list_users() -> list[User]:
    async with AsyncSessionLocal() as session:
        return list((await session.scalars(sa.select(User).order_by(User.id))).all())


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    set_cmd = sub.add_parser("set-password")
    set_cmd.add_argument("username")
    set_cmd.add_argument("--temporary", action="store_true")
    reset_cmd = sub.add_parser("reset-totp")
    reset_cmd.add_argument("username")
    create_cmd = sub.add_parser("create-admin")
    create_cmd.add_argument("username")
    create_cmd.add_argument("--display-name")
    sub.add_parser("list-users")
    args = parser.parse_args()
    if args.command == "set-password":
        password = None if args.temporary else getpass.getpass("Password: ")
        if password is not None and password != getpass.getpass("Conferma password: "):
            raise SystemExit("le password non coincidono")
        generated = asyncio.run(set_password(args.username, password, args.temporary))
        if generated:
            print(f"Password temporanea: {generated}")
    elif args.command == "reset-totp":
        asyncio.run(reset_totp(args.username))
    elif args.command == "create-admin":
        print(f"Password temporanea: {asyncio.run(create_admin(args.username, args.display_name))}")
    else:
        for user in asyncio.run(list_users()):
            print(f"{user.id}\t{user.username}\t{user.role.value}\t{user.is_active}\t{user.totp_enabled}")


if __name__ == "__main__":
    main()
