/**
 * Oslo Bysykkel real-time GBFS client.
 *
 * Reference: https://oslobysykkel.no/en/open-data/realtime
 * Spec: https://github.com/MobilityData/gbfs
 *
 * Three feeds are exposed: system_information, station_information,
 * station_status. All three return `{ last_updated, ttl, data }` envelopes.
 *
 * Data is fetched directly from the browser; urbansharing.com serves these
 * endpoints with permissive CORS so no proxy is needed. The recommended
 * `Client-Identifier` header is sent (note: triggers a CORS preflight).
 */

const GBFS_BASE = 'https://gbfs.urbansharing.com/oslobysykkel.no';
const CLIENT_IDENTIFIER = 'inf252-oslo-bysykkel-live';

/** Generic GBFS envelope. */
export interface GbfsEnvelope<T> {
  last_updated: number;
  ttl: number;
  data: T;
}

export interface GbfsSystemInformation {
  system_id: string;
  language: string;
  name: string;
  operator?: string;
  timezone: string;
  phone_number?: string;
  email?: string;
}

export interface GbfsStationInfo {
  station_id: string;
  name: string;
  address?: string;
  lat: number;
  lon: number;
  capacity: number;
}

/**
 * Per GBFS 2.x the is_* fields are booleans; the 1.x feeds in older docs use
 * 0/1 integers. Accept both shapes — `truthy()` below normalizes them.
 */
export interface GbfsStationStatus {
  station_id: string;
  is_installed: boolean | 0 | 1;
  is_renting: boolean | 0 | 1;
  is_returning: boolean | 0 | 1;
  num_bikes_available: number;
  num_docks_available: number;
  last_reported: number;
}

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

export type GbfsFeedName =
  | 'system_information'
  | 'station_information'
  | 'station_status';

/** Result of one GBFS feed fetch. */
export interface GbfsFetchResult<T> {
  data: T;
  /** Server-reported last_updated (Unix seconds). */
  lastUpdated: number;
  /** Server-recommended re-fetch interval (seconds). */
  ttl: number;
}

/**
 * Fetch a single GBFS feed by name. Throws on network / HTTP errors.
 */
export async function fetchGbfs<T>(
  name: GbfsFeedName,
  init?: RequestInit
): Promise<GbfsFetchResult<T>> {
  const url = `${GBFS_BASE}/${name}.json`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Client-Identifier': CLIENT_IDENTIFIER,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GBFS ${name} failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as GbfsEnvelope<T>;
  if (!json || typeof json !== 'object' || !('data' in json)) {
    throw new Error(`GBFS ${name}: malformed envelope`);
  }
  return {
    data: json.data,
    lastUpdated: Number(json.last_updated) || 0,
    ttl: Number(json.ttl) || 10,
  };
}

export interface LiveAggregate {
  totalStations: number;
  totalCapacity: number;
  totalBikesAvailable: number;
  totalDocksAvailable: number;
  /**
   * Σ capacity − Σ num_bikes_available − Σ num_docks_available.
   *
   * Per GBFS spec, num_docks_available counts empty *functional* docks, so
   * this difference is dock slots that are neither holding a bike nor
   * reporting as a free dock — typically broken / out-of-service docks. It
   * is an UPPER BOUND on bikes currently in transit, not an exact count.
   */
  slotsUnaccountedFor: number;
  activeStationsRenting: number;
  activeStationsReturning: number;
  installedStations: number;
  /** Max of the two feeds' last_updated (Unix seconds). */
  lastUpdated: number;
}

/**
 * Aggregate live counts from station_information + station_status.
 *
 * Stations present in station_information but missing from station_status are
 * counted toward totalStations / totalCapacity but contribute zero bikes/docks.
 */
export function aggregateLive(
  stationInfo: { stations: GbfsStationInfo[] },
  stationStatus: { stations: GbfsStationStatus[] },
  infoLastUpdated: number,
  statusLastUpdated: number
): LiveAggregate {
  const statusById = new Map<string, GbfsStationStatus>();
  for (const s of stationStatus.stations) {
    statusById.set(String(s.station_id), s);
  }

  let totalCapacity = 0;
  let totalBikesAvailable = 0;
  let totalDocksAvailable = 0;
  let activeStationsRenting = 0;
  let activeStationsReturning = 0;
  let installedStations = 0;

  for (const info of stationInfo.stations) {
    totalCapacity += Number(info.capacity) || 0;
    const st = statusById.get(String(info.station_id));
    if (!st) continue;
    totalBikesAvailable += Number(st.num_bikes_available) || 0;
    totalDocksAvailable += Number(st.num_docks_available) || 0;
    if (truthy(st.is_renting)) activeStationsRenting += 1;
    if (truthy(st.is_returning)) activeStationsReturning += 1;
    if (truthy(st.is_installed)) installedStations += 1;
  }

  return {
    totalStations: stationInfo.stations.length,
    totalCapacity,
    totalBikesAvailable,
    totalDocksAvailable,
    slotsUnaccountedFor:
      totalCapacity - totalBikesAvailable - totalDocksAvailable,
    activeStationsRenting,
    activeStationsReturning,
    installedStations,
    lastUpdated: Math.max(infoLastUpdated, statusLastUpdated),
  };
}
