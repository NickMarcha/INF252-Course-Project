/**
 * Regional OD flow: aggregate route_by_day_YYYY.parquet with stations.json
 * (bydel / delbydel), map + matrix views.
 */
import * as d3 from 'd3';
import { loadParquetData, loadPreparedData } from '../../data/load-prepared-data.js';
import { loadBydelerGeoJSON, loadDelbydelerGeoJSON } from '../../data/load-regions.js';
import type { IsochroneStation } from '../../data/prepared-data-types.js';
import type { RouteBinnedRow } from '../../data/prepared-data-types.js';

const OSLO_CENTER: [number, number] = [59.92, 10.75];
const DEFAULT_ZOOM = 12;
const FLOW_SEP = '\u0001';

const YEARS_AVAILABLE = ['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'] as const;

type Granularity = 'bydel' | 'delbydel';

interface FlowEdge {
	origin: string;
	dest: string;
	count: number;
}

function escHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function buildStationRegionMaps(stations: IsochroneStation[]) {
	const bydel = new Map<string, string>();
	const delbydel = new Map<string, string>();
	for (const s of stations) {
		const id = String(s.id).trim();
		bydel.set(id, s.bydel?.trim() || 'Unknown');
		delbydel.set(id, s.delbydel?.trim() || 'Unknown');
	}
	return { bydel, delbydel };
}

