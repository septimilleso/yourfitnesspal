"""Client for the OpenFoodFacts (OFF) API: rate-limited HTTP access plus
normalization of OFF product payloads into this app's internal nutriment
shape.

Two independent token-bucket rate limiters are used because OFF's product
lookup and search endpoints have different published rate limits (product
lookups: 15/min, search: 10/min). Calls beyond the bucket's capacity await
until a slot frees rather than raising -- callers of this client are
background cache-fill operations where added latency is acceptable, but a
hard failure is not desirable.
"""

import asyncio
import time
from collections import deque

import httpx
from fastapi import Request

from app.config import settings

PRODUCT_RATE_LIMIT_PER_MINUTE = 15
SEARCH_RATE_LIMIT_PER_MINUTE = 10

# OFF's per-100g nutriment keys we care about, mapped to our internal keys.
_NUTRIMENT_KEY_MAP = {
    "protein_g": "proteins_100g",
    "carbs_g": "carbohydrates_100g",
    "sugars_g": "sugars_100g",
    "fat_g": "fat_100g",
    "sat_fat_g": "saturated-fat_100g",
    "fiber_g": "fiber_100g",
    "salt_g": "salt_100g",
}

KJ_PER_KCAL = 4.184


class TokenBucketRateLimiter:
    """An async token-bucket rate limiter: at most `capacity` acquisitions
    are allowed within any rolling `window_seconds` window. Callers beyond
    capacity await (never raise) until a slot frees.

    `window_seconds` is injectable so tests can exercise the waiting
    behavior without a real 60-second sleep.
    """

    def __init__(self, capacity: int, window_seconds: float = 60.0) -> None:
        self.capacity = capacity
        self.window_seconds = window_seconds
        self._timestamps: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                while self._timestamps and now - self._timestamps[0] >= self.window_seconds:
                    self._timestamps.popleft()

                if len(self._timestamps) < self.capacity:
                    self._timestamps.append(now)
                    return

                wait_seconds = self.window_seconds - (now - self._timestamps[0])
                if wait_seconds > 0:
                    await asyncio.sleep(wait_seconds)


class OffClient:
    """Thin async wrapper around OFF's HTTP API."""

    def __init__(
        self,
        contact_email: str | None = None,
        base_url: str = "https://world.openfoodfacts.org",
        product_rate_limiter: TokenBucketRateLimiter | None = None,
        search_rate_limiter: TokenBucketRateLimiter | None = None,
        http_client: httpx.AsyncClient | None = None,
        max_retries: int = 3,
        retry_backoff_seconds: float = 0.5,
    ) -> None:
        email = contact_email or settings.off_contact_email
        self._owns_http_client = http_client is None
        self._client = http_client or httpx.AsyncClient(
            base_url=base_url,
            headers={"User-Agent": f"YourFitnessPal/1.0 ({email})"},
        )
        self._product_limiter = product_rate_limiter or TokenBucketRateLimiter(
            PRODUCT_RATE_LIMIT_PER_MINUTE
        )
        self._search_limiter = search_rate_limiter or TokenBucketRateLimiter(
            SEARCH_RATE_LIMIT_PER_MINUTE
        )
        self._max_retries = max_retries
        self._retry_backoff_seconds = retry_backoff_seconds

    async def aclose(self) -> None:
        if self._owns_http_client:
            await self._client.aclose()

    async def get_product(self, barcode: str) -> dict | None:
        """Fetch a single product by barcode. Returns None on a 404, on an
        OFF `status != 1` response, or if all retries are exhausted."""
        await self._product_limiter.acquire()
        response = await self._request_with_retry("GET", f"/api/v2/product/{barcode}.json")
        if response is None or response.status_code == 404:
            return None

        data = response.json()
        if data.get("status") != 1:
            return None
        return data.get("product")

    async def search(self, query: str, limit: int) -> list[dict] | None:
        """Full-text search OFF products by name/brand/keywords.

        Uses the legacy `/cgi/search.pl` endpoint rather than `/api/v2/search`:
        the v2 endpoint is a *structured* (filter-by-category/brand/nutrient)
        search and silently ignores `search_terms`, returning an arbitrary
        page of unrelated products instead of an error -- `/cgi/search.pl`
        with `action=process` is OFF's actual free-text search and returns
        the same `{"products": [...]}` shape `normalize()` already expects.

        Returns `None` (not `[]`) if OFF is unreachable/failing after
        retries are exhausted -- OFF's legacy search endpoint is known to
        return intermittent 503s independent of query volume, and the
        caller needs to distinguish "OFF is down" from "OFF genuinely has
        no matches" to give the user an accurate message instead of a
        silent, indistinguishable empty result. Returns `[]` only when OFF
        actually responded and found nothing.
        """
        await self._search_limiter.acquire()
        response = await self._request_with_retry(
            "GET",
            "/cgi/search.pl",
            params={
                "search_terms": query,
                "json": 1,
                "action": "process",
                "page_size": limit,
            },
        )
        if response is None:
            return None

        data = response.json()
        return data.get("products", [])

    async def _request_with_retry(self, method: str, url: str, **kwargs) -> httpx.Response | None:
        """Issue a request, retrying with exponential backoff on 429/503
        up to `max_retries` attempts total. Returns None if every attempt
        is rate-limited/unavailable."""
        backoff = self._retry_backoff_seconds
        for attempt in range(self._max_retries):
            response = await self._client.request(method, url, **kwargs)
            if response.status_code in (429, 503):
                if attempt < self._max_retries - 1:
                    await asyncio.sleep(backoff)
                    backoff *= 2
                    continue
                return None
            return response
        return None  # pragma: no cover - unreachable, loop always returns/continues


