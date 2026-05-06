# Weather data (Frost API)

This document describes how historical weather for Oslo is fetched from the Frost API, cached, and used in the project.

## overview

- Source: [Frost API](https://frost.met.no/) from MET Norway historical observations.
- Location: Oslo Blindern (`SN18700`).
- Range: April 2019 to January 2026 (same range as trip data).
- Elements: Daily aggregates for air temperature, precipitation, wind speed, and relative humidity.
- Cache: One file per month in `weather-cache/{source_id}_{YYYY}-{MM}.json`. Re-runs fetch only missing months.

## setup

1. Register at [frost.met.no/auth/requestCredentials.html](https://frost.met.no/auth/requestCredentials.html) and get a client ID.
2. In project root `.env`, add:
   - `FROST_API_CLIENT_ID=<your client ID>`
   - `FROST_USER_AGENT=INF252-Course-Project/1.0 (your.email@example.com)` (use a real email; MET rejects generic or missing user agents).

## data flow

1. `data-pipeline/notebooks/frost_weather_fetch.ipynb` loads `.env` and calls `frost_fetch.fetch_weather_range(2019, 4, 2026, 1, ...)`.
2. `data-pipeline/frost_fetch.py` checks `weather-cache/` for each month. If a file exists, it skips the API request.
3. The cache lives in `weather-cache/` (gitignored). Each file stores metadata and the full API response payload.

## components

### frost_fetch.py

Location: `data-pipeline/frost_fetch.py`

This module fetches Frost observations with a cache-first pattern and optional force refetch.
It exposes:
- `fetch_weather_month(year, month, client_id, cache_dir, ...)`
- `fetch_weather_range(start_year, start_month, end_year, end_month, client_id, cache_dir, ...)`

Cache files are written to `weather-cache/{source_id}_{YYYY}-{MM}.json`.
You can bypass cache with `force_fetch=True` or `FORCE_WEATHER_FETCH=1`.
Default source is Oslo Blindern (`SN18700`), and you can override it with `FROST_SOURCE_ID` or `source_id`.

### frost_weather_fetch.ipynb

Location: `data-pipeline/notebooks/frost_weather_fetch.ipynb`

The setup cell resolves project root, loads `.env`, and checks `FROST_API_CLIENT_ID` and `FROST_USER_AGENT`.
The notebook also has:
- A small debug request (one element, three days) to verify auth
- A single-month test step
- A full-range fetch step (`fetch_weather_range(2019, 4, 2026, 1, ...)`)

## cache format

Each file in `weather-cache/` looks like:

```json
{
  "source_id": "SN18700",
  "year": 2024,
  "month": 2,
  "referencetime": "2024-02-01/2024-03-01",
  "fetched_at": "2026-03-17T...",
  "response": {
    "data": [ { "sourceId": "...", "referenceTime": "...", "observations": [ ... ] }, ... ],
    ...
  }
}
```

Downstream code can read these files and join weather to trip data by date (e.g. `referenceTime` or the date portion of it).

### frontend (weather page)

After running the Frost notebook, `npm run prepare:data` runs `scripts/export-weather-to-prepared.js` (no-op if `weather-cache/` is missing), then syncs `prepared-data/weather_oslo.json` to the frontend. The **Weather** page shows a time-series chart of temperature and precipitation for Oslo Blindern (SN18700).

## troubleshooting

- If Frost returns 403, check `FROST_USER_AGENT` and `FROST_API_CLIENT_ID` in root `.env`.
- If no new files are written to `weather-cache/`, set `FORCE_WEATHER_FETCH=1` and rerun fetch cells.
- If weather is missing in the frontend, run `npm run prepare:data` after notebook fetch finishes.

## notes

- Frost returns 403 if the User-Agent is missing or generic; the project requires `FROST_USER_AGENT` with contact info in `.env`.
- Request parameters that triggered 403 in practice were removed (e.g. multiple `timeoffsets`, `levels`, `qualities`); the working request uses date-only `referencetime` and daily aggregate element IDs.
- `weather-cache/` is listed in `.gitignore`; do not commit it unless you choose to track cached data.

## see also

- [`README.md`](../README.md)
- [`Routes.md`](./Routes.md)
- [`DEPLOYMENT.md`](../DEPLOYMENT.md)
- [`README.md` in docs](./README.md)
