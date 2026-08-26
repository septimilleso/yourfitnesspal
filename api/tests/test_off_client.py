"""Tests for the OpenFoodFacts client: HTTP behavior, retries, rate
limiting, and nutriment normalization.

All HTTP calls are intercepted with respx -- no real network calls are
made against world.openfoodfacts.org.
"""

import time

import httpx
import pytest
import respx

from app.services.off_client import OffClient, TokenBucketRateLimiter, normalize

BASE_URL = "https://world.openfoodfacts.org"


def _product_response(product: dict, status: int = 1) -> dict:
    return {"status": status, "code": product.get("code", ""), "product": product}


NORMAL_PRODUCT = {
    "code": "0000000000017",
    "product_name": "Test Bar",
    "brands": "Testco",
    "image_url": "https://images.example/test-bar.jpg",
    "serving_size": "45 g",
    "serving_quantity": 45,
    "nutriments": {
        "energy-kcal_100g": 250,
        "proteins_100g": 10.5,
        "carbohydrates_100g": 30.2,
        "sugars_100g": 12.6,
        "fat_100g": 8.1,
        "saturated-fat_100g": 2.4,
        "fiber_100g": 3.0,
        "salt_100g": 0.4,
    },
}

KJ_ONLY_PRODUCT = {
    "code": "0000000000024",
    "product_name": "KJ Product",
    "brands": "Testco",
    "nutriments": {
        "energy-kj_100g": 1046.0,  # ~250 kcal
        "proteins_100g": 10.5,
        "carbohydrates_100g": 30.2,
        "sugars_100g": 12.6,
        "fat_100g": 8.1,
        "saturated-fat_100g": 2.4,
        "fiber_100g": 3.0,
        "salt_100g": 0.4,
    },
}

NO_NUTRIMENTS_PRODUCT = {
    "code": "0000000000031",
    "product_name": "Mystery Product",
    "nutriments": {},
}


# --- normalize() -------------------------------------------------------


def test_normalize_normal_kcal_product():
    result = normalize(NORMAL_PRODUCT)

    assert result is not None
    assert result["barcode"] == "0000000000017"
    assert result["name"] == "Test Bar"
    assert result["brand"] == "Testco"
    assert result["image_url"] == "https://images.example/test-bar.jpg"
    assert result["serving_size_g"] == 45
    assert result["nutriments"] == {
        "kcal": 250,
        "protein_g": 10.5,
        "carbs_g": 30.2,
        "sugars_g": 12.6,
        "fat_g": 8.1,
        "sat_fat_g": 2.4,
        "fiber_g": 3.0,
        "salt_g": 0.4,
    }
    assert set(result["nutriments"].keys()) == {
        "kcal",
        "protein_g",
        "carbs_g",
        "sugars_g",
        "fat_g",
        "sat_fat_g",
        "fiber_g",
        "salt_g",
    }


def test_normalize_kj_only_product_converts_to_kcal():
    result = normalize(KJ_ONLY_PRODUCT)

    assert result is not None
    # 1046.0 / 4.184 = 250.0 kcal
    assert result["nutriments"]["kcal"] == pytest.approx(250.0, abs=0.1)


def test_normalize_missing_serving_quantity_and_image_are_none():
    """KJ_ONLY_PRODUCT has no `image_url`/`serving_quantity` fields, and
    `serving_size` (a free-text string) is never parsed into grams."""
    result = normalize(KJ_ONLY_PRODUCT)

    assert result is not None
    assert result["image_url"] is None
    assert result["serving_size_g"] is None


def test_normalize_non_numeric_serving_quantity_is_ignored():
    product = {**NORMAL_PRODUCT, "serving_quantity": "not-a-number"}
    result = normalize(product)

    assert result is not None
    assert result["serving_size_g"] is None


def test_normalize_missing_nutriments_returns_none():
    result = normalize(NO_NUTRIMENTS_PRODUCT)

    assert result is None


# --- get_product() ------------------------------------------------------


@pytest.mark.asyncio
async def test_get_product_success():
    async with respx.mock(base_url=BASE_URL) as mock:
        mock.get("/api/v2/product/0000000000017.json").mock(
            return_value=httpx.Response(200, json=_product_response(NORMAL_PRODUCT))
        )
        client = OffClient(contact_email="test@example.com")
        try:
            product = await client.get_product("0000000000017")
        finally:
            await client.aclose()

    assert product is not None
    assert product["code"] == "0000000000017"


