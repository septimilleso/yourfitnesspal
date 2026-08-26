from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""


# Model modules are imported here (in later tasks) so that Alembic's
# autogenerate can discover them via Base.metadata.
