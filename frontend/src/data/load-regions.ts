/**
 * Load GeoJSON region overlays (bydeler, delbydeler) for map display.
 */

const base = import.meta.env.BASE_URL ?? '/';

export interface GeoJSONFeature {
  type: 'Feature';
  id?: number | string;
  geometry: { type: string; coordinates: unknown };
  properties?: Record<string, unknown>;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export async function loadBydelerGeoJSON(): Promise<GeoJSONFeatureCollection> {
  const url = `${base}prepared-data/bydeler.geojson`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load bydeler.geojson: ${res.status}`);
  }
  return res.json() as Promise<GeoJSONFeatureCollection>;
}

export async function loadDelbydelerGeoJSON(): Promise<GeoJSONFeatureCollection> {
  const url = `${base}prepared-data/delbydeler.geojson`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load delbydeler.geojson: ${res.status}`);
  }
  return res.json() as Promise<GeoJSONFeatureCollection>;
}
