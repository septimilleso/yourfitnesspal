import re
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator
from urllib3.util import parse_url


class PushKeys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(max_length=2048)
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def _known_push_service(cls, endpoint: str) -> str:
        if re.search(r"[\\\s\x00-\x1f\x7f]", endpoint):
            raise ValueError("endpoint must not contain whitespace or control characters")

        try:
            parsed = urlsplit(endpoint)
            hostname = parsed.hostname
            port = parsed.port
            urllib3_hostname = parse_url(endpoint).host
        except ValueError as exc:
            raise ValueError("endpoint must be a valid HTTPS push service URL") from exc

        allowed = {
            "web.push.apple.com",
            "fcm.googleapis.com",
            "updates.push.services.mozilla.com",
        }
        if (
            parsed.scheme != "https"
            or hostname is None
            or urllib3_hostname is None
            or urllib3_hostname.lower() != hostname.lower()
            or re.fullmatch(r"[a-z0-9]([a-z0-9.-]*[a-z0-9])?", hostname.lower()) is None
            or (parsed.username is not None or parsed.password is not None)
            or port not in {None, 443}
            or not (
                hostname.lower() in allowed
                or hostname.lower().endswith(".notify.windows.com")
            )
        ):
            raise ValueError("endpoint host is not an allowed HTTPS push service")
        return endpoint


class PushUnsubscribeIn(BaseModel):
    endpoint: str = Field(max_length=2048)


class PushConfigOut(BaseModel):
    public_key: str | None
