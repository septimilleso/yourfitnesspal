"""Request and response shapes for account authentication."""

from datetime import datetime

from pydantic import BaseModel, model_validator


class LoginRequest(BaseModel):
    username: str
    password: str


class TotpRequest(BaseModel):
    code: str | None = None
    recovery_code: str | None = None

    @model_validator(mode="after")
    def exactly_one_code(self) -> "TotpRequest":
        if bool(self.code) == bool(self.recovery_code):
            raise ValueError("fornisci esattamente un codice")
        return self


class SetupCompleteRequest(BaseModel):
    code: str
    new_password: str | None = None


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class RecoveryCodeRequest(BaseModel):
    code: str


class SessionOut(BaseModel):
    id: int
    created_at: datetime
    last_seen_at: datetime
    user_agent: str | None
    ip: str | None
    current: bool
