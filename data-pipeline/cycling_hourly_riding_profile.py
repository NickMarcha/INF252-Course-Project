"""
Avg daily riding time and trip counts by Oslo start hour (weekday vs weekend).

Uses the same trip-level filters as cycling_regression.py (duration quantile cap,
minimum seconds). Reads prepared-data/cycling/trips_with_context.parquet.

Run from repo root: python data-pipeline/cycling_hourly_riding_profile.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pandas as pd

_SCRIPT_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPT_DIR.parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from execution_utils import write_with_execution_metadata

TRIP_PARQUET = "prepared-data/cycling/trips_with_context.parquet"
OUT_JSON = "prepared-data/cycling/cycling_hourly_riding_profile.json"
QUANTILE_CAP = 0.995
MIN_DURATION_SEC = 30


def project_root_from_here() -> Path:
    cwd = Path.cwd()
    if (cwd / "package.json").exists():
        return cwd
    if (cwd.parent / "package.json").exists():
        return cwd.parent
    return cwd


def run_hourly_profile(
    root: Path | None = None,
    *,
    quantile_cap: float = QUANTILE_CAP,
    min_duration_sec: int = MIN_DURATION_SEC,
) -> dict:
    root = root or project_root_from_here()
    t0 = time.time()
    path = root / TRIP_PARQUET
    if not path.exists():
        raise FileNotFoundError(f"Run cycling_trip_table first: missing {path}")

    df = pd.read_parquet(path)
    cap = df["duration_sec"].quantile(quantile_cap)
    df = df[(df["duration_sec"] <= cap) & (df["duration_sec"] >= min_duration_sec)].copy()
    df["start_hour"] = pd.to_datetime(df["started_at_oslo"]).dt.hour.astype("int16")

    wd = df[~df["is_weekend"]]
    we = df[df["is_weekend"]]
    n_weekday_days = int(wd["local_date"].nunique())
    n_weekend_days = int(we["local_date"].nunique())
    if n_weekday_days < 1:
        n_weekday_days = 1
    if n_weekend_days < 1:
        n_weekend_days = 1

    weekday_duration_min_avg_daily: list[float] = []
    weekend_duration_min_avg_daily: list[float] = []
    weekday_trips_avg_daily: list[float] = []
    weekend_trips_avg_daily: list[float] = []

    for h in range(24):
        sub_wd = wd[wd["start_hour"] == h]
        sub_we = we[we["start_hour"] == h]
        weekday_duration_min_avg_daily.append(float(sub_wd["duration_sec"].sum()) / n_weekday_days / 60.0)
        weekend_duration_min_avg_daily.append(float(sub_we["duration_sec"].sum()) / n_weekend_days / 60.0)
        weekday_trips_avg_daily.append(float(len(sub_wd)) / n_weekday_days)
        weekend_trips_avg_daily.append(float(len(sub_we)) / n_weekend_days)

    norm_definition = (
        f"Trip-based hourly profile (Oslo start clock, Europe/Oslo): for each hour h, "
        f"values are total duration or trip count of trips starting in h, divided by the number of "
        f"distinct calendar days in that class (weekday: Mon–Fri, weekend: Sat–Sun). "
        f"Same duration filters as regression: ≤{quantile_cap:.3f} quantile of duration_sec, ≥{min_duration_sec}s. "
        f"Weekday days in window: {n_weekday_days:,}; weekend days: {n_weekend_days:,}. "
        f"Bucketing by start hour means a long ride contributes only to its start hour; sums over hours can be "
        f"below network-wide minutes per day."
    )

    payload = {
        "norm_definition": norm_definition,
        "duration_quantile_cap": quantile_cap,
        "min_duration_sec": min_duration_sec,
        "n_weekday_days": n_weekday_days,
        "n_weekend_days": n_weekend_days,
        "weekday_duration_min_avg_daily": weekday_duration_min_avg_daily,
        "weekend_duration_min_avg_daily": weekend_duration_min_avg_daily,
        "weekday_trips_avg_daily": weekday_trips_avg_daily,
        "weekend_trips_avg_daily": weekend_trips_avg_daily,
    }

    out_path = root / OUT_JSON
    out_path.parent.mkdir(parents=True, exist_ok=True)

    write_with_execution_metadata(out_path, payload, t0)
    print("Wrote", out_path)
    return payload


def main() -> None:
    run_hourly_profile()


if __name__ == "__main__":
    main()
