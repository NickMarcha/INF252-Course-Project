"""
Trip-level log-duration regression: Ridge with haversine_km + CV-fold route target
encoding (train-fold only means), weather, weekend/holiday, time-of-day buckets,
month and year dummies.

Writes small JSON summaries for the frontend under prepared-data/cycling/.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

TRIP_PARQUET = "prepared-data/cycling/trips_with_context.parquet"
OUT_DIR = "prepared-data/cycling"
SUMMARY_JSON = "cycling_regression_summaries.json"
DURATION_BY_CONTEXT_JSON = "cycling_duration_by_context.json"


def project_root_from_here() -> Path:
    cwd = Path.cwd()
    if (cwd / "package.json").exists():
        return cwd
    if (cwd.parent / "package.json").exists():
        return cwd.parent
    return cwd


def route_target_encode(
    route_key: pd.Series,
    y_log: pd.Series,
    train_mask: pd.Series,
    global_mean: float,
) -> pd.Series:
    """Mean y_log per route on train only; map all rows; unseen -> global_mean."""
    tr = train_mask & y_log.notna()
    means = (
        pd.DataFrame({"route_key": route_key[tr], "y": y_log[tr]})
        .groupby("route_key", observed=True)["y"]
        .mean()
    )
    return route_key.map(means).fillna(global_mean)


def build_design_matrix(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Return X frame (numeric + will be one-hot separately) and feature names."""
    x = pd.DataFrame(
        {
            "haversine_km": df["haversine_km"].astype("float64"),
            "route_te_log_duration": df["route_te_log_duration"].astype("float64"),
            "temperature": df["temperature"].astype("float64"),
            "precipitation": df["precipitation"].astype("float64"),
            "wind_speed": df["wind_speed"].astype("float64"),
            "relative_humidity": df["relative_humidity"].astype("float64"),
            "is_weekend": df["is_weekend"].astype("float64"),
            "is_public_holiday": df["is_public_holiday"].astype("float64"),
        }
    )
    # Month / year as integers for one-hot in pipeline
    x["month"] = df["month"].astype(int)
    x["year"] = df["year"].astype(int)
    x["time_of_day_bucket"] = df["time_of_day_bucket"].astype(str)
    return x, list(x.columns)


def run_regression(
    root: Path | None = None,
    *,
    quantile_cap: float = 0.995,
    ridge_alpha: float = 10.0,
) -> dict:
    root = root or project_root_from_here()
    t0 = time.time()
    path = root / TRIP_PARQUET
    if not path.exists():
        raise FileNotFoundError(f"Run cycling_trip_table first: missing {path}")

    print("Loading parquet …")
    df = pd.read_parquet(path)
    print(f"  rows: {len(df):,}")

    # Winsorize extreme durations (seconds)
    cap = df["duration_sec"].quantile(quantile_cap)
    df = df[df["duration_sec"] <= cap].copy()
    df = df[df["duration_sec"] >= 30].copy()
    print(f"  after cap (p{quantile_cap*100:.1f} >= 30s): {len(df):,}")

    y = np.log(df["duration_sec"].astype(float).clip(lower=1.0))

    # Train / val / test by year (time-based)
    train_mask = df["year"] <= 2022
    val_mask = df["year"] == 2023
    test_mask = df["year"] >= 2024

    global_mean = float(y[train_mask].mean())
    df["route_te_log_duration"] = route_target_encode(
        df["route_key"], y, train_mask, global_mean
    )

    def train_median(series: pd.Series) -> float:
        m = float(series[train_mask].median())
        return 0.0 if np.isnan(m) else m

    df["haversine_km"] = (
        df["haversine_km"].replace([np.inf, -np.inf], np.nan).fillna(train_median(df["haversine_km"]))
    )
    for col in ["temperature", "precipitation", "wind_speed", "relative_humidity"]:
        df[col] = df[col].replace([np.inf, -np.inf], np.nan).fillna(train_median(df[col]))

    X, _ = build_design_matrix(df)

    numeric_features = [
        "haversine_km",
        "route_te_log_duration",
        "temperature",
        "precipitation",
        "wind_speed",
        "relative_humidity",
        "is_weekend",
        "is_public_holiday",
    ]
    categorical_features = ["time_of_day_bucket", "month", "year"]

    preprocessor = ColumnTransformer(
        [
            ("num", StandardScaler(), numeric_features),
            (
                "cat",
                OneHotEncoder(drop="first", sparse_output=False, handle_unknown="ignore"),
                categorical_features,
            ),
        ]
    )

    model = Pipeline(
        [
            ("prep", preprocessor),
            ("ridge", Ridge(alpha=ridge_alpha, random_state=42)),
        ]
    )

    X_train, y_train = X[train_mask], y[train_mask]
    X_val, y_val = X[val_mask], y[val_mask]
    X_test, y_test = X[test_mask], y[test_mask]

    print("Fitting Ridge …")
    model.fit(X_train, y_train)

    def eval_split(name: str, Xs, ys) -> dict:
        if len(Xs) == 0:
            return {"n": 0}
        pred = model.predict(Xs)
        rmse = float(np.sqrt(mean_squared_error(ys, pred)))
        r2 = float(r2_score(ys, pred))
        return {"n": int(len(Xs)), "rmse_log_duration": rmse, "r2": r2}

    metrics = {
        "train": eval_split("train", X_train, y_train),
        "val_2023": eval_split("val", X_val, y_val),
        "test_2024_plus": eval_split("test", X_test, y_test),
    }

    ridge = model.named_steps["ridge"]
    prep = model.named_steps["prep"]
    feat_names = prep.get_feature_names_out()
    coefs = {str(n): float(c) for n, c in zip(feat_names, ridge.coef_) if abs(c) > 1e-8}
    intercept = float(ridge.intercept_)

    # Aggregated duration stats for viz (full filtered df)
    grp = (
        df.groupby(["time_of_day_bucket", "is_weekend", "is_public_holiday"], observed=True)[
            "duration_sec"
        ]
        .agg(mean_sec="mean", median_sec="median", count="count")
        .reset_index()
    )
    duration_by_context = grp.to_dict(orient="records")

    out = {
        "model": "Ridge on log(duration_sec)",
        "ridge_alpha": ridge_alpha,
        "duration_quantile_cap": quantile_cap,
        "min_duration_sec": 30,
        "train_years": "year <= 2022",
        "val_year": 2023,
        "test_years": "year >= 2024",
        "route_target_encoding": "mean log(duration) per route_key on train only; unseen -> train global mean",
        "metrics": metrics,
        "intercept_log": intercept,
        "coefficients": dict(sorted(coefs.items(), key=lambda x: -abs(x[1]))[:80]),
    }

    out_dir = root / OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, str(root / "data-pipeline"))
    from execution_utils import write_with_execution_metadata

    write_with_execution_metadata(out_dir / SUMMARY_JSON, out, t0)

    for row in duration_by_context:
        row["is_weekend"] = bool(row["is_weekend"])
        row["is_public_holiday"] = bool(row["is_public_holiday"])

    write_with_execution_metadata(
        out_dir / DURATION_BY_CONTEXT_JSON,
        {"duration_by_context": duration_by_context},
        t0,
    )

    print("Wrote", out_dir / SUMMARY_JSON)
    print("Wrote", out_dir / DURATION_BY_CONTEXT_JSON)
    return out


def main() -> None:
    run_regression()


if __name__ == "__main__":
    main()
