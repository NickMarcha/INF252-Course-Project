# Weather data (Frost API)

This document describes how historical weather for Oslo is fetched from the Frost API, cached, and used in the project.

## Overview

- **Source:** [Frost API](https://frost.met.no/) (MET Norway historical observations).
- **Location:** Oslo Blindern (source ID `SN18700`).
- **Range:** April 2019 – January 2026 (same as trip data).
- **Elements:** Daily aggregates: `mean(air_temperature P1D)`, `sum(precipitation_amount P1D)`, `mean(wind_speed P1D)`, `mean(relative_humidity P1D)`.
- **Cache:** One file per month in `weather-cache/{source_id}_{YYYY}-{MM}.json`. Re-runs only fetch months not yet cached.

## Setup

1. **Credentials** – Register at [frost.met.no/auth/requestCredentials.html](https://frost.met.no/auth/requestCredentials.html) (email only) and receive a client ID.
2. **`.env`** (project root) – Add:
   - `FROST_API_CLIENT_ID=<your client ID>`
   - `FROST_USER_AGENT=INF252-Course-Project/1.0 (your.email@example.com)` — use your real email; MET requires a unique User-Agent with contact info or requests return 403.

## Data flow

1. **Notebook** – `data-pipeline/notebooks/frost_weather_fetch.ipynb` loads `.env`, then calls `frost_fetch.fetch_weather_range(2019, 4, 2026, 1, ...)`.
2. **Module** – `data-pipeline/frost_fetch.py` checks `weather-cache/` for each month; if the file exists, it skips the API. Otherwise it requests that month from Frost and writes the response to the cache.
3. **Cache** – Stored in `weather-cache/` (gitignored). Each file contains `source_id`, `year`, `month`, `referencetime`, `fetched_at`, and the full Frost API `response` (including `data` with observations).

## Components

### frost_fetch.py

Location: `data-pipeline/frost_fetch.py`

- **Purpose:** Fetch Frost observations with cache-before-fetch and optional force re-fetch.
- **API:** `fetch_weather_month(year, month, client_id, cache_dir, ...)` for one month; `fetch_weather_range(start_year, start_month, end_year, end_month, client_id, cache_dir, ...)` for a range (one request per month).
- **Cache path:** `weather-cache/{source_id}_{YYYY}-{MM}.json`.
- **Force fetch:** Set `force_fetch=True` or `FORCE_WEATHER_FETCH=1` to ignore cache.
- **Source:** Default Oslo Blindern `SN18700`; override with `FROST_SOURCE_ID` in env or the `source_id` argument.

### frost_weather_fetch.ipynb

Location: `data-pipeline/notebooks/frost_weather_fetch.ipynb`

- **Setup cell:** Resolves project root, loads `.env` from project root (so it works when run from `data-pipeline/notebooks/`), checks `FROST_API_CLIENT_ID` and `FROST_USER_AGENT`.
- **Minimal request cell:** Optional debug request (one element, 3 days) to verify auth; if this returns 200 but the full fetch returns 403, the issue is with request parameters.
- **Single-month test:** Fetches one month (e.g. 2024-02) to confirm before running the full range.
- **Fetch all months:** Calls `fetch_weather_range(2019, 4, 2026, 1, ...)`; only uncached months trigger API calls.

## Cache format

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

### Frontend (Weather page)

After running the Frost notebook, `npm run prepare:data` runs `scripts/export-weather-to-prepared.js` (no-op if `weather-cache/` is missing), then syncs `prepared-data/weather_oslo.json` to the frontend. The **Weather** page shows a time-series chart of temperature and precipitation for Oslo Blindern (SN18700).

## Notes

- Frost returns 403 if the User-Agent is missing or generic; the project requires `FROST_USER_AGENT` with contact info in `.env`.
- Request parameters that triggered 403 in practice were removed (e.g. multiple `timeoffsets`, `levels`, `qualities`); the working request uses date-only `referencetime` and daily aggregate element IDs.
- `weather-cache/` is listed in `.gitignore`; do not commit it unless you choose to track cached data.