def get_off_client(request: Request) -> OffClient:
    """FastAPI dependency returning the single, process-lifetime `OffClient`
    created by `main.py`'s lifespan handler (so its rate limiters and HTTP
    connection pool are genuinely shared across requests -- see CRITICAL 1
    of the final-review fixes).

    Falls back to lazily creating (and caching on `app.state`) a client if
    one isn't already present -- this only happens when the app is driven
    without running lifespan events (e.g. httpx's `ASGITransport` in tests,
    which does not send `lifespan.startup`), so tests still get a real,
    shared-for-the-test-process client rather than a per-call throwaway.
    """
    off_client = getattr(request.app.state, "off_client", None)
    if off_client is None:
        off_client = OffClient()
        request.app.state.off_client = off_client
    return off_client


def normalize(off_product: dict) -> dict | None:
    """Normalize a raw OFF product payload into this app's internal shape:
    barcode/name/brand/image_url/serving_size_g plus the 8 per-100g
    nutriment fields the `Food.nutriments` JSONB column expects.

    `serving_size_g` is taken from OFF's `serving_quantity` field only when
    it's present and numeric -- `serving_size` is a free-text string (e.g.
    "30 g") and is not parsed.

    Returns None if kcal cannot be determined (neither `energy-kcal_100g`
    nor `energy-kj_100g` is present) -- such a product isn't usable.
    """
    nutriments = off_product.get("nutriments") or {}

    kcal = nutriments.get("energy-kcal_100g")
    if kcal is None:
        kj = nutriments.get("energy-kj_100g")
        if kj is not None:
            kcal = kj / KJ_PER_KCAL
    if kcal is None:
        return None

    normalized_nutriments = {"kcal": kcal}
    for our_key, off_key in _NUTRIMENT_KEY_MAP.items():
        value = nutriments.get(off_key)
        normalized_nutriments[our_key] = value if value is not None else 0

    brand = off_product.get("brands")
    if isinstance(brand, str) and brand:
        brand = brand.split(",")[0].strip()

    serving_size_g = off_product.get("serving_quantity")
    if not isinstance(serving_size_g, int | float):
        serving_size_g = None

    return {
        "barcode": off_product.get("code"),
        "name": off_product.get("product_name") or "",
        "brand": brand or None,
        "image_url": off_product.get("image_url"),
        "serving_size_g": serving_size_g,
        "nutriments": normalized_nutriments,
    }
