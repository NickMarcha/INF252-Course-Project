"""
Daily aggregates: sum(duration), trip count, weather, holiday/weekend flags;
empirical norm = median total cycling time for same (dow, ISO week) on
non-holiday days in other years.

Writes prepared-data/cycling/cycling_daily_panel.parquet (excluded from public sync)
and cycling_daily_norm_series.json (small, synced for charts).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

TRIP_PARQUET = "prepared-data/cycling/trips_with_context.parquet"
OUT_PARQUET = "prepared-data/cycling/cycling_daily_panel.parquet"
OUT_JSON = "prepared-data/cycling/cycling_daily_norm_series.json"


def project_root_from_here() -> Path:
    cwd = Path.cwd()
    if (cwd / "package.json").exists():
        return cwd
    if (cwd.parent / "package.json").exists():
        return cwd.parent
    return cwd


def load_weather(root: Path) -> pd.DataFrame:
    p = root / "prepared-data" / "weather_oslo.json"
    with open(p, encoding="utf-8") as f:
        w = json.load(f)
    rows = w.get("data", w)
    return pd.DataFrame(rows)


def run_daily(root: Path | None = None) -> Path:
    root = root or project_root_from_here()
    t0 = time.time()
    trip_path = root / TRIP_PARQUET
    if not trip_path.exists():
        raise FileNotFoundError(f"Missing {trip_path}")

    cols = ["local_date", "duration_sec", "is_public_holiday"]
    print("Reading trip parquet (aggregating by day) …")
    df = pd.read_parquet(trip_path, columns=cols)
    daily = (
        df.groupby("local_date", observed=True)
        .agg(
            total_duration_sec=("duration_sec", "sum"),
            trip_count=("duration_sec", "count"),
            any_holiday=("is_public_holiday", "max"),
        )
        .reset_index()
    )
    daily["local_date"] = pd.to_datetime(daily["local_date"])
    daily["dow"] = daily["local_date"].dt.dayofweek
    daily["iso_week"] = daily["local_date"].dt.isocalendar().week.astype(int)
    daily["year"] = daily["local_date"].dt.year
    daily["is_weekend"] = daily["dow"] >= 5

    wx = load_weather(root)
    wx["date"] = pd.to_datetime(wx["date"])
    daily = daily.merge(wx, left_on="local_date", right_on="date", how="left").drop(
        columns=["date"], errors="ignore"
    )

    # Norm: median total_duration_sec for same (dow, iso_week) among non-holiday days in *other* years
    def norm_for_row(r: pd.Series) -> float:
        pool = daily[
            (daily["dow"] == r["dow"])
            & (daily["iso_week"] == r["iso_week"])
            & (~daily["any_holiday"])
            & (daily["year"] != r["year"])
        ]["total_duration_sec"]
        if len(pool) == 0:
            pool = daily[(daily["dow"] == r["dow"]) & (~daily["any_holiday"])]["total_duration_sec"]
        if len(pool) == 0:
            return float("nan")
        return float(pool.median())

    daily["norm_total_duration_sec"] = daily.apply(norm_for_row, axis=1)
    daily["pct_vs_norm"] = (
        (daily["total_duration_sec"] - daily["norm_total_duration_sec"])
        / daily["norm_total_duration_sec"].replace(0, np.nan)
        * 100.0
    )

    out_pq = root / OUT_PARQUET
    out_pq.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(daily, preserve_index=False), out_pq, compression="snappy")
    print(f"Wrote {out_pq} ({len(daily):,} days)")

    series = [
        {
            "date": r["local_date"].strftime("%Y-%m-%d") if hasattr(r["local_date"], "strftime") else str(r["local_date"])[:10],
            "total_duration_min": round(r["total_duration_sec"] / 60.0, 2),
            "trip_count": int(r["trip_count"]),
            "norm_total_min": round(r["norm_total_duration_sec"] / 60.0, 2)
            if not np.isnan(r["norm_total_duration_sec"])
            else None,
            "pct_vs_norm": round(float(r["pct_vs_norm"]), 2)
            if not np.isnan(r["pct_vs_norm"])
            else None,
            "is_weekend": bool(r["is_weekend"]),
            "any_holiday": bool(r["any_holiday"]),
        }
        for _, r in daily.iterrows()
    ]

    sys.path.insert(0, str(root / "data-pipeline"))
    from execution_utils import write_with_execution_metadata

    write_with_execution_metadata(
        root / OUT_JSON,
        {"series": series, "norm_definition": "median total_duration same dow+iso_week, non-holiday, other years"},
        t0,
    )
    print(f"Wrote {root / OUT_JSON}")
    return out_pq


def main() -> None:
    run_daily()


if __name__ == "__main__":
    main()
