"""
Build trip-level Parquet: Oslo-local calendar features, time-of-day buckets,
weather (daily Blindern join on local_date), Norway public holidays, haversine_km, route_key.

Weather is a same-day aggregate for the whole city (not hourly along the trip).

Run from repo root or data-pipeline: python cycling_trip_table.py
Or import build_trips_with_context_parquet(project_root) from a notebook.
"""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

import holidays
import pyarrow as pa
import pyarrow.parquet as pq

OSLO = ZoneInfo("Europe/Oslo")

# Hypothesis-driven labels (hour in Europe/Oslo, trip start)
BUCKET_DEFS: list[tuple[str, tuple[int, ...]]] = [
    ("morning_commute", tuple(range(7, 10))),  # 07–09
    ("midday", tuple(range(10, 15))),  # 10–14
    ("afternoon_commute", tuple(range(15, 19))),  # 15–18
    ("evening", tuple(range(19, 23))),  # 19–22
    ("night", tuple(list(range(23, 24)) + list(range(0, 7)))),  # 23–06
]


def time_of_day_bucket(hour: int) -> str:
    for name, hours in BUCKET_DEFS:
        if hour in hours:
            return name
    return "night"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km (WGS84 sphere)."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return r * c


def load_weather_by_date(project_root: Path) -> dict[str, dict]:
    path = project_root / "prepared-data" / "weather_oslo.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing {path} — run frost weather export first.")
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    rows = payload.get("data", payload) if isinstance(payload, dict) else payload
    out: dict[str, dict] = {}
    for row in rows:
        d = row.get("date")
        if d:
            out[str(d)] = row
    return out


def iter_trip_records(raw_dir: Path) -> Iterator[dict]:
    """Yield raw trip dicts from raw-data/YYYY/*.json."""
    if not raw_dir.exists():
        raise FileNotFoundError(f"Missing {raw_dir}")
    for year_dir in sorted(raw_dir.iterdir()):
        if not year_dir.is_dir():
            continue
        for json_path in sorted(year_dir.glob("*.json")):
            with open(json_path, encoding="utf-8") as f:
                data = json.load(f)
            trips = data if isinstance(data, list) else data.get("data", data.get("trips", []))
            for t in trips:
                yield t


def build_row(
    t: dict,
    weather_by_date: dict[str, dict],
    no_holidays: holidays.HolidayBase,
) -> dict | None:
    started = t.get("started_at")
    if not started:
        return None
    try:
        from datetime import datetime

        dt_utc = datetime.fromisoformat(started.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    dt_oslo = dt_utc.astimezone(OSLO)
    local_date: date = dt_oslo.date()
    date_str = local_date.isoformat()
    wx = weather_by_date.get(date_str)
    if wx is None:
        return None

    dur = t.get("duration")
    if dur is None:
        return None
    try:
        duration_sec = int(dur)
    except (TypeError, ValueError):
        return None
    if duration_sec <= 0 or duration_sec > 86400 * 2:
        return None

    hour = dt_oslo.hour
    bucket = time_of_day_bucket(hour)
    dow = local_date.weekday()  # Mon=0
    is_weekend = dow >= 5
    is_public_holiday = local_date in no_holidays

    sid = str(t.get("start_station_id", "")).strip()
    eid = str(t.get("end_station_id", "")).strip()
    route_key = f"{sid}|{eid}" if sid and eid else ""

    try:
        slat = float(t["start_station_latitude"])
        slon = float(t["start_station_longitude"])
        elat = float(t["end_station_latitude"])
        elon = float(t["end_station_longitude"])
        h_km = haversine_km(slat, slon, elat, elon)
    except (KeyError, TypeError, ValueError):
        h_km = float("nan")

    def fwx(key: str) -> float:
        v = wx.get(key)
        if v is None:
            return float("nan")
        try:
            return float(v)
        except (TypeError, ValueError):
            return float("nan")

    return {
        "started_at_oslo": dt_oslo.replace(tzinfo=None),
        "local_date": local_date,
        "year": local_date.year,
        "month": local_date.month,
        "dow": dow,
        "day_of_year": local_date.timetuple().tm_yday,
        "duration_sec": duration_sec,
        "temperature": fwx("temperature"),
        "precipitation": fwx("precipitation"),
        "wind_speed": fwx("wind_speed"),
        "relative_humidity": fwx("relative_humidity"),
        "is_weekend": is_weekend,
        "is_public_holiday": is_public_holiday,
        "time_of_day_bucket": bucket,
        "route_key": route_key,
        "haversine_km": h_km,
        "start_station_id": sid,
        "end_station_id": eid,
    }


def build_trips_with_context_parquet(
    project_root: Path | None = None,
    *,
    batch_size: int = 200_000,
    out_relative: str = "prepared-data/cycling/trips_with_context.parquet",
) -> Path:
    project_root = project_root or Path.cwd()
    if not (project_root / "package.json").exists():
        project_root = project_root.parent.parent
    raw_dir = project_root / "raw-data"
    out_path = project_root / out_relative
    out_path.parent.mkdir(parents=True, exist_ok=True)

    weather_by_date = load_weather_by_date(project_root)
    no_holidays = holidays.country_holidays("NO")

    schema = pa.schema(
        [
            ("started_at_oslo", pa.timestamp("us")),
            ("local_date", pa.date32()),
            ("year", pa.int16()),
            ("month", pa.int8()),
            ("dow", pa.int8()),
            ("day_of_year", pa.int16()),
            ("duration_sec", pa.int32()),
            ("temperature", pa.float32()),
            ("precipitation", pa.float32()),
            ("wind_speed", pa.float32()),
            ("relative_humidity", pa.float32()),
            ("is_weekend", pa.bool_()),
            ("is_public_holiday", pa.bool_()),
            ("time_of_day_bucket", pa.large_string()),
            ("route_key", pa.large_string()),
            ("haversine_km", pa.float32()),
            ("start_station_id", pa.large_string()),
            ("end_station_id", pa.large_string()),
        ]
    )

    batch: list[dict] = []
    writer: pq.ParquetWriter | None = None
    total = 0
    skipped = 0

    for t in iter_trip_records(raw_dir):
        row = build_row(t, weather_by_date, no_holidays)
        if row is None:
            skipped += 1
            continue
        batch.append(row)
        if len(batch) >= batch_size:
            table = pa.Table.from_pylist(batch, schema=schema)
            if writer is None:
                writer = pq.ParquetWriter(out_path, schema, compression="snappy")
            writer.write_table(table)
            total += len(batch)
            batch.clear()
            print(f"  wrote {total:,} rows …")

    if batch:
        table = pa.Table.from_pylist(batch, schema=schema)
        if writer is None:
            writer = pq.ParquetWriter(out_path, schema, compression="snappy")
        writer.write_table(table)
        total += len(batch)
    if writer is not None:
        writer.close()
    elif total == 0 and skipped > 0:
        print("No rows written (all skipped). Check weather date overlap with trips.")

    print(f"Done. {total:,} rows written to {out_path} ({skipped:,} skipped: no weather/out of range)")
    return out_path


def main() -> None:
    root = Path.cwd()
    build_trips_with_context_parquet(root)


if __name__ == "__main__":
    main()
