from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, populated from environment variables / .env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Server secret for login challenges and TOTP encryption, not a password.
    # Changing it invalidates challenges, sessions and all encrypted TOTP secrets.
    app_key: str = "dev-insecure-key-change-me"
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/yourfitnesspal"
    off_contact_email: str = "example@example.com"
    # Session cookie's `Secure` flag. Keep True (default) whenever the app is
    # reachable over HTTPS (e.g. behind the Cloudflare Tunnel this project is
    # designed for) -- browsers silently drop `Secure` cookies received over
    # plain HTTP, which otherwise looks like login "not working" (200 on
    # POST /api/auth/login, but every subsequent request 401s). Only set this
    # to false for temporary plain-HTTP testing before a tunnel/TLS is set up.
    cookie_secure: bool = True
    session_max_age_days: int = 30
    login_challenge_max_age_seconds: int = 300
    totp_issuer: str = "YourFitnessPal"
    user_lockout_threshold: int = 10
    user_lockout_minutes: int = 15


settings = Settings()
