#!/usr/bin/env python3
"""Run stations preparation with region assignment. Generates stations.json, bydeler.geojson, delbydeler.geojson."""
import json
import sys
import time
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root / "data-pipeline"))

import pandas as pd
from region_utils import assign_regions, load_geojson_wgs84

raw_dir = project_root / "raw-data"
prepared_dir = project_root / "prepared-data"
data_pipeline_dir = project_root / "data-pipeline"

records = []
for year_dir in sorted(raw_dir.iterdir()):
    if not year_dir.is_dir():
        continue
    year = int(year_dir.name)
    for json_path in sorted(year_dir.glob("*.json")):
        month = int(json_path.stem)
        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)
        trips = data if isinstance(data, list) else data.get("data", data.get("trips", []))
        for t in trips:
            records.append((year, month, t))

rows = []
for year, month, t in records:
    rows.append({
        "year": year, "month": month,
        "start_station_id": str(t.get("start_station_id")),
        "start_station_name": t.get("start_station_name"),
        "end_station_id": str(t.get("end_station_id")),
        "end_station_name": t.get("end_station_name"),
        "start_lat": t.get("start_station_latitude"),
        "start_lon": t.get("start_station_longitude"),
        "end_lat": t.get("end_station_latitude"),
        "end_lon": t.get("end_station_longitude"),
    })

df = pd.DataFrame(rows)
df = df.dropna(subset=["start_lat", "start_lon", "end_lat", "end_lon"])
print(f"Loaded {len(df)} trips")

stations_start = df.groupby("start_station_id").agg({
    "start_station_name": "first", "start_lat": "first", "start_lon": "first",
}).rename(columns={"start_station_name": "name", "start_lat": "lat", "start_lon": "lon"})
stations_start["trips_as_origin"] = df.groupby("start_station_id").size()
stations_end = df.groupby("end_station_id").agg({
    "end_station_name": "first", "end_lat": "first", "end_lon": "first",
}).rename(columns={"end_station_name": "name", "end_lat": "lat", "end_lon": "lon"})
stations_end["trips_as_dest"] = df.groupby("end_station_id").size()

all_ids = set(stations_start.index) | set(stations_end.index)
stations = []
for sid in sorted(all_ids, key=lambda x: (len(str(x)), x)):
    trips_origin = int(stations_start.loc[sid]["trips_as_origin"]) if sid in stations_start.index else 0
    trips_dest = int(stations_end.loc[sid]["trips_as_dest"]) if sid in stations_end.index else 0
    row = stations_start.loc[sid] if sid in stations_start.index else stations_end.loc[sid]
    stations.append({
        "id": sid, "name": str(row["name"]), "lat": float(row["lat"]), "lon": float(row["lon"]),
        "trips_as_origin": trips_origin, "trips_as_dest": trips_dest,
        "total_trips": trips_origin + trips_dest,
    })
print(f"Stations: {len(stations)}")

bydeler_path = data_pipeline_dir / "Bydeler_-5729248191137049298.geojson"
delbydeler_path = data_pipeline_dir / "Delbydeler_3997065518127330394.geojson"
stations = assign_regions(stations, bydeler_path, delbydeler_path)

for name, p in [("bydeler", bydeler_path), ("delbydeler", delbydeler_path)]:
    geojson_wgs84 = load_geojson_wgs84(p)
    out = prepared_dir / (name + ".geojson")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(geojson_wgs84, f, ensure_ascii=False)
    print(f"Wrote {out.name}")

meta = {
    "last_execution": {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")},
    "data": {"stations": stations},
}
with open(prepared_dir / "stations.json", "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)
print("Wrote stations.json")
