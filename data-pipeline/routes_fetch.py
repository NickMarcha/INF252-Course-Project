"""
Google Routes API fetch with cache and force-fetch support.
Fetches bicycle routes between stations, caches full responses to avoid
repeat API calls.
"""

import json
import os
from datetime import datetime
from pathlib import Path

import requests

ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
FIELD_MASK = (
    "routes.duration,routes.distanceMeters,routes.polyline,"
    "routes.viewport,routes.legs,routes.travelAdvisory"
)


def _get_station_coords(
    stations: list[dict], station_id: str
) -> tuple[float, float]:
    """Look up lat/lon for a station by id. Raises KeyError if not found."""
    for s in stations:
        if str(s.get("id")) == str(station_id):
            return float(s["lat"]), float(s["lon"])
    raise KeyError(f"Station {station_id} not found in stations list")


def _cache_path(cache_dir: Path, origin_id: str, dest_id: str) -> Path:
    """Path to cached single-route file."""
    single_dir = cache_dir / "single"
    single_dir.mkdir(parents=True, exist_ok=True)
    return single_dir / f"{origin_id}_{dest_id}.json"


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
    cache_path: Path, origin_id: str, dest_id: str, response: dict
) -> None:
    """Write full response to cache."""
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "origin_id": str(origin_id),
        "dest_id": str(dest_id),
        "fetched_at": datetime.now().isoformat(),
        "response": response,
    }
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def fetch_route(
    origin_id: str,
    dest_id: str,
    stations: list[dict],
    api_key: str,
    cache_dir: Path,
    *,
    force_fetch: bool | None = None,
) -> dict:
    """
    Fetch a single bicycle route from origin to destination.
    Uses cache if available unless force_fetch is True or FORCE_ROUTES_FETCH=1.

    Args:
        origin_id: Station id of origin
        dest_id: Station id of destination
        stations: List of station dicts with id, lat, lon
        api_key: Google Routes API key
        cache_dir: Directory for cache (e.g. project_root / "routes-cache")
        force_fetch: If True, bypass cache. If None, reads FORCE_ROUTES_FETCH.

    Returns:
        Dict with keys: origin_id, dest_id, cached, response (full API resp)
    """
    if force_fetch is None:
        force_fetch = os.environ.get("FORCE_ROUTES_FETCH", "").strip() in (
            "1", "true", "yes"
        )

    cache_path = _cache_path(cache_dir, origin_id, dest_id)

    if not force_fetch:
        cached = _read_cache(cache_path)
        if cached is not None:
            return {
                "origin_id": origin_id,
                "dest_id": dest_id,
                "cached": True,
                "response": cached.get("response", cached),
            }

    o_lat, o_lon = _get_station_coords(stations, origin_id)
    d_lat, d_lon = _get_station_coords(stations, dest_id)

    body = {
        "origin": {
            "location": {"latLng": {"latitude": o_lat, "longitude": o_lon}},
        },
        "destination": {
            "location": {"latLng": {"latitude": d_lat, "longitude": d_lon}},
        },
        "travelMode": "BICYCLE",
        "units": "METRIC",
    }

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": FIELD_MASK,
    }

    resp = requests.post(
        ROUTES_API_URL, json=body, headers=headers, timeout=30
    )

    if not resp.ok:
        raise RuntimeError(
            f"Routes API error {resp.status_code}: {resp.text[:500]}"
        )

    response_data = resp.json()
    _write_cache(cache_path, origin_id, dest_id, response_data)

    return {
        "origin_id": origin_id,
        "dest_id": dest_id,
        "cached": False,
        "response": response_data,
    }


def fetch_routes_batch(
    route_pairs: list[tuple[str, str]],
    stations: list[dict],
    api_key: str,
    cache_dir: Path,
    *,
    force_fetch: bool | None = None,
) -> list[dict]:
    """
    Fetch multiple bicycle routes. Checks cache for each pair and only calls
    the API for pairs not yet cached. Results are cached per pair in the same
    format as fetch_route. The frontend receives a combined routes.json and
    cannot tell whether routes were fetched singly or in batch.

    Args:
        route_pairs: List of (origin_id, dest_id) tuples
        stations: List of station dicts with id, lat, lon
        api_key: Google Routes API key
        cache_dir: Directory for cache (e.g. project_root / "routes-cache")
        force_fetch: If True, bypass cache. If None, reads FORCE_ROUTES_FETCH.

    Returns:
        List of dicts with keys: origin_id, dest_id, cached, response
    """
    results = []
    for origin_id, dest_id in route_pairs:
        result = fetch_route(
            origin_id, dest_id, stations, api_key, cache_dir,
            force_fetch=force_fetch,
        )
        results.append(result)
    return results
