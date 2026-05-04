/**
 * Shared centroid-to-centroid OD flow math and dot animation (region-flow + visual-story hero).
 */
import type * as Leaflet from 'leaflet';
import type { IsochroneStation } from '../../data/prepared-data-types.js';
import type { RouteBinnedRow } from '../../data/prepared-data-types.js';

export const FLOW_SEP = '\u0001';

export type Granularity = 'bydel' | 'delbydel';

export interface FlowEdge {
	origin: string;
	dest: string;
	count: number;
}

export function buildStationRegionMaps(stations: IsochroneStation[]) {
	const bydel = new Map<string, string>();
	const delbydel = new Map<string, string>();
	for (const s of stations) {
		const id = String(s.id).trim();
		bydel.set(id, s.bydel?.trim() || 'Unknown');
		delbydel.set(id, s.delbydel?.trim() || 'Unknown');
	}
	return { bydel, delbydel };
}

export function centroidMaps(stations: IsochroneStation[]): {
	bydel: Map<string, { lat: number; lon: number }>;
	delbydel: Map<string, { lat: number; lon: number }>;
} {
	const accBydel = new Map<string, { slat: number; slon: number; n: number }>();
	const accDel = new Map<string, { slat: number; slon: number; n: number }>();
	for (const s of stations) {
		const lat = Number(s.lat);
		const lon = Number(s.lon);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		const b = s.bydel?.trim() || 'Unknown';
		const d = s.delbydel?.trim() || 'Unknown';
		for (const [key, map] of [
			[b, accBydel],
			[d, accDel],
		] as const) {
			const cur = map.get(key) ?? { slat: 0, slon: 0, n: 0 };
			cur.slat += lat;
			cur.slon += lon;
			cur.n += 1;
			map.set(key, cur);
		}
	}
	const finish = (m: Map<string, { slat: number; slon: number; n: number }>) => {
		const out = new Map<string, { lat: number; lon: number }>();
		for (const [k, v] of m) {
			if (v.n > 0) out.set(k, { lat: v.slat / v.n, lon: v.slon / v.n });
		}
		return out;
	};
	return { bydel: finish(accBydel), delbydel: finish(accDel) };
}

export function buildDateIndex(rows: RouteBinnedRow[]): Map<string, RouteBinnedRow[]> {
	const m = new Map<string, RouteBinnedRow[]>();
	for (const r of rows) {
		const p = String(r.period ?? '').trim();
		if (!p) continue;
		if (!m.has(p)) m.set(p, []);
		m.get(p)!.push(r);
	}
	return m;
}

/** Inclusive hour span; if start > end, wraps past midnight (still same calendar day in data). */
export function hourInInclusiveSpan(h: number, start: number, end: number): boolean {
	const hi = Number(h);
	if (start <= end) return hi >= start && hi <= end;
	return hi >= start || hi <= end;
}

/** Number of clock hours covered (inclusive), for averaging trip rate. */
export function countHoursInSpan(start: number, end: number): number {
	if (start <= end) return end - start + 1;
	return 24 - start + (end + 1);
}

export function clampHour(raw: number): number {
	if (!Number.isFinite(raw)) return 0;
	return Math.max(0, Math.min(23, Math.round(raw)));
}

export function formatHourSpanLabel(start: number, end: number): string {
	if (start <= end) return `${start}:00–${end}:59`;
	return `${start}:00–23:59, 0:00–${end}:59`;
}

export function aggregateFlows(
	dayRows: RouteBinnedRow[] | undefined,
	hourStart: number,
	hourEnd: number,
	stationBydel: Map<string, string>,
	stationDelbydel: Map<string, string>,
	g: Granularity,
	crossRegionOnly: boolean,
	minCount: number,
	topN: number,
): FlowEdge[] {
	if (!dayRows?.length) return [];
	const region = (stationId: string) =>
		g === 'bydel'
			? stationBydel.get(String(stationId).trim()) ?? 'Unknown'
			: stationDelbydel.get(String(stationId).trim()) ?? 'Unknown';

	const counts = new Map<string, number>();
	for (const r of dayRows) {
		const h = Number(r.hour);
		if (!hourInInclusiveSpan(h, hourStart, hourEnd)) continue;
		const key = String(r.route_key ?? '');
		const pipe = key.indexOf('|');
		if (pipe <= 0) continue;
		const o = key.slice(0, pipe).trim();
		const d = key.slice(pipe + 1).trim();
		if (!o || !d) continue;
		const ro = region(o);
		const rd = region(d);
		if (crossRegionOnly && ro === rd) continue;
		const k = `${ro}${FLOW_SEP}${rd}`;
		const c = Number(r.count) || 0;
		if (c <= 0) continue;
		counts.set(k, (counts.get(k) ?? 0) + c);
	}

	const edges: FlowEdge[] = [];
	for (const [k, count] of counts) {
		if (count < minCount) continue;
		const sep = k.indexOf(FLOW_SEP);
		edges.push({ origin: k.slice(0, sep), dest: k.slice(sep + FLOW_SEP.length), count });
	}
	edges.sort((a, b) => b.count - a.count);
	return edges.slice(0, topN);
}

