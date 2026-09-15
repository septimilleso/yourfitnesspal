"""Password hashing and validation helpers.

Passwords are deliberately subject only to a length policy: Argon2id is the
password-strength mechanism, not arbitrary composition rules.
"""

import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

_HASHER = PasswordHasher()
_TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
# Constructed once so unknown users follow the same expensive Argon2 path as
# real users without retaining any meaningful credential.
_DUMMY_HASH = _HASHER.hash("dummy-password-not-a-real-credential")


def validate_password_policy(password: str) -> None:
    """Raise a user-facing error when *password* falls outside 12--128 chars."""
    if not 12 <= len(password) <= 128:
        raise ValueError("la password deve contenere da 12 a 128 caratteri")


def hash_password(password: str) -> str:
    validate_password_policy(password)
    return _HASHER.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _HASHER.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _HASHER.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def verify_dummy(password: str) -> bool:
    """Spend an Argon2 verification for a username that does not exist."""
    return verify_password(_DUMMY_HASH, password)


def generate_temp_password() -> str:
    """Return a 16-character unambiguous temporary password."""
    return "".join(secrets.choice(_TEMP_PASSWORD_ALPHABET) for _ in range(16))
