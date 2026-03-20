"""
Frost API weather fetch with cache and force-fetch support.
Fetches historical observations (6-hourly) for Oslo, caches full responses
to avoid repeat API calls. Uses four elements: air_temperature,
precipitation_amount, wind_speed, relative_humidity.
"""

import json
import os
from datetime import datetime
from pathlib import Path

import requests

FROST_OBSERVATIONS_URL = "https://frost.met.no/observations/v0.jsonld"

# Daily aggregates (match Frost official example format to avoid 403).
# Gives one value per day per element; can still correlate with trip data by date.
FROST_ELEMENTS = [
    "mean(air_temperature P1D)",
    "sum(precipitation_amount P1D)",
    "mean(wind_speed P1D)",
    "mean(relative_humidity P1D)",
]

# Default Oslo station (Blindern). Override with FROST_SOURCE_ID if needed.
DEFAULT_SOURCE_ID = "SN18700"

# MET requires a unique, identifying User-Agent; including contact (e.g. email) avoids 403.
# Set FROST_USER_AGENT in .env to e.g. "INF252-Course-Project/1.0 (your.email@example.com)"
def _user_agent() -> str:
    return os.environ.get(
        "FROST_USER_AGENT",
        "INF252-Course-Project/1.0 (frost_fetch; set FROST_USER_AGENT with your email in .env)",
    )


def _cache_path(cache_dir: Path, source_id: str, year: int, month: int) -> Path:
    """Path to cached month file."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / f"{source_id}_{year:04d}-{month:02d}.json"


def _read_cache(cache_path: Path) -> dict | None:
    """Read cached result if it exists. Returns None if missing or invalid."""
    if not cache_path.exists():
        return None
    try:
        with open(cache_path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _write_cache(
    cache_path: Path,
    source_id: str,
    year: int,
    month: int,
    referencetime: str,
    response: dict,
) -> None:
    """Write full response to cache."""
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source_id": source_id,
        "year": year,
        "month": month,
        "referencetime": referencetime,
        "fetched_at": datetime.now().isoformat(),
        "response": response,
    }
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def fetch_weather_month(
    year: int,
    month: int,
    client_id: str,
    cache_dir: Path,
    *,
    source_id: str | None = None,
    force_fetch: bool | None = None,
) -> dict:
    """
    Fetch Frost observations for one month (6-hourly; four elements).
    Uses cache if available unless force_fetch is True or FORCE_WEATHER_FETCH=1.

    Args:
        year: Year (e.g. 2019)
        month: Month 1–12
        client_id: Frost API client ID (e.g. from FROST_API_CLIENT_ID)
        cache_dir: Directory for cache (e.g. project_root / "weather-cache")
        source_id: Frost source ID (default SN18700 Blindern Oslo). Can set FROST_SOURCE_ID.
        force_fetch: If True, bypass cache. If None, reads FORCE_WEATHER_FETCH.

    Returns:
        Dict with keys: year, month, source_id, cached, response (full Frost API response)
    """
    if force_fetch is None:
        force_fetch = os.environ.get("FORCE_WEATHER_FETCH", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
    sid = (source_id or os.environ.get("FROST_SOURCE_ID") or DEFAULT_SOURCE_ID).strip()

    cache_path = _cache_path(cache_dir, sid, year, month)

    if not force_fetch:
        cached = _read_cache(cache_path)
        if cached is not None:
            return {
                "year": year,
                "month": month,
                "source_id": sid,
                "cached": True,
                "response": cached.get("response", cached),
            }

    # Date-only range (Frost default to midnight; minimal request uses this format)
    start = f"{year:04d}-{month:02d}-01"
    if month == 12:
        end = f"{year + 1:04d}-01-01"
    else:
        end = f"{year:04d}-{month + 1:02d}-01"
    referencetime = f"{start}/{end}"

    # Only sources, referencetime, elements (no timeoffsets/levels/qualities) to avoid 403.
    # Filter to 6-hourly and quality in post-processing if needed.
    params = {
        "sources": sid,
        "referencetime": referencetime,
        "elements": ",".join(FROST_ELEMENTS),
    }

    # Frost expects client_id with no leading/trailing whitespace
    client_id_clean = (client_id or "").strip()
    resp = requests.get(
        FROST_OBSERVATIONS_URL,
        params=params,
        auth=(client_id_clean, ""),
        timeout=60,
        headers={"User-Agent": _user_agent()},
    )

    if not resp.ok:
        msg = f"Frost API error {resp.status_code}: "
        try:
            err = resp.json()
            if isinstance(err.get("error"), dict):
                msg += err["error"].get("message", err["error"].get("reason", resp.text[:200]))
            else:
                msg += resp.text[:500]
        except Exception:
            msg += resp.text[:500]
        if resp.status_code == 403:
            msg += (
                "\n\n403 usually means User-Agent. In .env use a space and parentheses around the email: "
                "FROST_USER_AGENT=INF252-Course-Project/1.0 (you@example.com)  — not a slash before the email."
            )
        raise RuntimeError(msg)

    response_data = resp.json()
    _write_cache(cache_path, sid, year, month, referencetime, response_data)

    return {
        "year": year,
        "month": month,
        "source_id": sid,
        "cached": False,
        "response": response_data,
    }


def fetch_weather_range(
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    client_id: str,
    cache_dir: Path,
    *,
    source_id: str | None = None,
    force_fetch: bool | None = None,
) -> list[dict]:
    """
    Fetch Frost observations for a range of months (one request per month).
    Checks cache for each month and only calls the API for months not yet cached.

    Args:
        start_year, start_month: First month (inclusive)
        end_year, end_month: Last month (inclusive)
        client_id: Frost API client ID
        cache_dir: Directory for cache
        source_id: Optional Frost source ID
        force_fetch: If True, bypass cache. If None, reads FORCE_WEATHER_FETCH.

    Returns:
        List of dicts with keys: year, month, source_id, cached, response
    """
    results = []
    y, m = start_year, start_month
    while (y, m) <= (end_year, end_month):
        results.append(
            fetch_weather_month(
                y, m, client_id, cache_dir,
                source_id=source_id,
                force_fetch=force_fetch,
            )
        )
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
    return results