@pytest.mark.asyncio
async def test_get_product_404_returns_none():
    async with respx.mock(base_url=BASE_URL) as mock:
        mock.get("/api/v2/product/9999999999999.json").mock(
            return_value=httpx.Response(404, json={"status": 0})
        )
        client = OffClient(contact_email="test@example.com")
        try:
            product = await client.get_product("9999999999999")
        finally:
            await client.aclose()

    assert product is None


@pytest.mark.asyncio
async def test_get_product_status_zero_returns_none():
    async with respx.mock(base_url=BASE_URL) as mock:
        mock.get("/api/v2/product/0000000000048.json").mock(
            return_value=httpx.Response(200, json={"status": 0, "code": "0000000000048"})
        )
        client = OffClient(contact_email="test@example.com")
        try:
            product = await client.get_product("0000000000048")
        finally:
            await client.aclose()

    assert product is None


@pytest.mark.asyncio
async def test_get_product_retries_after_429_then_succeeds():
    async with respx.mock(base_url=BASE_URL) as mock:
        route = mock.get("/api/v2/product/0000000000017.json")
        route.side_effect = [
            httpx.Response(429),
            httpx.Response(200, json=_product_response(NORMAL_PRODUCT)),
        ]
        client = OffClient(contact_email="test@example.com", retry_backoff_seconds=0.01)
        try:
            product = await client.get_product("0000000000017")
        finally:
            await client.aclose()

    assert product is not None
    assert product["code"] == "0000000000017"
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_get_product_gives_up_after_max_retries_of_429():
    async with respx.mock(base_url=BASE_URL) as mock:
        route = mock.get("/api/v2/product/0000000000017.json")
        route.mock(return_value=httpx.Response(429))
        client = OffClient(contact_email="test@example.com", retry_backoff_seconds=0.01)
        try:
            product = await client.get_product("0000000000017")
        finally:
            await client.aclose()

    assert product is None
    assert route.call_count == 3


# --- search() -------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_returns_products():
    async with respx.mock(base_url=BASE_URL) as mock:
        mock.get("/cgi/search.pl").mock(
            return_value=httpx.Response(200, json={"products": [NORMAL_PRODUCT, KJ_ONLY_PRODUCT]})
        )
        client = OffClient(contact_email="test@example.com")
        try:
            products = await client.search("bar", limit=10)
        finally:
            await client.aclose()

    assert len(products) == 2


@pytest.mark.asyncio
async def test_search_returns_none_after_max_retries_of_503():
    async with respx.mock(base_url=BASE_URL) as mock:
        route = mock.get("/cgi/search.pl")
        route.mock(return_value=httpx.Response(503))
        client = OffClient(contact_email="test@example.com", retry_backoff_seconds=0.01)
        try:
            products = await client.search("bar", limit=10)
        finally:
            await client.aclose()

    assert products is None
    assert route.call_count == 3


# --- rate limiter -----------------------------------------------------


@pytest.mark.asyncio
async def test_product_rate_limiter_delays_calls_beyond_capacity():
    """15 calls should go through immediately; the 16th must wait until a
    slot frees in the (injected, small) rate-limit window."""
    async with respx.mock(base_url=BASE_URL) as mock:
        mock.get(url__regex=r"/api/v2/product/.+\.json").mock(
            return_value=httpx.Response(200, json=_product_response(NORMAL_PRODUCT))
        )
        window_seconds = 0.3
        limiter = TokenBucketRateLimiter(capacity=15, window_seconds=window_seconds)
        client = OffClient(contact_email="test@example.com", product_rate_limiter=limiter)

        start = time.monotonic()
        try:
            for i in range(16):
                await client.get_product(f"{i:013d}")
        finally:
            await client.aclose()
        elapsed = time.monotonic() - start

    assert elapsed >= window_seconds


@pytest.mark.asyncio
async def test_product_rate_limiter_does_not_delay_calls_within_capacity():
    async with respx.mock(base_url=BASE_URL) as mock:
        mock.get(url__regex=r"/api/v2/product/.+\.json").mock(
            return_value=httpx.Response(200, json=_product_response(NORMAL_PRODUCT))
        )
        limiter = TokenBucketRateLimiter(capacity=15, window_seconds=60.0)
        client = OffClient(contact_email="test@example.com", product_rate_limiter=limiter)

        start = time.monotonic()
        try:
            for i in range(15):
                await client.get_product(f"{i:013d}")
        finally:
            await client.aclose()
        elapsed = time.monotonic() - start

    assert elapsed < 1.0