function centroidMaps(
	stations: IsochroneStation[],
): {
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

function buildDateIndex(rows: RouteBinnedRow[]): Map<string, RouteBinnedRow[]> {
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
function hourInInclusiveSpan(h: number, start: number, end: number): boolean {
	const hi = Number(h);
	if (start <= end) return hi >= start && hi <= end;
	return hi >= start || hi <= end;
}

/** Number of clock hours covered (inclusive), for averaging trip rate. */
function countHoursInSpan(start: number, end: number): number {
	if (start <= end) return end - start + 1;
	return 24 - start + (end + 1);
}

function clampHour(raw: number): number {
	if (!Number.isFinite(raw)) return 0;
	return Math.max(0, Math.min(23, Math.round(raw)));
}

function formatHourSpanLabel(start: number, end: number): string {
	if (start <= end) return `${start}:00–${end}:59`;
	return `${start}:00–23:59, 0:00–${end}:59`;
}

function aggregateFlows(
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

function netBalanceForHourSpan(
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
function straightLatLngs(a: [number, number], b: [number, number]): [number, number][] {
	return [a, b];
}

/** Great-circle distance between two WGS84 points (km). */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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
const DOT_RADIUS_PX = 3;

/** Typical bike speed for travel-time scaling (km/h). */
const BIKE_SPEED_KMH = 13;

/**
 * Wall-clock ms for one dot to travel the full segment (one “bike lap”).
 * Uses: (segment length / bike speed) as baseline travel time, compressed for viewing,
 * then scales inversely with mean trip rate (trips per clock hour) on this OD.
 */
const TIME_COMPRESSION = 110;
const BIKES_PER_HOUR_REF = 6;

function cycleMsFromTripsPerHourAndDistance(tripsPerHour: number, D_km: number): number {
	const rate = Math.max(tripsPerHour, 0.001);
	const dist = Math.max(D_km, 0.015);
	const travelMs = (dist / BIKE_SPEED_KMH) * 3600 * 1000;
	const scaled = (travelMs / TIME_COMPRESSION) * (BIKES_PER_HOUR_REF / rate);
	return Math.round(Math.min(52000, Math.max(1400, scaled)));
}

/** Max circle markers per link (performance). */
const MAX_BIKE_DOTS_PER_EDGE = 28;

/** Smallest integer trips-per-dot so even the busiest visible link needs at most maxDots markers. */
function minUniformTripsPerDot(tMaxTrips: number, maxDots: number): number {
	if (tMaxTrips <= 0) return 1;
	return Math.max(1, Math.ceil(tMaxTrips / maxDots));
}

/**
 * One global trips-per-dot K for all visible links (fair comparison).
 * Auto: K = minimum that respects the dot cap on the busiest link.
 * Custom: K = max(user value, that minimum) so the cap is never violated.
 */
function computeUniformTripsPerDot(
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

/** Dot count for this link given global K (same K for every link). */
function nDotsUniform(trips: number, K: number, maxDots: number): number {
	const T = Math.max(0, Math.floor(trips));
	if (T <= 0) return 1;
	return Math.min(maxDots, Math.max(1, Math.ceil(T / K)));
}

export async function initRegionFlowPage(): Promise<void> {
	const statusEl = document.getElementById('rf-status');
	const mapEl = document.getElementById('rf-map');
	const dateInput = document.getElementById('rf-date') as HTMLInputElement | null;
	const hourStartEl = document.getElementById('rf-hour-start') as HTMLInputElement | null;
	const hourEndEl = document.getElementById('rf-hour-end') as HTMLInputElement | null;
	const hourLabel = document.getElementById('rf-hour-label');
	const playBtn = document.getElementById('rf-play') as HTMLButtonElement | null;
	const granBydel = document.getElementById('rf-gran-bydel') as HTMLInputElement | null;
	const granDel = document.getElementById('rf-gran-delbydel') as HTMLInputElement | null;
	const crossOnly = document.getElementById('rf-cross-only') as HTMLInputElement | null;
	const colorRegionsEl = document.getElementById('rf-color-regions') as HTMLInputElement | null;
	const minCountEl = document.getElementById('rf-min-count') as HTMLInputElement | null;
	const topNEl = document.getElementById('rf-top-n') as HTMLInputElement | null;
	const matrixEl = document.getElementById('rf-matrix');
	const chordEl = document.getElementById('rf-chord');
	const dotLegendEl = document.getElementById('rf-dot-legend');
	const dotScaleModeEl = document.getElementById('rf-dot-scale-mode') as HTMLSelectElement | null;
	const dotTripsPerEl = document.getElementById('rf-dot-trips-per') as HTMLInputElement | null;

	if (
		!statusEl ||
		!mapEl ||
		!dateInput ||
		!hourStartEl ||
		!hourEndEl ||
		!hourLabel ||
		!playBtn ||
		!granBydel ||
		!granDel ||
		!crossOnly ||
		!colorRegionsEl ||
		!minCountEl ||
		!topNEl ||
		!matrixEl ||
		!chordEl ||
		!dotLegendEl ||
		!dotScaleModeEl ||
		!dotTripsPerEl
	) {
		return;
	}

	function syncDotScaleControls(): void {
		const custom = dotScaleModeEl.value === 'custom';
		dotTripsPerEl.disabled = !custom;
		dotTripsPerEl.classList.toggle('opacity-50', !custom);
		dotTripsPerEl.classList.toggle('cursor-not-allowed', !custom);
	}

	let stations: IsochroneStation[] = [];
	try {
		const { data } = await loadPreparedData<{ stations: IsochroneStation[] }>('stations.json');
		stations = data?.stations ?? [];
	} catch {
		statusEl.textContent = 'Could not load stations.json.';
		return;
	}
	if (!stations.length) {
		statusEl.textContent = 'No stations in stations.json.';
		return;
	}

	const { bydel: stationBydel, delbydel: stationDelbydel } = buildStationRegionMaps(stations);
	const centroids = centroidMaps(stations);

	const yearRowsCache = new Map<string, RouteBinnedRow[]>();
	const dateIndexCache = new Map<string, Map<string, RouteBinnedRow[]>>();
	let playTimer: ReturnType<typeof setInterval> | null = null;

	const L = (await import('leaflet')).default;

	const map = L.map(mapEl).setView(OSLO_CENTER, DEFAULT_ZOOM);
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
		attribution: '&copy; OpenStreetMap',
	}).addTo(map);

	map.createPane('rfRegions');
	map.getPane('rfRegions')!.style.zIndex = '300';
	map.createPane('rfFlows');
	map.getPane('rfFlows')!.style.zIndex = '450';
	map.createPane('rfDots');
	map.getPane('rfDots')!.style.zIndex = '460';

	let bydelerLayer: L.GeoJSON | null = null;
	let delbydelerLayer: L.GeoJSON | null = null;
	try {
		const [bydelerGeo, delbydelerGeo] = await Promise.all([
			loadBydelerGeoJSON(),
			loadDelbydelerGeoJSON(),
		]);
		bydelerLayer = L.geoJSON(bydelerGeo, {
			style: { fillColor: '#64748b', fillOpacity: 0.12, color: '#475569', weight: 1 },
			pane: 'rfRegions',
		}).addTo(map);
		delbydelerLayer = L.geoJSON(delbydelerGeo, {
			style: { fillColor: '#94a3b8', fillOpacity: 0.06, color: '#64748b', weight: 0.5 },
			pane: 'rfRegions',
		}).addTo(map);
		L.control.layers(
			{},
			{ Bydeler: bydelerLayer, Delbydeler: delbydelerLayer },
			{ collapsed: false },
		).addTo(map);
	} catch {
		// optional
	}

	const flowLayer = L.layerGroup().addTo(map);
	const dotLayer = L.layerGroup().addTo(map);
	const highlightLayer = L.layerGroup().addTo(map);

	let dotAnimRaf: number | null = null;
	function stopDotAnimation(): void {
		if (dotAnimRaf != null) {
			cancelAnimationFrame(dotAnimRaf);
			dotAnimRaf = null;
		}
	}

	interface DotEdgeAnim {
		lat1: number;
		lon1: number;
		lat2: number;
		lon2: number;
		cycleMs: number;
		markers: L.CircleMarker[];
	}

	function startDotAnimation(specs: DotEdgeAnim[]): void {
		stopDotAnimation();
		if (!specs.length) return;
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
			dotAnimRaf = requestAnimationFrame(tick);
		};
		dotAnimRaf = requestAnimationFrame(tick);
	}

	function getGranularity(): Granularity {
		return granDel.checked ? 'delbydel' : 'bydel';
	}

	function readHourSpan(): { start: number; end: number } {
		return {
			start: clampHour(parseInt(hourStartEl.value, 10)),
			end: clampHour(parseInt(hourEndEl.value, 10)),
		};
	}

	async function ensureYear(year: string): Promise<Map<string, RouteBinnedRow[]> | null> {
		if (!YEARS_AVAILABLE.includes(year as (typeof YEARS_AVAILABLE)[number])) {
			return null;
		}
		if (dateIndexCache.has(year)) {
			return dateIndexCache.get(year)!;
		}
		statusEl.textContent = `Loading trips for ${year}…`;
		try {
			const rows = await loadParquetData<RouteBinnedRow>(`routes/route_by_day_${year}.parquet`);
			yearRowsCache.set(year, rows);
			const idx = buildDateIndex(rows);
			dateIndexCache.set(year, idx);
			statusEl.textContent = '';
			return idx;
		} catch {
			statusEl.textContent = `No route data for ${year} (run station_trip_counts.ipynb & sync).`;
			return null;
		}
	}

	function currentDayRows(): RouteBinnedRow[] | undefined {
		const d = dateInput.value;
		const y = d.slice(0, 4);
		return dateIndexCache.get(y)?.get(d);
	}

	function renderChord(edges: FlowEdge[], g: Granularity): void {
		chordEl.innerHTML = '';
		const regionsSet = new Set<string>();
		for (const e of edges) {
			regionsSet.add(e.origin);
			regionsSet.add(e.dest);
		}
		const regions = [...regionsSet].filter((r) => r !== 'Unknown').sort();
		if (regions.length < 2) {
			chordEl.innerHTML =
				'<p class="text-sm text-slate-500 dark:text-slate-400">Not enough cross-region flows for chord.</p>';
			return;
		}
		if (regions.length > 14 || g === 'delbydel') {
			chordEl.innerHTML =
				'<p class="text-xs text-slate-500 dark:text-slate-400">Chord is shown for bydel with ≤14 districts. Use the matrix for more detail.</p>';
			return;
		}

		const n = regions.length;
		const index = new Map(regions.map((r, i) => [r, i] as const));
		const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
		for (const e of edges) {
			const i = index.get(e.origin);
			const j = index.get(e.dest);
			if (i == null || j == null) continue;
			matrix[i][j] += e.count;
		}

		const size = 380;
		const outer = Math.min(size, chordEl.clientWidth || size);
		const innerRadius = outer * 0.32;
		const outerRadius = outer * 0.38;

		const svg = d3
			.select(chordEl)
			.append('svg')
			.attr('viewBox', [-outer / 2, -outer / 2, outer, outer])
			.attr('width', outer)
			.attr('height', outer)
			.classed('text-slate-700 dark:text-slate-200', true);

		const chord = d3
			.chordDirected()
			.padAngle(0.03)
			.sortSubgroups(d3.descending)
			.sortChords(d3.descending)(matrix);

		const arc = d3
			.arc()
			.innerRadius(innerRadius)
			.outerRadius(outerRadius);

		const ribbon = d3.ribbonArrow().radius(innerRadius - 0.5).padAngle(1 / n);

		const isDark =
			typeof document !== 'undefined' &&
			document.documentElement.classList.contains('dark');
		const fill = d3.scaleOrdinal<string, string>(
			d3.schemeTableau10 as unknown as string[],
		);

		const gRoot = svg.append('g');

		const group = gRoot
			.append('g')
			.selectAll('g')
			.data(chord.groups)
			.join('g');

		group
			.append('path')
			.attr('fill', (d) => fill(String(d.index)))
			.attr('stroke', isDark ? '#334155' : '#cbd5e1')
			.attr('d', arc as unknown as (d: d3.ChordGroup) => string)
			.style('cursor', 'pointer')
			.on('mouseenter', function (_ev, d: d3.ChordGroup) {
				const name = regions[d.index];
				highlightFlow(name, null);
			})
			.on('mouseleave', () => clearHighlight());

		group
			.append('text')
			.each(function (d: d3.ChordGroup) {
				const angle = (d.startAngle + d.endAngle) / 2;
				const r = outerRadius + 8;
				d3.select(this)
					.attr('transform', `rotate(${(angle * 180) / Math.PI - 90}) translate(${r},0)`)
					.attr('text-anchor', (angle + Math.PI) % (2 * Math.PI) < Math.PI ? 'end' : 'start')
					.attr('dominant-baseline', 'middle');
			})
			.attr('font-size', 9)
			.attr('fill', 'currentColor')
			.text((d: d3.ChordGroup) => regions[d.index].slice(0, 18));

		gRoot
			.append('g')
			.attr('fill-opacity', 0.67)
			.selectAll('path')
			.data(chord)
			.join('path')
			.attr('fill', (d) => fill(String(d.source.index)))
			.attr('d', ribbon as unknown as (d: d3.Chord) => string)
			.style('mix-blend-mode', 'multiply')
			.style('cursor', 'pointer')
			.on('mouseenter', function (_ev, d: d3.Chord) {
				const o = regions[d.source.index];
				const dest = regions[d.target.index];
				highlightFlow(o, dest);
			})
			.on('mouseleave', () => clearHighlight());
	}

	function renderMatrix(edges: FlowEdge[]): void {
		matrixEl.innerHTML = '';
		if (!edges.length) {
			matrixEl.innerHTML =
				'<p class="text-sm text-slate-500 dark:text-slate-400">No flows for this hour / filters.</p>';
			return;
		}

		const origins = [...new Set(edges.map((e) => e.origin))].sort();
		const dests = [...new Set(edges.map((e) => e.dest))].sort();
		const lookup = new Map<string, number>();
		for (const e of edges) {
			lookup.set(`${e.origin}${FLOW_SEP}${e.dest}`, e.count);
		}
		const maxV = d3.max(edges, (e) => e.count) ?? 1;
		const color = d3.scaleSequential(d3.interpolateBlues).domain([0, maxV]);
		const isDark = document.documentElement.classList.contains('dark');

		const table = document.createElement('table');
		table.className =
			'w-full text-xs border-collapse text-slate-800 dark:text-slate-100 chart-container';
		const thead = document.createElement('thead');
		const hr = document.createElement('tr');
		const corner = document.createElement('th');
		corner.className = 'p-1 border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-800';
		corner.textContent = '→ dest';
		hr.appendChild(corner);
		for (const d of dests) {
			const th = document.createElement('th');
			th.className =
				'p-1 border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 font-normal max-w-[5rem] truncate';
			th.title = d;
			th.textContent = d.slice(0, 14) + (d.length > 14 ? '…' : '');
			hr.appendChild(th);
		}
		thead.appendChild(hr);
		table.appendChild(thead);
		const tbody = document.createElement('tbody');
		for (const o of origins) {
			const tr = document.createElement('tr');
			const th = document.createElement('th');
			th.className =
				'p-1 border border-slate-200 dark:border-slate-600 text-left font-normal align-middle max-w-[7rem] truncate';
			th.title = o;
			th.textContent = o.slice(0, 20) + (o.length > 20 ? '…' : '');
			tr.appendChild(th);
			for (const d of dests) {
				const td = document.createElement('td');
				td.className = 'p-0 border border-slate-200 dark:border-slate-600 text-center';
				const v = lookup.get(`${o}${FLOW_SEP}${d}`);
				if (v == null) {
					td.textContent = '·';
					td.className += ' text-slate-400 dark:text-slate-600';
				} else {
					td.style.backgroundColor = color(v);
					td.style.color = isDark
						? v > maxV * 0.45
							? '#f8fafc'
							: '#e2e8f0'
						: v > maxV * 0.55
							? '#fff'
							: '#0f172a';
					td.textContent = String(v);
					td.style.cursor = 'pointer';
					td.title = `${o} → ${d}: ${v}`;
					td.addEventListener('mouseenter', () => highlightFlow(o, d));
					td.addEventListener('mouseleave', () => clearHighlight());
				}
				tr.appendChild(td);
			}
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		matrixEl.appendChild(table);
	}

	function highlightFlow(origin: string | null, dest: string | null): void {
		highlightLayer.clearLayers();
		const g = getGranularity();
		const cmap = g === 'bydel' ? centroids.bydel : centroids.delbydel;
		const dayRows = currentDayRows();
		const { start: hs, end: he } = readHourSpan();
		const edges = aggregateFlows(
			dayRows,
			hs,
			he,
			stationBydel,
			stationDelbydel,
			g,
			crossOnly.checked,
			Number(minCountEl.value) || 1,
			500,
		);

		const toDraw =
			dest != null
				? edges.filter((e) => e.origin === origin && e.dest === dest)
				: origin != null
					? edges.filter((e) => e.origin === origin || e.dest === origin)
					: [];

		for (const e of toDraw) {
			const a = cmap.get(e.origin);
			const b = cmap.get(e.dest);
			if (!a || !b) continue;
			L.polyline(straightLatLngs([a.lat, a.lon], [b.lat, b.lon]), {
				color: '#f97316',
				weight: 5,
				opacity: 0.85,
				pane: 'rfFlows',
			}).addTo(highlightLayer);
		}
	}

	function clearHighlight(): void {
		highlightLayer.clearLayers();
	}

	function resetBydelerStyle(): void {
		if (!bydelerLayer) return;
		bydelerLayer.eachLayer((layer) => {
			(layer as L.Path).setStyle({
				fillColor: '#64748b',
				fillOpacity: 0.12,
				color: '#475569',
				weight: 1,
			});
		});
	}

	function styleRegionsByNet(net: Map<string, number>, g: Granularity): void {
		if (!bydelerLayer) return;
		if (g !== 'bydel') {
			resetBydelerStyle();
			return;
		}
		const maxAbs = d3.max([...net.values()], Math.abs) ?? 1;
		const color = d3
			.scaleLinear<string>()
			.domain([-maxAbs, 0, maxAbs])
			.range(['#1d4ed8', '#f1f5f9', '#ea580c']);

		bydelerLayer.eachLayer((layer) => {
			const feat = (layer as L.GeoJSON).feature;
			const name = String(feat?.properties?.BYDELSNAVN ?? '');
			const v = net.get(name) ?? 0;
			(layer as L.Path).setStyle({
				fillColor: color(v),
				fillOpacity: 0.35,
				color: '#475569',
				weight: 1,
			});
		});
	}

	function redraw(): void {
		const g = getGranularity();
		const dayRows = currentDayRows();
		const { start: hs, end: he } = readHourSpan();
		const spanHours = Math.max(1, countHoursInSpan(hs, he));
		const minCount = Number(minCountEl.value) || 1;
		const topN = Math.min(200, Math.max(10, Number(topNEl.value) || 40));

		const edges = aggregateFlows(
			dayRows,
			hs,
			he,
			stationBydel,
			stationDelbydel,
			g,
			crossOnly.checked,
			minCount,
			topN,
		);

		stopDotAnimation();
		flowLayer.clearLayers();
		dotLayer.clearLayers();
		clearHighlight();

		const cmap = g === 'bydel' ? centroids.bydel : centroids.delbydel;
		const maxC = edges[0]?.count ?? 1;

		const scaleMode = dotScaleModeEl.value === 'custom' ? 'custom' : 'auto';
		const { K, kRequested, bumped } = computeUniformTripsPerDot(
			edges,
			MAX_BIKE_DOTS_PER_EDGE,
			scaleMode,
			Number(dotTripsPerEl.value),
		);

		const dotSpecs: DotEdgeAnim[] = [];

		for (const e of edges) {
			const a = cmap.get(e.origin);
			const b = cmap.get(e.dest);
			if (!a || !b) continue;
			const latlngs = straightLatLngs([a.lat, a.lon], [b.lat, b.lon]);
			const weight = 1 + (4 * e.count) / maxC;
			const baseStyle = {
				color: '#0ea5e9',
				weight,
				opacity: 0.45,
			};
			const poly = L.polyline(latlngs, {
				...baseStyle,
				pane: 'rfFlows',
			});
			(poly as L.Polyline & { _rfBaseStyle?: typeof baseStyle })._rfBaseStyle = baseStyle;
			poly.addTo(flowLayer);

			const D_km = haversineKm(a.lat, a.lon, b.lat, b.lon);
			const tph = e.count / spanHours;
			const tipLines = [
				`<div class="rf-tip-title">${escHtml(e.origin)} → ${escHtml(e.dest)}</div>`,
				`<div class="rf-tip-row"><span>Trips</span> <strong>${e.count}</strong> <span class="rf-tip-muted">in this hour span</span></div>`,
				`<div class="rf-tip-row"><span>Mean rate</span> <strong>${tph < 10 ? tph.toFixed(2) : tph.toFixed(1)}</strong> <span class="rf-tip-muted">/ clock hour</span></div>`,
				`<div class="rf-tip-row"><span>Centroid distance</span> <strong>${D_km.toFixed(2)}</strong> <span class="rf-tip-muted">km</span></div>`,
				`<div class="rf-tip-row"><span>Scale</span> <strong>${K}</strong> <span class="rf-tip-muted">trip(s) per dot</span></div>`,
			];
			poly.bindTooltip(tipLines.join(''), {
				sticky: true,
				direction: 'auto',
				opacity: 1,
				className: 'rf-flow-tooltip',
			});

			poly.on('mouseover', function (this: L.Polyline) {
				const base = (this as L.Polyline & { _rfBaseStyle?: typeof baseStyle })._rfBaseStyle;
				if (!base) return;
				this.bringToFront();
				this.setStyle({
					color: '#f97316',
					weight: Math.min(14, base.weight + 4),
					opacity: 0.95,
				});
				this.openTooltip();
			});
			poly.on('mouseout', function (this: L.Polyline) {
				const base = (this as L.Polyline & { _rfBaseStyle?: typeof baseStyle })._rfBaseStyle;
				if (base) this.setStyle(base);
				this.closeTooltip();
			});

			const cycleMs = cycleMsFromTripsPerHourAndDistance(tph, D_km);
			const nDots = nDotsUniform(e.count, K, MAX_BIKE_DOTS_PER_EDGE);
			const markers: L.CircleMarker[] = [];
			for (let i = 0; i < nDots; i++) {
				const m = L.circleMarker([a.lat, a.lon], {
					radius: DOT_RADIUS_PX,
					fillColor: '#38bdf8',
					color: '#0369a1',
					weight: 0.6,
					fillOpacity: 0.9,
					pane: 'rfDots',
					interactive: false,
				});
				m.addTo(dotLayer);
				markers.push(m);
			}
			dotSpecs.push({
				lat1: a.lat,
				lon1: a.lon,
				lat2: b.lat,
				lon2: b.lon,
				cycleMs,
				markers,
			});
		}

		startDotAnimation(dotSpecs);

		if (!edges.length) {
			dotLegendEl.textContent =
				'No flows match the current day, hour span, and filters—nothing to animate.';
		} else if (scaleMode === 'auto' && K <= 1) {
			dotLegendEl.textContent =
				`Moving dots — Auto: every link uses the same scale (1 dot = 1 trip). At most ${MAX_BIKE_DOTS_PER_EDGE} dots per link. Same dot size everywhere.`;
		} else if (scaleMode === 'auto') {
			dotLegendEl.textContent =
				`Moving dots — Auto: one scale on all links — about ${K} trips per dot (so the busiest visible link fits in ${MAX_BIKE_DOTS_PER_EDGE} dots). Same scale so you can compare. Same dot size everywhere.`;
		} else if (bumped && kRequested != null) {
			dotLegendEl.textContent =
				`Moving dots — Manual: you asked for ${kRequested} trip(s) per dot; raised to ${K} so every link stays within ${MAX_BIKE_DOTS_PER_EDGE} dots. Same scale on all links. Same dot size everywhere.`;
		} else {
			dotLegendEl.textContent =
				`Moving dots — Manual: ${K} trip(s) per dot on every link (same scale for comparison). At most ${MAX_BIKE_DOTS_PER_EDGE} dots per link. Same dot size everywhere.`;
		}

		if (colorRegionsEl.checked) {
			const net = netBalanceForHourSpan(dayRows, hs, he, stationBydel, stationDelbydel, g);
			styleRegionsByNet(net, g);
		} else {
			resetBydelerStyle();
		}

		renderMatrix(edges);
		renderChord(edges, g);
		hourLabel.textContent = formatHourSpanLabel(hs, he);
	}

	async function onDateOrYearChange(): Promise<void> {
		const d = dateInput.value;
		const y = d.slice(0, 4);
		const idx = await ensureYear(y);
		if (!idx) {
			stopDotAnimation();
			flowLayer.clearLayers();
			dotLayer.clearLayers();
			dotLegendEl.textContent = '';
			return;
		}
		if (!idx.has(d)) {
			statusEl.textContent = `No trip data for ${d}.`;
			stopDotAnimation();
			flowLayer.clearLayers();
			dotLayer.clearLayers();
			dotLegendEl.textContent = '';
			return;
		}
		statusEl.textContent = '';
		redraw();
	}

	dateInput.addEventListener('change', () => void onDateOrYearChange());
	hourStartEl.addEventListener('input', () => redraw());
	hourStartEl.addEventListener('change', () => redraw());
	hourEndEl.addEventListener('input', () => redraw());
	hourEndEl.addEventListener('change', () => redraw());
	granBydel.addEventListener('change', () => redraw());
	granDel.addEventListener('change', () => redraw());
	crossOnly.addEventListener('change', () => redraw());
	colorRegionsEl.addEventListener('change', () => redraw());
	minCountEl.addEventListener('change', () => redraw());
	topNEl.addEventListener('change', () => redraw());

	syncDotScaleControls();
	dotScaleModeEl.addEventListener('change', () => {
		syncDotScaleControls();
		redraw();
	});
	dotTripsPerEl.addEventListener('input', () => redraw());
	dotTripsPerEl.addEventListener('change', () => redraw());

	playBtn.addEventListener('click', () => {
		if (playTimer) {
			clearInterval(playTimer);
			playTimer = null;
			playBtn.textContent = 'Play day';
			return;
		}
		playBtn.textContent = 'Pause';
		playTimer = setInterval(() => {
			const s = (readHourSpan().start + 1) % 24;
			const e = (readHourSpan().end + 1) % 24;
			hourStartEl.value = String(s);
			hourEndEl.value = String(e);
			redraw();
		}, 900);
	});

	const today = new Date();
	const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
	dateInput.min = '2019-01-01';
	dateInput.max = defaultDate;
	dateInput.value = defaultDate.slice(0, 4) === '2026' ? '2024-07-15' : defaultDate;

	await onDateOrYearChange();

	const ro = new ResizeObserver(() => map.invalidateSize());
	ro.observe(mapEl);
}
