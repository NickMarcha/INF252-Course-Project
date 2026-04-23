#!/usr/bin/env python3
"""
Aggregate station_by_day_*.parquet into average daily departures (out) and
destinations (in) on weekdays vs weekends for the latest *complete* calendar month.

Writes: prepared-data/stations/station_in_out_latest_full_month.json

Run after station_trip_counts.ipynb (or whenever Parquet is refreshed).
  NONINTERACTIVE=1 python data-pipeline/export_station_in_out_month.py
"""

from __future__ import annotations

import calendar
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import pandas as pd

project_root = Path(__file__).resolve().parent.parent
stations_dir = project_root / "prepared-data" / "stations"
sys.path.insert(0, str(project_root / "data-pipeline"))
from execution_utils import show_execution_banner, write_with_execution_metadata  # noqa: E402


def last_day_of_month(y: int, m: int) -> int:
    return calendar.monthrange(y, m)[1]


def resolve_latest_full_month(max_period: str) -> tuple[int, int]:
    """Given max YYYY-MM-DD in data, return (year, month) of latest complete calendar month."""
    d = date.fromisoformat(max_period)
    if d.day == last_day_of_month(d.year, d.month):
        return d.year, d.month
    if d.month == 1:
        return d.year - 1, 12
    return d.year, d.month - 1


def main() -> None:
    parquet_files = sorted(stations_dir.glob("station_by_day_*.parquet"))
    if not parquet_files:
        print("No station_by_day_*.parquet in", stations_dir, file=sys.stderr)
        sys.exit(1)

    max_period: str | None = None
    for p in parquet_files:
        df_col = pd.read_parquet(p, columns=["period"])
        m = str(df_col["period"].max())
        if max_period is None or m > max_period:
            max_period = m

    assert max_period is not None
    target_y, target_m = resolve_latest_full_month(max_period)
    n_days = last_day_of_month(target_y, target_m)
    expected_dates = {date(target_y, target_m, d).isoformat() for d in range(1, n_days + 1)}

    year_path = stations_dir / f"station_by_day_{target_y}.parquet"
    if not year_path.exists():
        print(f"Missing {year_path} for month {target_y}-{target_m:02d}", file=sys.stderr)
        sys.exit(1)

    prefix = f"{target_y}-{target_m:02d}-"
    df = pd.read_parquet(year_path)
    df = df[df["period"].astype(str).str.startswith(prefix)]
    if df.empty:
        print(f"No rows for {prefix} in {year_path}", file=sys.stderr)
        sys.exit(1)

    dates_with_data = set(df["period"].astype(str).unique())
    coverage = len(dates_with_data & expected_dates) / len(expected_dates)
    warnings: list[str] = []
    if coverage < 0.9:
        warnings.append("sparse_month")

    n_weekdays = sum(
        1 for d in range(1, n_days + 1) if date(target_y, target_m, d).weekday() < 5
    )
    n_weekend = n_days - n_weekdays

    daily = (
        df.groupby(["period", "station_id", "direction"], as_index=False)["count"]
        .sum()
    )

    wd_sum: dict[tuple[str, str], float] = defaultdict(float)
    we_sum: dict[tuple[str, str], float] = defaultdict(float)
    for _, row in daily.iterrows():
        p = str(row["period"])
        sid = str(row["station_id"])
        direction = str(row["direction"])
        cnt = float(row["count"])
        d = date.fromisoformat(p)
        key = (sid, direction)
        if d.weekday() < 5:
            wd_sum[key] += cnt
        else:
            we_sum[key] += cnt

    # Hourly totals (sum over month) then average per weekday / per weekend day
    hour_wd_in: dict[str, list[float]] = {}
    hour_wd_out: dict[str, list[float]] = {}
    hour_we_in: dict[str, list[float]] = {}
    hour_we_out: dict[str, list[float]] = {}

    def ensure_hour_lists(sid: str) -> None:
        if sid not in hour_wd_in:
            hour_wd_in[sid] = [0.0] * 24
            hour_wd_out[sid] = [0.0] * 24
            hour_we_in[sid] = [0.0] * 24
            hour_we_out[sid] = [0.0] * 24

    for _, row in df.iterrows():
        p = str(row["period"])
        sid = str(row["station_id"])
        direction = str(row["direction"])
        h = int(row["hour"])
        if h < 0 or h > 23:
            continue
        cnt = float(row["count"])
        d = date.fromisoformat(p)
        ensure_hour_lists(sid)
        if d.weekday() < 5:
            if direction == "in":
                hour_wd_in[sid][h] += cnt
            else:
                hour_wd_out[sid][h] += cnt
        else:
            if direction == "in":
                hour_we_in[sid][h] += cnt
            else:
                hour_we_out[sid][h] += cnt

    station_ids = {s for s, _ in wd_sum.keys()} | {s for s, _ in we_sum.keys()}
    stations_out: list[dict] = []
    for sid in sorted(station_ids, key=lambda x: (len(x), x)):
        wd_out = wd_sum.get((sid, "out"), 0.0)
        wd_in = wd_sum.get((sid, "in"), 0.0)
        we_out = we_sum.get((sid, "out"), 0.0)
        we_in = we_sum.get((sid, "in"), 0.0)
        ensure_hour_lists(sid)
        div_wd = float(n_weekdays) if n_weekdays else 1.0
        div_we = float(n_weekend) if n_weekend else 1.0
        stations_out.append(
            {
                "id": sid,
                "avg_weekday_departures": round(wd_out / n_weekdays, 4)
                if n_weekdays
                else 0.0,
                "avg_weekday_destinations": round(wd_in / n_weekdays, 4)
                if n_weekdays
                else 0.0,
                "avg_weekend_departures": round(we_out / n_weekend, 4)
                if n_weekend
                else 0.0,
                "avg_weekend_destinations": round(we_in / n_weekend, 4)
                if n_weekend
                else 0.0,
                "hourly_weekday_destinations": [
                    round(hour_wd_in[sid][h] / div_wd, 4) for h in range(24)
                ],
                "hourly_weekday_departures": [
                    round(hour_wd_out[sid][h] / div_wd, 4) for h in range(24)
                ],
                "hourly_weekend_destinations": [
                    round(hour_we_in[sid][h] / div_we, 4) for h in range(24)
                ],
                "hourly_weekend_departures": [
                    round(hour_we_out[sid][h] / div_we, 4) for h in range(24)
                ],
            }
        )

    payload = {
        "month_label": f"{target_y}-{target_m:02d}",
        "max_period_in_data": max_period,
        "n_weekdays": n_weekdays,
        "n_weekend_days": n_weekend,
        "day_coverage_in_month": round(coverage, 4),
        "warnings": warnings,
        "stations": stations_out,
    }

    out_path = stations_dir / "station_in_out_latest_full_month.json"
    start = show_execution_banner(out_path)
    write_with_execution_metadata(out_path, payload, start)
    print(f"Wrote {out_path} ({len(stations_out)} stations, month {payload['month_label']})")


if __name__ == "__main__":
    main()