export function netBalanceForHourSpan(
	dayRows: RouteBinnedRow[] | undefined,
	hourStart: number,
	hourEnd: number,
	stationBydel: Map<string, string>,
	stationDelbydel: Map<string, string>,
	g: Granularity,
): Map<string, number> {
	const net = new Map<string, number>();
	if (!dayRows?.length) return net;
	const region = (stationId: string) =>
		g === 'bydel'
			? stationBydel.get(String(stationId).trim()) ?? 'Unknown'
			: stationDelbydel.get(String(stationId).trim()) ?? 'Unknown';

	for (const r of dayRows) {
		const h = Number(r.hour);
		if (!hourInInclusiveSpan(h, hourStart, hourEnd)) continue;
		const key = String(r.route_key ?? '');
		const pipe = key.indexOf('|');
		if (pipe <= 0) continue;
		const o = key.slice(0, pipe).trim();
		const d = key.slice(pipe + 1).trim();
		const c = Number(r.count) || 0;
		if (c <= 0) continue;
		const ro = region(o);
		const rd = region(d);
		net.set(ro, (net.get(ro) ?? 0) + c);
		net.set(rd, (net.get(rd) ?? 0) - c);
	}
	return net;
}

/** Straight segment for OD lines (two endpoints only). */
export function straightLatLngs(a: [number, number], b: [number, number]): [number, number][] {
	return [a, b];
}

/** Great-circle distance between two WGS84 points (km). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

/** Visual radius (px) for every bike dot — identical for all flows. */
export const DOT_RADIUS_PX = 3;

/** Typical bike speed for travel-time scaling (km/h). */
const BIKE_SPEED_KMH = 13;

const TIME_COMPRESSION = 110;
const BIKES_PER_HOUR_REF = 6;

export function cycleMsFromTripsPerHourAndDistance(tripsPerHour: number, D_km: number): number {
	const rate = Math.max(tripsPerHour, 0.001);
	const dist = Math.max(D_km, 0.015);
	const travelMs = (dist / BIKE_SPEED_KMH) * 3600 * 1000;
	const scaled = (travelMs / TIME_COMPRESSION) * (BIKES_PER_HOUR_REF / rate);
	return Math.round(Math.min(52000, Math.max(1400, scaled)));
}

/** Max circle markers per link (performance). */
export const MAX_BIKE_DOTS_PER_EDGE = 28;

function minUniformTripsPerDot(tMaxTrips: number, maxDots: number): number {
	if (tMaxTrips <= 0) return 1;
	return Math.max(1, Math.ceil(tMaxTrips / maxDots));
}

export function computeUniformTripsPerDot(
	edges: FlowEdge[],
	maxDots: number,
	mode: 'auto' | 'custom',
	customKRaw: number,
): { K: number; kRequested: number | null; bumped: boolean } {
	if (!edges.length) return { K: 1, kRequested: null, bumped: false };
	const tMax = Math.max(...edges.map((e) => e.count));
	const kMin = minUniformTripsPerDot(tMax, maxDots);
	if (mode !== 'custom') {
		return { K: kMin, kRequested: null, bumped: false };
	}
	const kReq = Math.max(1, Math.round(Number(customKRaw)) || 1);
	const K = Math.max(kReq, kMin);
	return { K, kRequested: kReq, bumped: K > kReq };
}

export function nDotsUniform(trips: number, K: number, maxDots: number): number {
	const T = Math.max(0, Math.floor(trips));
	if (T <= 0) return 1;
	return Math.min(maxDots, Math.max(1, Math.ceil(T / K)));
}

export interface DotEdgeAnimSpec {
	lat1: number;
	lon1: number;
	lat2: number;
	lon2: number;
	cycleMs: number;
	markers: Leaflet.CircleMarker[];
}

/** Starts rAF loop; returns `stop` to cancel. No-op if specs empty. */
export function startCentroidDotAnimation(specs: DotEdgeAnimSpec[]): () => void {
	let raf: number | null = null;
	const stop = (): void => {
		if (raf != null) {
			cancelAnimationFrame(raf);
			raf = null;
		}
	};
	if (!specs.length) return stop;
	const tick = (): void => {
		const now = performance.now();
		for (const s of specs) {
			const phase = (now % s.cycleMs) / s.cycleMs;
			const n = s.markers.length;
			for (let i = 0; i < n; i++) {
				const u = (phase + i / n) % 1;
				const lat = s.lat1 + u * (s.lat2 - s.lat1);
				const lon = s.lon1 + u * (s.lon2 - s.lon1);
				s.markers[i]!.setLatLng([lat, lon]);
			}
		}
		raf = requestAnimationFrame(tick);
	};
	raf = requestAnimationFrame(tick);
	return stop;
}
