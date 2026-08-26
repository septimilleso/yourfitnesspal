from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, populated from environment variables / .env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_key: str = "dev-insecure-key-change-me"
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/yourfitnesspal"
    off_contact_email: str = "example@example.com"


settings = Settings()
