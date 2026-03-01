/**
 * Load prepared data from /prepared-data/ (synced from project root).
 * Types align with Python pipeline output (write_with_execution_metadata).
 */

import { tableFromIPC } from 'apache-arrow';
import initWasm, { readParquet } from 'parquet-wasm';
import type { PreparedDataWithMetadata } from './prepared-data-types.js';

const base = import.meta.env.BASE_URL ?? '/';

// WASM file copied to public/ so it's served with correct MIME type (avoids Vite dep optimization issues)
const wasmUrl = `${base}parquet_wasm_bg.wasm`;

let parquetWasmInitialized = false;

async function ensureParquetWasm() {
  if (!parquetWasmInitialized) {
    await initWasm({ module_or_path: wasmUrl });
    parquetWasmInitialized = true;
  }
}

export async function loadPreparedData<T>(
  filename: string
): Promise<PreparedDataWithMetadata<T>> {
  const url = `${base}prepared-data/${filename}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${filename}: ${res.status}`);
  }
  const json = (await res.json()) as PreparedDataWithMetadata<T>;
  if (!json || typeof json !== 'object') {
    throw new Error(`Invalid prepared data: ${filename}`);
  }
  return json;
}

/**
 * Load a Parquet file from /prepared-data/ and return rows as plain objects.
 * Uses parquet-wasm + apache-arrow. Path is relative to prepared-data/ (e.g. "routes/route_pair_counts.parquet").
 */
export async function loadParquetData<T extends Record<string, unknown>>(
  pathFromPreparedData: string
): Promise<T[]> {
  await ensureParquetWasm();
  const url = `${base}prepared-data/${pathFromPreparedData}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${pathFromPreparedData}: ${res.status}`);
  }
  const buffer = new Uint8Array(await res.arrayBuffer());
  const wasmTable = readParquet(buffer);
  const arrowTable = tableFromIPC(wasmTable.intoIPCStream());
  return arrowTable.toArray() as T[];
}

/** Isochrone station row from Parquet */
interface IsochroneStationRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Isochrone polygon row from Parquet */
interface IsochronePolygonRow {
  station_id: string;
  time_band_min: number;
  coordinates: string;
}

/**
 * Load isochrone data from Parquet (isochrones/stations.parquet, polygons.parquet, isochrones_meta.json).
 */
export async function loadIsochronesData(): Promise<{
  stations: Array<{ id: string; name: string; lat: number; lon: number }>;
  time_bands_min: number[];
  isochrones: Record<string, Record<string, { type: 'Polygon'; coordinates: number[][][] }>>;
}> {
  const [stationsRows, polygonRows, metaRes] = await Promise.all([
    loadParquetData<IsochroneStationRow>('isochrones/stations.parquet'),
    loadParquetData<IsochronePolygonRow>('isochrones/polygons.parquet'),
    fetch(`${base}prepared-data/isochrones/isochrones_meta.json`),
  ]);
  if (!metaRes.ok) {
    throw new Error(`Failed to load isochrones meta: ${metaRes.status}`);
  }
  const meta = (await metaRes.json()) as { data?: { time_bands_min?: number[] }; time_bands_min?: number[] };
  const time_bands_min = meta.data?.time_bands_min ?? meta.time_bands_min ?? [5, 10, 15, 20];

  const stations = stationsRows.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon }));
  const isochrones: Record<string, Record<string, { type: 'Polygon'; coordinates: number[][][] }>> = {};
  for (const row of polygonRows) {
    if (!isochrones[row.station_id]) isochrones[row.station_id] = {};
    const poly = JSON.parse(row.coordinates) as { type: 'Polygon'; coordinates: number[][][] };
    isochrones[row.station_id][String(row.time_band_min)] = poly;
  }
  return { stations, time_bands_min, isochrones };
}
