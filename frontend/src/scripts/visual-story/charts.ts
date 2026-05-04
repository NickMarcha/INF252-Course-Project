import * as d3 from 'd3';
import type {
  AvgTripTimeByMonthRow,
  CyclingCalendarDaysContextRow,
  CyclingDailyNormPoint,
  CyclingDurationContextRow,
  CyclingHourlyRidingProfileData,
  IsochroneStation,
  RouteBinnedRow,
  RouteData,
  StationInOutDatum,
  StationInOutLatestFullMonthData,
  WeatherOsloData,
} from '../../data/prepared-data-types.js';
import type * as Leaflet from 'leaflet';
import {
  aggregateFlows,
  buildStationRegionMaps,
  centroidMaps,
  computeUniformTripsPerDot,
  countHoursInSpan,
  cycleMsFromTripsPerHourAndDistance,
  DOT_RADIUS_PX,
  formatHourSpanLabel,
  haversineKm,
  MAX_BIKE_DOTS_PER_EDGE,
  nDotsUniform,
  startCentroidDotAnimation,
  straightLatLngs,
  type DotEdgeAnimSpec,
} from '../lib/centroid-flow-core.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StationDatum {
  id: string;
  name: string;
  lat: number;
  lon: number;
  total_trips: number;
  trips_as_origin: number;
  trips_as_dest: number;
  bydel?: string;
  delbydel?: string;
  elevation_m?: number;
}

// ── Shared: Google encoded polyline decoder ───────────────────────────────────

function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat * 1e-5, lng * 1e-5]);
  }
  return points;
}

const AMBER = '#f97316';
const MUTED = '#d1d5db';
const DARK_TILE = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const LIGHT_TILE = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const CARTO_ATTR = '&copy; <a href="https://carto.com/">CARTO</a>';

const TOOLTIP_PAD = 8;

interface MapHomeView {
  lat: number;
  lng: number;
  zoom: number;
}

function captureMapHome(map: Leaflet.Map): MapHomeView {
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
}

function mapDiffersFromHome(map: Leaflet.Map, home: MapHomeView): boolean {
  const c = map.getCenter();
  const z = map.getZoom();
  if (Math.abs(z - home.zoom) > 0.25) return true;
  if (Math.abs(c.lat - home.lat) > 0.002 || Math.abs(c.lng - home.lng) > 0.002) return true;
  return false;
}

/** Absolute `left`/`top` (px) relative to offsetParent — keep tooltip inside container. */
function clampAbsoluteTooltipToContainer(el: HTMLElement, container: HTMLElement, pad = TOOLTIP_PAD): void {
  for (let i = 0; i < 6; i++) {
    const cr = container.getBoundingClientRect();
    const wr = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (wr.right > cr.right - pad) dx = cr.right - pad - wr.right;
    if (wr.left + dx < cr.left + pad) dx = cr.left + pad - wr.left;
    if (wr.bottom > cr.bottom - pad) dy = cr.bottom - pad - wr.bottom;
    if (wr.top + dy < cr.top + pad) dy = cr.top + pad - wr.top;
    if (dx === 0 && dy === 0) break;
    const left = (parseFloat(el.style.left) || 0) + dx;
    const top = (parseFloat(el.style.top) || 0) + dy;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }
}

/** Leaflet tooltip: nudge with margins so Leaflet’s own positioning is preserved. */
function clampLeafletTooltipEl(el: HTMLElement, mapContainer: HTMLElement, pad = TOOLTIP_PAD): void {
  el.style.marginLeft = el.style.marginLeft || '0px';
  el.style.marginTop = el.style.marginTop || '0px';
  for (let i = 0; i < 6; i++) {
    const cr = mapContainer.getBoundingClientRect();
    const wr = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (wr.right > cr.right - pad) dx = cr.right - pad - wr.right;
    if (wr.left + dx < cr.left + pad) dx = cr.left + pad - wr.left;
    if (wr.bottom > cr.bottom - pad) dy = cr.bottom - pad - wr.bottom;
    if (wr.top + dy < cr.top + pad) dy = cr.top + pad - wr.top;
    if (dx === 0 && dy === 0) break;
    const ml = (parseFloat(el.style.marginLeft) || 0) + dx;
    const mt = (parseFloat(el.style.marginTop) || 0) + dy;
    el.style.marginLeft = `${ml}px`;
    el.style.marginTop = `${mt}px`;
  }
}

function installMapTooltipClamp(map: Leaflet.Map): void {
  let moveHandler: (() => void) | null = null;
  const clearMove = () => {
    if (moveHandler) {
      map.off('mousemove', moveHandler);
      moveHandler = null;
    }
  };

  map.on('tooltipopen', (e: Leaflet.LeafletEvent) => {
    clearMove();
    const te = e as Leaflet.LeafletEvent & { tooltip: { getElement?: () => HTMLElement | undefined } };
    const tip = te.tooltip.getElement?.();
    if (!tip) return;
    const mapEl = map.getContainer();
    const clamp = () => {
      clampLeafletTooltipEl(tip, mapEl);
    };
    requestAnimationFrame(() => requestAnimationFrame(clamp));
    moveHandler = () => {
      requestAnimationFrame(clamp);
    };
    map.on('mousemove', moveHandler);
    map.once('tooltipclose', () => {
      clearMove();
      tip.style.marginLeft = '';
      tip.style.marginTop = '';
    });
  });
}

/** Call with `programmatic` already true, immediately after starting flyTo / flyToBounds. */
function attachHomeCaptureWhenMoveEnds(
  map: Leaflet.Map,
  setHome: (h: MapHomeView) => void,
  clearProgrammatic: () => void,
): void {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    map.off('moveend', finish);
    setHome(captureMapHome(map));
    clearProgrammatic();
    updateBalanceResetVisibility();
    updateRoutesResetVisibility();
  };
  map.once('moveend', finish);
  window.setTimeout(finish, 1600);
}

// ── Hero map ──────────────────────────────────────────────────────────────────

/** Fixed camera for animated hero (delbydel flow); pan/zoom off so the page can scroll. */
const HERO_MAP_CENTER: [number, number] = [59.92238, 10.7048];
const HERO_MAP_ZOOM = 14;

const REGION_FLOW_SANDBOX_URL =
  'https://nickmarcha.github.io/INF252-Course-Project/region-flow/';

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatHeroCalendarDay(period: string): string {
  const p = period.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  const [ys, ms, ds] = p.split('-');
  const y = Number(ys);
  const mo = Number(ms);
  const da = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return p;
  const d = new Date(y, mo - 1, da);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function setHeroFlowNoteVisible(visible: boolean, html?: string): void {
  const note = document.getElementById('hero-flow-note');
  if (!note) return;
  if (!visible) {
    note.hidden = true;
    note.innerHTML = '';
    return;
  }
  if (html != null) note.innerHTML = html;
  note.hidden = false;
}

type LeafletShim = Pick<typeof import('leaflet'), 'map' | 'tileLayer' | 'control' | 'circleMarker'>;

async function initHeroMapStatic(L: LeafletShim, el: HTMLElement, stations: StationDatum[]): Promise<void> {
  setHeroFlowNoteVisible(false);
  const map = L.map(el, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, attributionControl: false });
  L.tileLayer(DARK_TILE, { maxZoom: 19, attribution: CARTO_ATTR }).addTo(map);
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
  map.setView([59.918, 10.745], 12);

  const sizeScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, s => s.total_trips) ?? 1])
    .range([2.5, 13]);

  for (const s of stations) {
    L.circleMarker([s.lat, s.lon], {
      radius: sizeScale(s.total_trips),
      fillColor: AMBER,
      fillOpacity: 0.72,
      color: 'rgba(255,255,255,0.12)',
      weight: 1,
    }).addTo(map);
  }
}

export async function initHeroMap(
  containerId: string,
  stations: StationDatum[],
  heroDayRows?: RouteBinnedRow[] | null,
): Promise<void> {
  const L = (await import('leaflet')).default;
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!heroDayRows?.length) {
    setHeroFlowNoteVisible(false);
    await initHeroMapStatic(L, el, stations);
    return;
  }

  const isoStations = stations as unknown as IsochroneStation[];
  const { bydel: stationBydel, delbydel: stationDelbydel } = buildStationRegionMaps(isoStations);
  const centroids = centroidMaps(isoStations);
  const hourStart = 7;
  const hourEnd = 18;
  const hourLabel = formatHourSpanLabel(hourStart, hourEnd);
  const edges = aggregateFlows(
    heroDayRows,
    hourStart,
    hourEnd,
    stationBydel,
    stationDelbydel,
    'delbydel',
    true,
    2,
    48,
  );

  if (!edges.length) {
    setHeroFlowNoteVisible(false);
    await initHeroMapStatic(L, el, stations);
    return;
  }

  const periodRaw = String(heroDayRows[0]?.period ?? '').trim();
  const dayLabel = periodRaw ? formatHeroCalendarDay(periodRaw) : 'a sample day';

  const map = L.map(el, {
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    attributionControl: false,
    touchZoom: false,
    boxZoom: false,
    keyboard: false,
  });
  L.tileLayer(DARK_TILE, { maxZoom: 19, attribution: CARTO_ATTR }).addTo(map);
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
  map.setView(HERO_MAP_CENTER, HERO_MAP_ZOOM);

  map.createPane('heroFlows');
  map.getPane('heroFlows')!.style.zIndex = '450';
  map.createPane('heroDots');
  map.getPane('heroDots')!.style.zIndex = '460';

  const flowLayer = L.layerGroup().addTo(map);
  const dotLayer = L.layerGroup().addTo(map);

  const cmap = centroids.delbydel;
  const spanHours = Math.max(1, countHoursInSpan(hourStart, hourEnd));
  const maxC = edges[0]?.count ?? 1;
  const { K } = computeUniformTripsPerDot(edges, MAX_BIKE_DOTS_PER_EDGE, 'auto', 1);

  const dotSpecs: DotEdgeAnimSpec[] = [];

  for (const e of edges) {
    const a = cmap.get(e.origin);
    const b = cmap.get(e.dest);
    if (!a || !b) continue;
    const latlngs = straightLatLngs([a.lat, a.lon], [b.lat, b.lon]);
    const weight = 1 + (3 * e.count) / maxC;
    L.polyline(latlngs, {
      color: AMBER,
      weight,
      opacity: 0.22,
      pane: 'heroFlows',
      interactive: false,
    }).addTo(flowLayer);

    const D_km = haversineKm(a.lat, a.lon, b.lat, b.lon);
    const tph = e.count / spanHours;
    const cycleMs = cycleMsFromTripsPerHourAndDistance(tph, D_km);
    const nDots = nDotsUniform(e.count, K, MAX_BIKE_DOTS_PER_EDGE);
    const markers: Leaflet.CircleMarker[] = [];
    for (let i = 0; i < nDots; i++) {
      const m = L.circleMarker([a.lat, a.lon], {
        radius: DOT_RADIUS_PX,
        fillColor: AMBER,
        color: 'rgba(255,255,255,0.35)',
        weight: 0.6,
        fillOpacity: 0.88,
        pane: 'heroDots',
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

  startCentroidDotAnimation(dotSpecs);

  const isoLine = periodRaw
    ? `<span class="hero-flow-note-mono">${escHtml(periodRaw)}</span> (${escHtml(dayLabel)})`
    : escHtml(dayLabel);
  setHeroFlowNoteVisible(true, [
    '<p class="hero-flow-note-lead">Straight lines connect <strong>delbydel</strong> (sub-district) centroids. Orange dots move along cross-area trips</p>',
    `<p class="hero-flow-note-data"><strong>Data</strong> · ${isoLine}, trip starts <strong>${escHtml(hourLabel)}</strong> (Oslo Bysykkel).</p>`,
    `<p class="hero-flow-note-link"><a class="hero-flow-note-link-a" href="${REGION_FLOW_SANDBOX_URL}" target="_blank" rel="noopener noreferrer">Open the Region flow sandbox to change day, hours, and filters.</a></p>`,
    '<p class="hero-flow-note-continue">The story continues below.</p>',
  ].join(''));
}

// ── Chapter 1: Yearly bar chart ───────────────────────────────────────────────

interface YearRow { year: number; trips: number }

let yearSvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
let yearData: YearRow[] = [];
let yearX: d3.ScaleBand<string>;
let yearY: d3.ScaleLinear<number, number>;
let yearH = 0;
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];

export function initYearlyChart(svgSelector: string, rows: AvgTripTimeByMonthRow[]): void {
  const margin = { top: 40, right: 30, bottom: 56, left: 72 };
  const container = document.querySelector<HTMLElement>(svgSelector)!.parentElement!;
  const { width, height } = container.getBoundingClientRect();
  const W = width - margin.left - margin.right;
  yearH = height - margin.top - margin.bottom;

  yearData = YEARS.map(yr => ({
    year: yr,
    trips: d3.sum(rows.filter(r => r.year === yr), r => r.trip_count),
  })).filter(d => d.trips > 0);

  yearSvg = d3.select<SVGSVGElement, unknown>(svgSelector)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%').attr('height', '100%');

  const g = yearSvg.append('g').attr('class', 'chart-g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  yearX = d3.scaleBand<string>().domain(yearData.map(d => String(d.year))).range([0, W]).padding(0.32);
  yearY = d3.scaleLinear().domain([0, (d3.max(yearData, d => d.trips) ?? 0) * 1.12]).range([yearH, 0]);

  const axStyle = (ax: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>) => {
    ax.selectAll('text').attr('font-size', 16).attr('fill', '#111827');
    ax.select('.domain').attr('stroke', '#d1d5db');
    ax.selectAll('.tick line').attr('stroke', '#d1d5db');
  };

  g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${yearH})`)
    .call(d3.axisBottom(yearX)).call(axStyle);
  g.append('g').attr('class', 'y-axis')
    .call(d3.axisLeft(yearY).ticks(5).tickFormat(d => `${(+d / 1_000_000).toFixed(1)}M`))
    .call(ax => { ax.selectAll('text').attr('font-size', 15).attr('fill', '#374151'); ax.select('.domain').remove(); ax.selectAll('.tick line').attr('stroke', '#e5e7eb'); });
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(yearY).ticks(5).tickSize(-W).tickFormat(() => ''))
    .call(ax => { ax.select('.domain').remove(); ax.selectAll('.tick line').attr('stroke', '#f3f4f6').attr('stroke-dasharray', '3,3'); });

  g.append('text').attr('x', W / 2).attr('y', yearH + 48).attr('text-anchor', 'middle').attr('fill', '#6b7280').attr('font-size', 14).text('Year');
  g.append('text').attr('transform', 'rotate(-90)').attr('x', -yearH / 2).attr('y', -58).attr('text-anchor', 'middle').attr('fill', '#6b7280').attr('font-size', 14).text('Total trips');

  g.selectAll<SVGRectElement, YearRow>('rect.bar')
    .data(yearData, d => String(d.year)).join('rect').attr('class', 'bar')
    .attr('x', d => yearX(String(d.year)) ?? 0).attr('y', yearH)
    .attr('width', yearX.bandwidth()).attr('height', 0).attr('fill', MUTED).attr('rx', 4);

  g.selectAll<SVGTextElement, YearRow>('text.bar-label')
    .data(yearData, d => String(d.year)).join('text').attr('class', 'bar-label')
    .attr('x', d => (yearX(String(d.year)) ?? 0) + yearX.bandwidth() / 2)
    .attr('y', yearH - 6).attr('text-anchor', 'middle').attr('font-size', 14).attr('opacity', 0)
    .text(d => `${(d.trips / 1_000_000).toFixed(2)}M`);
}

export function updateYearlyChart(step: number): void {
  const activeYears: Set<number> = step === 3
    ? new Set([2023, 2024, 2025])
    : step === 2
    ? new Set([2021, 2022])
    : new Set([yearData[step]?.year]);
  const g = yearSvg.select<SVGGElement>('.chart-g');
  g.selectAll<SVGRectElement, YearRow>('rect.bar').transition().duration(480)
    .attr('y', d => yearY(d.trips)).attr('height', d => yearH - yearY(d.trips))
    .attr('fill', d => activeYears.has(d.year) ? AMBER : MUTED)
    .attr('opacity', d => activeYears.has(d.year) ? 1 : 0.55);
  g.selectAll<SVGTextElement, YearRow>('text.bar-label').transition().duration(480)
    .attr('y', d => yearY(d.trips) - 8)
    .attr('opacity', d => activeYears.has(d.year) ? 1 : 0)
    .attr('fill', () => '#c2410c');
}

// ── Chapter 2: Seasonal multi-line ────────────────────────────────────────────

let seasonSvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
let seasonData: Map<number, AvgTripTimeByMonthRow[]>;
let seasonYears: number[];
let seasonTooltipEl: HTMLDivElement | null = null;
const SEASON_PALETTE = ['#0ea5e9', '#f97316', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b', '#6366f1'];

export function initSeasonalChart(svgSelector: string, rows: AvgTripTimeByMonthRow[]): void {
  const margin = { top: 40, right: 30, bottom: 56, left: 72 };
  const container = document.querySelector<HTMLElement>(svgSelector)!.parentElement!;
  const { width, height } = container.getBoundingClientRect();
  const W = width - margin.left - margin.right;
  const H = height - margin.top - margin.bottom;

  seasonYears = [...new Set(rows.map(r => r.year))].sort();
  seasonData = d3.group(rows, r => r.year);

  seasonSvg = d3.select<SVGSVGElement, unknown>(svgSelector)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%').attr('height', '100%');

  const g = seasonSvg.append('g').attr('class', 'chart-g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const xScale = d3.scaleLinear().domain([1, 12]).range([0, W]);
  const yScale = d3.scaleLinear().domain([0, (d3.max(rows, r => r.trip_count) ?? 1) * 1.08]).range([H, 0]);
  const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(xScale).ticks(12).tickFormat((_d, i) => monthAbbr[i]))
    .call(ax => { ax.selectAll('text').attr('font-size', 14).attr('fill', '#374151'); ax.select('.domain').attr('stroke', '#d1d5db'); ax.selectAll('.tick line').attr('stroke', '#d1d5db'); });
  g.append('g').attr('class', 'y-axis')
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d => `${(+d / 1000).toFixed(0)}k`))
    .call(ax => { ax.selectAll('text').attr('font-size', 14).attr('fill', '#374151'); ax.select('.domain').remove(); ax.selectAll('.tick line').attr('stroke', '#e5e7eb'); });
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(yScale).ticks(5).tickSize(-W).tickFormat(() => ''))
    .call(ax => { ax.select('.domain').remove(); ax.selectAll('.tick line').attr('stroke', '#f3f4f6').attr('stroke-dasharray', '3,3'); });

  g.append('rect').attr('class', 'summer-band')
    .attr('x', xScale(6)).attr('y', 0)
    .attr('width', xScale(9) - xScale(6)).attr('height', H)
    .attr('fill', '#fef3c7').attr('opacity', 0);

  const lineGen = d3.line<AvgTripTimeByMonthRow>()
    .x(d => xScale(d.month)).y(d => yScale(d.trip_count)).curve(d3.curveMonotoneX);

  for (const [i, yr] of seasonYears.entries()) {
    const yrRows = (seasonData.get(yr) ?? []).sort((a, b) => a.month - b.month);
    g.append('path').datum(yrRows)
      .attr('class', `season-line year-${yr}`)
      .attr('fill', 'none')
      .attr('stroke', SEASON_PALETTE[i % SEASON_PALETTE.length])
      .attr('stroke-width', 2).attr('opacity', 0).attr('d', lineGen);
  }

  g.append('text').attr('x', W / 2).attr('y', H + 48).attr('text-anchor', 'middle').attr('fill', '#6b7280').attr('font-size', 14).text('Month');
  g.append('text').attr('transform', 'rotate(-90)').attr('x', -H / 2).attr('y', -58).attr('text-anchor', 'middle').attr('fill', '#6b7280').attr('font-size', 14).text('Trips per month');

  const legendHeight = seasonYears.length * 20 + 16;
  const legendG = g.append('g').attr('transform', `translate(4, 4)`);
  legendG.append('rect').attr('width', 64).attr('height', legendHeight).attr('rx', 6)
    .attr('fill', 'rgba(249,250,251,0.92)').attr('stroke', '#e5e7eb');
  seasonYears.forEach((yr, i) => {
    const row = legendG.append('g').attr('class', `legend-year-${yr}`).attr('transform', `translate(8, ${12 + i * 20})`);
    row.append('line').attr('x1', 0).attr('x2', 18).attr('stroke', SEASON_PALETTE[i % SEASON_PALETTE.length]).attr('stroke-width', 2.5).attr('stroke-linecap', 'round');
    row.append('text').attr('x', 22).attr('dy', '0.35em').attr('font-size', 13).attr('fill', '#374151').text(yr);
  });

  // Tooltip div
  seasonTooltipEl = document.createElement('div');
  Object.assign(seasonTooltipEl.style, {
    position: 'absolute', background: 'rgba(255,255,255,0.97)', border: '1px solid #e5e7eb',
    borderRadius: '0.45rem', padding: '0.3rem 0.6rem', fontSize: '0.75rem', fontWeight: '600',
    pointerEvents: 'none', opacity: '0', transition: 'opacity 0.12s', zIndex: '10',
    boxShadow: '0 2px 8px rgba(0,0,0,0.10)', whiteSpace: 'nowrap', color: '#1c1c1e',
  });
  container.appendChild(seasonTooltipEl);

  const svgEl = seasonSvg.node() as SVGSVGElement;

  // Dot circles, one per data point, per year
  for (const [i, yr] of seasonYears.entries()) {
    const yrRows = (seasonData.get(yr) ?? []).sort((a, b) => a.month - b.month);
    const color = SEASON_PALETTE[i % SEASON_PALETTE.length];
    g.selectAll<SVGCircleElement, AvgTripTimeByMonthRow>(null)
      .data(yrRows)
      .join('circle')
      .attr('class', `season-dot year-${yr}`)
      .attr('cx', d => xScale(d.month))
      .attr('cy', d => yScale(d.trip_count))
      .attr('r', 4)
      .attr('fill', color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0)
      .style('cursor', 'crosshair')
      .on('mouseover', function (_event, d) {
        d3.select(this).attr('r', 6);
        const svgPt = svgEl.createSVGPoint();
        svgPt.x = Number(d3.select(this).attr('cx')) + margin.left;
        svgPt.y = Number(d3.select(this).attr('cy')) + margin.top;
        const screen = svgPt.matrixTransform(svgEl.getScreenCTM()!);
        const cr = container.getBoundingClientRect();
        if (seasonTooltipEl) {
          const avgMin = Math.round(d.avg_trip_seconds / 60);
          seasonTooltipEl.textContent =
            `${monthAbbr[d.month - 1]} ${d.year}: ${d.trip_count.toLocaleString()} trips · ~${avgMin} min avg`;
          seasonTooltipEl.style.color = color;
          seasonTooltipEl.style.left = `${screen.x - cr.left + 12}px`;
          seasonTooltipEl.style.top = `${screen.y - cr.top - 40}px`;
          seasonTooltipEl.style.opacity = '1';
          clampAbsoluteTooltipToContainer(seasonTooltipEl, container, TOOLTIP_PAD);
        }
      })
      .on('mouseout', function () {
        d3.select(this).attr('r', 4);
        if (seasonTooltipEl) seasonTooltipEl.style.opacity = '0';
      });
  }

  const yAt50k = yScale(50_000);
  const yHint = Math.min(Math.max(yAt50k, H * 0.35), H - 14);
  g.append('text')
    .attr('class', 'season-hover-hint')
    .attr('x', W / 2)
    .attr('y', yHint)
    .attr('dy', '-0.35em')
    .attr('text-anchor', 'middle')
    .attr('fill', '#94a3b8')
    .attr('font-size', 12)
    .attr('font-weight', 700)
    .attr('font-family', "Inter, system-ui, sans-serif")
    .attr('pointer-events', 'none')
    .text('Hover a point for trips and average ride time');
}

export function updateSeasonalChart(step: number): void {
  if (seasonTooltipEl) seasonTooltipEl.style.opacity = '0';

  const allYears = step === 3;
  const visibleYears = new Set(allYears ? seasonYears : seasonYears.slice(0, step + 1));
  const activeYear = allYears ? null : seasonYears[step];

  seasonSvg.select('.summer-band').transition().duration(500).attr('opacity', step >= 2 ? 0.55 : 0);

  seasonSvg.selectAll<SVGPathElement, AvgTripTimeByMonthRow[]>('path.season-line').transition().duration(500)
    .attr('opacity', function () {
      const yr = Number((this.getAttribute('class') ?? '').match(/year-(\d+)/)?.[1]);
      if (allYears) return 0.72;
      return visibleYears.has(yr) ? (yr === activeYear ? 1 : 0.28) : 0;
    })
    .attr('stroke-width', function () {
      const yr = Number((this.getAttribute('class') ?? '').match(/year-(\d+)/)?.[1]);
      if (allYears) return 1.8;
      return yr === activeYear ? 2.5 : 1.5;
    });

  seasonSvg.selectAll<SVGCircleElement, AvgTripTimeByMonthRow>('circle.season-dot').transition().duration(500)
    .attr('opacity', function () {
      const yr = Number((this.getAttribute('class') ?? '').match(/year-(\d+)/)?.[1]);
      if (allYears) return 0.55;
      return visibleYears.has(yr) ? (yr === activeYear ? 0.75 : 0.18) : 0;
    });

  for (const yr of seasonYears) {
    const op = allYears ? 0.9 : visibleYears.has(yr) ? (yr === activeYear ? 1 : 0.45) : 0.12;
    seasonSvg.select<SVGGElement>(`.legend-year-${yr}`).transition().duration(500).attr('opacity', op);
  }
}

// ── Chapter 2b: When people ride (bars + scatter + hourly) ─────────────────

const BUCKET_ORDER = ['night', 'morning_commute', 'midday', 'afternoon_commute', 'evening'] as const;

function bucketDisplayName(key: string): string {
  const map: Record<string, string> = {
    night: 'Night',
    morning_commute: 'Morning commute',
    midday: 'Midday',
    afternoon_commute: 'Afternoon commute',
    evening: 'Evening',
  };
  return map[key] ?? key.replace(/_/g, ' ');
}

/** Oslo trip-start hours per `data-pipeline/cycling_trip_table.py` BUCKET_DEFS. */
function bucketHourSpanLabel(key: string): string {
  const map: Record<string, string> = {
    night: '23–06',
    morning_commute: '07–09',
    midday: '10–14',
    afternoon_commute: '15–18',
    evening: '19–22',
  };
  return map[key] ?? '';
}

function dayContextIndex(isWeekend: boolean, anyHoliday: boolean): number {
  if (isWeekend && anyHoliday) return 3;
  if (isWeekend) return 2;
  if (anyHoliday) return 1;
  return 0;
}

const CTX_LABELS = ['Weekday', 'Weekday (holiday)', 'Weekend', 'Weekend + holiday'] as const;
const CTX_COLORS = ['#2563eb', '#7c3aed', '#0d9488', '#ea580c'] as const;

export interface WhenRidingInitOptions {
  barsSvg: string;
  scatterSvg: string;
  hourlySvg: string;
  hourlyRow: string;
  footnoteEl: string;
  hintEl: string;
  durationByContext: CyclingDurationContextRow[];
  /** Fallback if rows predate per-row `n_days` (matches cycling_regression calendar slice). */
  calendarDaysByContext?: CyclingCalendarDaysContextRow[];
  hourlyRidingProfile: CyclingHourlyRidingProfileData | null;
  dailySeries: CyclingDailyNormPoint[];
  weather: WeatherOsloData | null;
  stationInOut: StationInOutLatestFullMonthData | null;
}

type SplomMetricKey = 'avgTripMin' | 'tripCount' | 'precipMm' | 'tempC';

interface ScatterDayPoint {
  date: string;
  /** Daily precipitation sum (mm), Blindern. */
  precipMm: number;
  /** Daily mean temperature (°C), Blindern. */
  tempC: number;
  /** Total trips that calendar day. */
  tripCount: number;
  /** Network mean trip length that calendar day (minutes). */
  avgTripMin: number;
  ctx: number;
}

let whenBarsSvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown> | null = null;
let whenScatterSvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown> | null = null;
/** Per-dot fill-opacity base for expanded SPLOM cell (from n); `updateWhenRiding` scales it by step. */
let whenScatterDotFillBase = 0.22;
/** Matrix small-multiple dots (from n); scaled in `updateWhenRiding`. */
let whenSplomMatrixDotFillBase = 0.14;
/** null = 4×4 matrix; otherwise one pair fills the panel. */
let splomExpanded: { row: number; col: number } | null = null;
let whenRidingLastOpts: WhenRidingInitOptions | null = null;
let splomBackBtn: HTMLButtonElement | null = null;
let splomKeydownBound = false;
let whenHourlySvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown> | null = null;
let whenHourlyRowEl: HTMLElement | null = null;
let whenFootnoteEl: HTMLElement | null = null;
let whenHintEl: HTMLElement | null = null;
let whenScatterTooltip: HTMLDivElement | null = null;
let whenBarTooltip: HTMLDivElement | null = null;

type WhenBarsMetricMode = 'minutes' | 'trips';
let whenBarsMetricMode: WhenBarsMetricMode = 'minutes';
/** Upper end of bar y-scale domain `[0, high]` after last full paint or metric transition (for smooth toggles). */
let whenBarsYDomainHigh = 1;
let whenBarsToggleMinutesBtn: HTMLButtonElement | null = null;
let whenBarsToggleTripsBtn: HTMLButtonElement | null = null;

const WHEN_BARS_METRIC_MS = 450;

function styleWhenBarsYAxis(ax: d3.Selection<SVGGElement, unknown, HTMLElement | null, unknown>): void {
  ax.selectAll('text').attr('font-size', 11).attr('fill', '#4b5563');
  ax.select('.domain').remove();
  ax.selectAll('.tick line').attr('stroke', '#e5e7eb');
}

function styleWhenBarsGrid(ax: d3.Selection<SVGGElement, unknown, HTMLElement | null, unknown>): void {
  ax.select('.domain').remove();
  ax.selectAll('.tick line').attr('stroke', '#f3f4f6').attr('stroke-dasharray', '3,3');
}

/** Animate bar heights and y-axis when switching Minutes / Trips without full SVG tear-down. */
function transitionWhenBarsMetric(from: WhenBarsMetricMode): void {
  const prepared = whenRidingPrepared;
  const dom = whenRidingDom;
  if (!prepared || !dom || !whenBarsSvg) {
    scheduleWhenRidingPaint();
    return;
  }
  const gbSel = whenBarsSvg.select<SVGGElement>('g.when-bars-g');
  if (gbSel.empty()) {
    scheduleWhenRidingPaint();
    return;
  }
  gbSel.interrupt();

  const to = whenBarsMetricMode;
  const { pivot, maxBarMinutes, maxBarTrips } = prepared;
  const { barsEl } = dom;
  const marginBars = { top: 48, right: 12, bottom: 68, left: 56 };
  const dims = readPanelRect(barsEl, WHEN_PANEL_MIN, WHEN_PANEL_MIN);
  const bw = dims.w;
  const bh = dims.h;
  const innerW = Math.max(80, bw - marginBars.left - marginBars.right);
  const innerH = Math.max(80, bh - marginBars.top - marginBars.bottom);

  const maxStart = Math.max(whenBarsYDomainHigh, 1e-6);
  const maxEnd = Math.max((to === 'minutes' ? maxBarMinutes : maxBarTrips) * 1.06, 1e-6);
  const ybStart = d3.scaleLinear().domain([0, maxStart]).range([innerH, 0]);
  const ybEnd = d3.scaleLinear().domain([0, maxEnd]).range([innerH, 0]);
  const iHi = d3.interpolate(maxStart, maxEnd);

  const yTickFmtTo = (v: number): string =>
    to === 'minutes' ? fmtMinAxis(v) : fmtTripAxis(v);

  gbSel
    .transition()
    .duration(WHEN_BARS_METRIC_MS)
    .ease(d3.easeCubicInOut)
    .tween('whenBarsMetric', () => (u: number) => {
      const hi = iHi(u);
      const ybAxis = d3.scaleLinear().domain([0, hi]).range([innerH, 0]);
      gbSel
        .select<SVGGElement>('g.y-axis')
        .call(
          d3.axisLeft(ybAxis).ticks(5).tickFormat(d => (typeof d === 'number' && Number.isFinite(d) ? yTickFmtTo(d) : '')),
        )
        .call(styleWhenBarsYAxis);
      gbSel
        .select<SVGGElement>('g.grid')
        .call(d3.axisLeft(ybAxis).ticks(5).tickSize(-innerW).tickFormat(() => ''))
        .call(styleWhenBarsGrid);

      gbSel.selectAll<SVGGElement, (typeof pivot)[0]>('g.bucket').each(function (row) {
        const g = d3.select(this);
        for (let ctx = 0; ctx < 4; ctx++) {
          const vFrom = from === 'minutes' ? row.minutes[ctx] : row.tripsPerDay[ctx];
          const vTo = to === 'minutes' ? row.minutes[ctx] : row.tripsPerDay[ctx];
          const y0 = ybStart(vFrom);
          const h0 = innerH - y0;
          const y1 = ybEnd(vTo);
          const h1 = innerH - y1;
          const y = y0 + (y1 - y0) * u;
          const h = h0 + (h1 - h0) * u;
          g.select<SVGRectElement>(`rect.ctx-${ctx}`).attr('y', y).attr('height', h);
        }
      });
    })
    .on('end', () => {
      whenBarsYDomainHigh = maxEnd;
      const yb = d3.scaleLinear().domain([0, maxEnd]).range([innerH, 0]);
      const yTickFmt = to === 'minutes' ? fmtMinAxis : fmtTripAxis;
      gbSel
        .select<SVGGElement>('g.y-axis')
        .call(d3.axisLeft(yb).ticks(5).tickFormat(d => (typeof d === 'number' && Number.isFinite(d) ? yTickFmt(d) : '')))
        .call(styleWhenBarsYAxis);
      gbSel
        .select<SVGGElement>('g.grid')
        .call(d3.axisLeft(yb).ticks(5).tickSize(-innerW).tickFormat(() => ''))
        .call(styleWhenBarsGrid);

      gbSel.selectAll<SVGGElement, (typeof pivot)[0]>('g.bucket').each(function (row) {
        const arr = to === 'minutes' ? row.minutes : row.tripsPerDay;
        d3.select(this)
          .selectAll<SVGRectElement, { value: number; ctx: number; bucket: string }>('rect.ctx-bar')
          .data(
            arr.map((v, i) => ({ value: v, ctx: i, bucket: row.bucket })),
            d => `${d.bucket}-${d.ctx}`,
          )
          .attr('y', d => yb(d.value))
          .attr('height', d => innerH - yb(d.value));
      });

      gbSel
        .select<SVGTextElement>('text.when-bars-y-label')
        .text(to === 'minutes' ? 'Avg riding minutes / day in bucket' : 'Trips / day in bucket');
    });
}

function syncWhenBarsToggleUi(): void {
  if (!whenBarsToggleMinutesBtn || !whenBarsToggleTripsBtn) return;
  const m = whenBarsMetricMode === 'minutes';
  whenBarsToggleMinutesBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
  whenBarsToggleTripsBtn.setAttribute('aria-pressed', m ? 'false' : 'true');
  whenBarsToggleMinutesBtn.style.fontWeight = m ? '700' : '500';
  whenBarsToggleTripsBtn.style.fontWeight = m ? '500' : '700';
  whenBarsToggleMinutesBtn.style.background = m ? '#e0e7ff' : '#ffffff';
  whenBarsToggleTripsBtn.style.background = m ? '#ffffff' : '#e0e7ff';
}

function aggregateHourlyDepartures(
  stations: StationInOutDatum[],
  key: 'hourly_weekday_departures' | 'hourly_weekend_departures',
): number[] {
  const acc = Array.from({ length: 24 }, () => 0);
  for (const s of stations) {
    const arr = s[key];
    if (!arr?.length) continue;
    for (let h = 0; h < 24; h++) acc[h] += Number(arr[h]) || 0;
  }
  return acc;
}

/** Avoid += string concat if count is ever deserialized as string (breaks d3.max / y-scale). */
function ctxIndexRowSafe(r: CyclingDurationContextRow): number {
  const wk = r.is_weekend === true || (r as unknown as { is_weekend?: number }).is_weekend === 1;
  const hol = r.is_public_holiday === true || (r as unknown as { is_public_holiday?: number }).is_public_holiday === 1;
  if (wk) return hol ? 3 : 2;
  return hol ? 1 : 0;
}

function nDaysForDurationRow(
  r: CyclingDurationContextRow,
  calendar?: CyclingCalendarDaysContextRow[],
): number {
  const n = r.n_days;
  if (n != null && n > 0) return n;
  const wk = r.is_weekend === true || (r as unknown as { is_weekend?: number }).is_weekend === 1;
  const hol = r.is_public_holiday === true || (r as unknown as { is_public_holiday?: number }).is_public_holiday === 1;
  const hit = calendar?.find(c => !!c.is_weekend === wk && !!c.is_public_holiday === hol);
  if (hit && hit.n_days > 0) return hit.n_days;
  return 1;
}

const fmtTripAxis = d3.format('~s');
const fmtMinAxis = d3.format('~s');

interface WhenRidingPrepared {
  buckets: string[];
  /** Per context: avg minutes of riding per calendar day from trips starting in that bucket. */
  pivot: { bucket: string; minutes: number[]; tripsPerDay: number[] }[];
  maxBarMinutes: number;
  maxBarTrips: number;
  scatterData: ScatterDayPoint[];
  /** Station snapshot departures (fallback when trip hourly profile missing). */
  hourlyWdDepartures: number[];
  hourlyWeDepartures: number[];
  hourlyTripProfile: CyclingHourlyRidingProfileData | null;
}

interface WhenRidingPanelDims {
  bars: { w: number; h: number };
  scatter: { w: number; h: number };
  hourly: { w: number; h: number };
}

let whenRidingPrepared: WhenRidingPrepared | null = null;
let whenRidingDom: {
  barsEl: HTMLElement;
  scatterEl: HTMLElement;
  hourlyEl: HTMLElement;
} | null = null;
let whenRidingResizeObserver: ResizeObserver | null = null;
let whenRidingResizeDebounce: ReturnType<typeof setTimeout> | null = null;
/** After a full when-riding paint, used to skip bar/scatter rebuild when only the hourly panel resizes. */
let whenRidingLastBarsScatterDims: { bars: { w: number; h: number }; scatter: { w: number; h: number } } | null = null;

const WHEN_PANEL_MIN = 120;
const WHEN_HOURLY_MIN_H = 72;
const WHEN_RESIZE_DEBOUNCE_MS = 100;

function readPanelRect(el: HTMLElement, minW: number, minH: number): { w: number; h: number } {
  const r = el.getBoundingClientRect();
  return {
    w: Math.max(minW, Math.round(r.width)),
    h: Math.max(minH, Math.round(r.height)),
  };
}

function whenPanelBoxDimsApproxEqual(
  a: { w: number; h: number },
  b: { w: number; h: number },
  tol = 2,
): boolean {
  return Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
}

function prepareWhenRidingData(opts: WhenRidingInitOptions): WhenRidingPrepared {
  const rows = opts.durationByContext ?? [];
  const cal = opts.calendarDaysByContext;
  let buckets = BUCKET_ORDER.filter(b => rows.some(r => r.time_of_day_bucket === b));
  if (buckets.length === 0) {
    const rest = [...new Set(rows.map(r => r.time_of_day_bucket))].sort(
      (a, b) => BUCKET_ORDER.indexOf(a as (typeof BUCKET_ORDER)[number]) - BUCKET_ORDER.indexOf(b as (typeof BUCKET_ORDER)[number]),
    );
    buckets = rest;
  }

  const pivot = buckets.map(bucket => {
    const minutes = [0, 0, 0, 0] as number[];
    const tripsPerDay = [0, 0, 0, 0] as number[];
    for (const r of rows) {
      if (r.time_of_day_bucket !== bucket) continue;
      const idx = ctxIndexRowSafe(r);
      const nDays = nDaysForDurationRow(r, cal);
      const totalMin = ((Number(r.count) || 0) * (Number(r.mean_sec) || 0)) / 60;
      minutes[idx] += totalMin / nDays;
      tripsPerDay[idx] += (Number(r.count) || 0) / nDays;
    }
    return { bucket, minutes, tripsPerDay };
  });

  const maxBarMinutes = Math.max(1, d3.max(pivot, d => d3.max(d.minutes)) ?? 1);
  const maxBarTrips = Math.max(1, d3.max(pivot, d => d3.max(d.tripsPerDay)) ?? 1);

  const weatherByDate = new Map<string, { precipMm: number; tempC: number }>();
  if (opts.weather?.data?.length) {
    for (const w of opts.weather.data) {
      if (w.date == null || w.date === '') continue;
      if (w.precipitation == null || w.temperature == null) continue;
      weatherByDate.set(w.date, { precipMm: Number(w.precipitation), tempC: Number(w.temperature) });
    }
  }

  const scatterData: ScatterDayPoint[] = [];
  for (const s of opts.dailySeries ?? []) {
    const wx = weatherByDate.get(s.date);
    if (!wx) continue;
    const trips = Number(s.trip_count) || 0;
    if (trips <= 0) continue;
    const totalMin = Number(s.total_duration_min) || 0;
    scatterData.push({
      date: s.date,
      precipMm: wx.precipMm,
      tempC: wx.tempC,
      tripCount: trips,
      avgTripMin: totalMin / trips,
      ctx: dayContextIndex(
        s.is_weekend === true || (s as unknown as { is_weekend?: number }).is_weekend === 1,
        s.any_holiday === true || (s as unknown as { any_holiday?: number }).any_holiday === 1,
      ),
    });
  }

  const stationsHourly = opts.stationInOut?.stations ?? [];
  const hourlyWdDepartures = stationsHourly.length ? aggregateHourlyDepartures(stationsHourly, 'hourly_weekday_departures') : [];
  const hourlyWeDepartures = stationsHourly.length ? aggregateHourlyDepartures(stationsHourly, 'hourly_weekend_departures') : [];

  const profile = opts.hourlyRidingProfile;
  const hourlyTripProfile =
    profile &&
    profile.weekday_duration_min_avg_daily.length === 24 &&
    profile.weekend_duration_min_avg_daily.length === 24 &&
    profile.weekday_trips_avg_daily.length === 24 &&
    profile.weekend_trips_avg_daily.length === 24
      ? profile
      : null;

  return {
    buckets,
    pivot,
    maxBarMinutes,
    maxBarTrips,
    scatterData,
    hourlyWdDepartures,
    hourlyWeDepartures,
    hourlyTripProfile,
  };
}

const SPLOM_METRICS: readonly { key: SplomMetricKey; label: string; short: string }[] = [
  { key: 'avgTripMin', label: 'Avg trip time (min)', short: 'Avg trip' },
  { key: 'tripCount', label: 'Trips', short: 'Trips' },
  { key: 'precipMm', label: 'Precipitation (mm)', short: 'Precip' },
  { key: 'tempC', label: 'Temperature (°C)', short: 'Temp' },
] as const;

function splomValue(d: ScatterDayPoint, key: SplomMetricKey): number {
  switch (key) {
    case 'avgTripMin': return d.avgTripMin;
    case 'tripCount': return d.tripCount;
    case 'precipMm': return d.precipMm;
    case 'tempC': return d.tempC;
  }
}

function splomDomainForMetric(key: SplomMetricKey, data: ScatterDayPoint[]): [number, number] {
  switch (key) {
    case 'precipMm': {
      const ex = d3.extent(data, dd => dd.precipMm) as [number | undefined, number | undefined];
      const lo = Math.min(0, ex[0] ?? 0);
      const hi = Math.max(ex[1] ?? 0, lo + 1e-3);
      return [lo, hi];
    }
    case 'tempC': {
      const lo = d3.min(data, dd => dd.tempC) ?? 0;
      const hi = d3.max(data, dd => dd.tempC) ?? 0;
      if (hi <= lo) return [lo - 1, hi + 1];
      const pad = (hi - lo) * 0.06;
      return [lo - pad, hi + pad];
    }
    case 'tripCount': {
      const hi = Math.max(d3.max(data, dd => dd.tripCount) ?? 1, 1);
      return [0, hi];
    }
    case 'avgTripMin': {
      const hi = Math.max(d3.max(data, dd => dd.avgTripMin) ?? 1, 1e-3);
      return [0, hi * 1.06];
    }
  }
}

function splomTickFormat(key: SplomMetricKey): (n: number | { valueOf(): number }) => string {
  return (n) => {
    const v = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(v)) return '';
    if (key === 'tripCount') return fmtTripAxis(v);
    if (key === 'avgTripMin') return fmtMinAxis(v);
    return d3.format('~g')(v);
  };
}

function splomTooltipText(d: ScatterDayPoint): string {
  return `${d.date}: ${d.precipMm.toFixed(1)} mm precip · ${d.tempC.toFixed(1)} °C · ${fmtTripAxis(d.tripCount)} trips · ${d.avgTripMin.toFixed(1)} min avg trip · ${CTX_LABELS[d.ctx as 0 | 1 | 2 | 3]}`;
}

function paintWhenSplomPanel(
  gs: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>,
  sw: number,
  sh: number,
  scatterData: ScatterDayPoint[],
  scatterEl: HTMLElement,
): void {
  const marginSc = { top: 28, right: 18, bottom: 48, left: 56 };
  const innerWs = Math.max(80, sw - marginSc.left - marginSc.right);
  const innerHs = Math.max(80, sh - marginSc.top - marginSc.bottom);
  const defs = gs.append('defs');
  const n = scatterData.length;

  if (n === 0) {
    gs.append('text')
      .attr('x', innerWs / 2)
      .attr('y', innerHs / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#9ca3af')
      .attr('font-size', 12)
      .text('No weather overlap — run export-weather and prepare:data');
    return;
  }

  whenScatterDotFillBase = Math.min(0.4, Math.max(0.1, 52 / Math.sqrt(n)));
  const expandedDotR = Math.max(1.5, Math.min(3.2, 150 / Math.sqrt(n)));

  const ex = splomExpanded;
  if (ex && ex.row >= 0 && ex.row < 4 && ex.col >= 0 && ex.col < 4 && ex.row !== ex.col) {
    const xKey = SPLOM_METRICS[ex.col].key;
    const yKey = SPLOM_METRICS[ex.row].key;
    const xDom = splomDomainForMetric(xKey, scatterData);
    const yDom = splomDomainForMetric(yKey, scatterData);
    const xS = d3.scaleLinear().domain(xDom).nice().range([0, innerWs]);
    const yS = d3.scaleLinear().domain(yDom).nice().range([innerHs, 0]);
    const clipId = 'when-splom-expanded-clip';
    defs.append('clipPath').attr('id', clipId).append('rect').attr('width', innerWs).attr('height', innerHs);

    gs.append('g').attr('class', 'grid')
      .call(d3.axisLeft(yS).ticks(5).tickSize(-innerWs).tickFormat(() => ''))
      .call(ax => {
        ax.select('.domain').remove();
        ax.selectAll('.tick line').attr('stroke', '#f3f4f6').attr('stroke-dasharray', '3,3');
      });

    const plotClip = gs.append('g').attr('class', 'when-splom-expanded-plot').attr('clip-path', `url(#${clipId})`);
    plotClip.selectAll<SVGCircleElement, ScatterDayPoint>('circle.when-splom-full-dot')
      .data(scatterData)
      .join('circle')
      .attr('class', 'when-splom-full-dot')
      .attr('cx', d => xS(splomValue(d, xKey)))
      .attr('cy', d => yS(splomValue(d, yKey)))
      .attr('r', expandedDotR)
      .attr('fill', '#1d4ed8')
      .attr('fill-opacity', whenScatterDotFillBase)
      .attr('stroke', 'none')
      .style('pointer-events', 'none');

    const tree = d3.quadtree<ScatterDayPoint>()
      .x(d => xS(splomValue(d, xKey)))
      .y(d => yS(splomValue(d, yKey)))
      .addAll(scatterData);

    plotClip.append('rect')
      .attr('width', innerWs)
      .attr('height', innerHs)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', function (ev) {
        if (!whenScatterTooltip || !scatterEl) return;
        const [mx, my] = d3.pointer(ev, this);
        const hit = tree.find(mx, my, 22);
        if (!hit) {
          whenScatterTooltip.style.opacity = '0';
          return;
        }
        whenScatterTooltip.textContent = splomTooltipText(hit);
        whenScatterTooltip.style.opacity = '1';
        const cr = scatterEl.getBoundingClientRect();
        whenScatterTooltip.style.left = `${ev.clientX - cr.left + 10}px`;
        whenScatterTooltip.style.top = `${ev.clientY - cr.top - 36}px`;
        clampAbsoluteTooltipToContainer(whenScatterTooltip, scatterEl, TOOLTIP_PAD);
      })
      .on('mouseout', () => {
        if (whenScatterTooltip) whenScatterTooltip.style.opacity = '0';
      });

    const xFmt = splomTickFormat(xKey);
    const yFmt = splomTickFormat(yKey);
    gs.append('g').attr('class', 'y-axis').call(
      d3.axisLeft(yS).ticks(5).tickFormat(d => (typeof d === 'number' && Number.isFinite(d) ? yFmt(d) : '')),
    ).call(ax => {
      ax.selectAll('text').attr('font-size', 11).attr('fill', '#4b5563');
      ax.select('.domain').remove();
      ax.selectAll('.tick line').attr('stroke', '#e5e7eb');
    });
    gs.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${innerHs})`)
      .call(d3.axisBottom(xS).ticks(6).tickFormat(d => (typeof d === 'number' && Number.isFinite(d) ? xFmt(d) : '')))
      .call(ax => {
        ax.selectAll('text').attr('font-size', 11).attr('fill', '#4b5563');
        ax.select('.domain').attr('stroke', '#d1d5db');
      });
    gs.append('text').attr('x', innerWs / 2).attr('y', innerHs + 40).attr('text-anchor', 'middle')
      .attr('fill', '#6b7280').attr('font-size', 11).text(SPLOM_METRICS[ex.col].label);
    gs.append('text').attr('transform', 'rotate(-90)').attr('x', -innerHs / 2).attr('y', -44).attr('text-anchor', 'middle')
      .attr('fill', '#6b7280').attr('font-size', 11).text(SPLOM_METRICS[ex.row].label);
    return;
  }

  const marginMx = { top: 2, right: 4, bottom: 20, left: 24 };
  const mxOuterW = Math.max(40, innerWs - marginMx.left - marginMx.right);
  const mxOuterH = Math.max(40, innerHs - marginMx.top - marginMx.bottom);
  const cellW = mxOuterW / 4;
  const cellH = mxOuterH / 4;
  const matrixDotR = Math.max(0.45, Math.min(2.2, 0.065 * Math.min(cellW, cellH)));
  whenSplomMatrixDotFillBase = Math.min(0.34, Math.max(0.06, 32 / Math.sqrt(n)));

  const gmx = gs.append('g').attr('class', 'when-splom-matrix').attr('transform', `translate(${marginMx.left},${marginMx.top})`);

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const cell = gmx.append('g').attr('class', `splom-cell splom-r${r}-c${c}`).attr('transform', `translate(${c * cellW},${r * cellH})`);
      if (r === c) {
        cell.append('text')
          .attr('x', cellW / 2)
          .attr('y', cellH / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', Math.max(7, Math.min(10, cellW * 0.09)))
          .attr('fill', '#6b7280')
          .attr('font-weight', '600')
          .text(SPLOM_METRICS[r].short);
        continue;
      }
      const xKey = SPLOM_METRICS[c].key;
      const yKey = SPLOM_METRICS[r].key;
      const xDom = splomDomainForMetric(xKey, scatterData);
      const yDom = splomDomainForMetric(yKey, scatterData);
      const xS = d3.scaleLinear().domain(xDom).nice().range([1.5, cellW - 1.5]);
      const yS = d3.scaleLinear().domain(yDom).nice().range([cellH - 1.5, 1.5]);
      const clipId = `splom-c-${r}-${c}`;
      defs.append('clipPath').attr('id', clipId).append('rect').attr('width', cellW).attr('height', cellH);

      const plotG = cell.append('g').attr('clip-path', `url(#${clipId})`);
      plotG.selectAll<SVGCircleElement, ScatterDayPoint>('circle.when-splom-cell-dot')
        .data(scatterData)
        .join('circle')
        .attr('class', 'when-splom-cell-dot')
        .attr('cx', d => xS(splomValue(d, xKey)))
        .attr('cy', d => yS(splomValue(d, yKey)))
        .attr('r', matrixDotR)
        .attr('fill', '#1d4ed8')
        .attr('fill-opacity', whenSplomMatrixDotFillBase)
        .attr('stroke', 'none')
        .style('pointer-events', 'none');

      const tree = d3.quadtree<ScatterDayPoint>()
        .x(d => xS(splomValue(d, xKey)))
        .y(d => yS(splomValue(d, yKey)))
        .addAll(scatterData);

      const hitSlop = Math.min(14, Math.max(6, matrixDotR * 4));
      plotG.append('rect')
        .attr('width', cellW)
        .attr('height', cellH)
        .attr('fill', 'transparent')
        .style('cursor', 'zoom-in')
        .on('mousemove', function (ev) {
          if (!whenScatterTooltip || !scatterEl) return;
          const [mx, my] = d3.pointer(ev, this);
          const hit = tree.find(mx, my, hitSlop);
          if (!hit) {
            whenScatterTooltip.style.opacity = '0';
            return;
          }
          whenScatterTooltip.textContent = splomTooltipText(hit);
          whenScatterTooltip.style.opacity = '1';
          const cr = scatterEl.getBoundingClientRect();
          whenScatterTooltip.style.left = `${ev.clientX - cr.left + 10}px`;
          whenScatterTooltip.style.top = `${ev.clientY - cr.top - 36}px`;
          clampAbsoluteTooltipToContainer(whenScatterTooltip, scatterEl, TOOLTIP_PAD);
        })
        .on('mouseout', () => {
          if (whenScatterTooltip) whenScatterTooltip.style.opacity = '0';
        })
        .on('click', (ev) => {
          ev.stopPropagation();
          splomExpanded = { row: r, col: c };
          if (splomBackBtn) splomBackBtn.style.display = 'block';
          scheduleWhenScatterSplomPaint({ fade: true });
        });

      cell.append('rect')
        .attr('width', cellW)
        .attr('height', cellH)
        .attr('fill', 'none')
        .attr('stroke', '#e5e7eb')
        .attr('stroke-width', 0.6)
        .style('pointer-events', 'none');
    }
  }

  gs.append('text')
    .attr('x', innerWs / 2)
    .attr('y', innerHs + 32)
    .attr('text-anchor', 'middle')
    .attr('fill', '#9ca3af')
    .attr('font-size', 9)
    .text('Click a panel to enlarge · Esc or Back returns');

  const legG = gs.append('g').attr('class', 'when-scatter-legend').attr('transform', `translate(${innerWs - 118}, 2)`);
  legG.append('circle').attr('cx', 5).attr('cy', 7).attr('r', 2.5).attr('fill', '#1d4ed8').attr('fill-opacity', 0.32);
  legG.append('text').attr('x', 14).attr('y', 10).attr('font-size', 8).attr('fill', '#6b7280').text('One day = one dot');
  legG.append('text').attr('x', 14).attr('y', 20).attr('font-size', 8).attr('fill', '#6b7280').text('Overlap reads darker');
}

/** Weekend stroke in the hourly-by-hour panel (weekday stays `CTX_COLORS[0]` blue). */
const HOURLY_WEEKEND_STROKE = CTX_COLORS[3];

function paintWhenHourlySection(
  prepared: WhenRidingPrepared,
  hourlyDims: { w: number; h: number },
  opts: WhenRidingInitOptions,
): void {
  const { hourlyWdDepartures, hourlyWeDepartures, hourlyTripProfile } = prepared;
  const useTripHourly = hourlyTripProfile != null;
  const marginH = {
    top: useTripHourly ? 22 : 10,
    right: useTripHourly ? 48 : 12,
    bottom: useTripHourly ? 44 : 36,
    left: useTripHourly ? 46 : 40,
  };
  const hw = hourlyDims.w;
  const hh = hourlyDims.h;
  const innerWh = Math.max(120, hw - marginH.left - marginH.right);
  const innerHh = Math.max(48, hh - marginH.top - marginH.bottom);

  whenHourlySvg = d3.select(opts.hourlySvg)
    .attr('viewBox', `0 0 ${hw} ${hh}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('width', '100%')
    .attr('height', '100%');
  whenHourlySvg.selectAll('*').remove();
  const gh = whenHourlySvg.append('g').attr('class', 'when-hourly-g').attr('transform', `translate(${marginH.left},${marginH.top})`);

  const xh = d3.scaleLinear().domain([0, 23]).range([0, innerWh]);

  if (useTripHourly && hourlyTripProfile) {
    const p = hourlyTripProfile;
    const maxDurH = Math.max(
      d3.max(p.weekday_duration_min_avg_daily) ?? 0,
      d3.max(p.weekend_duration_min_avg_daily) ?? 0,
      1e-6,
    );
    const maxTripH = Math.max(
      d3.max(p.weekday_trips_avg_daily) ?? 0,
      d3.max(p.weekend_trips_avg_daily) ?? 0,
      1e-6,
    );
    const yhL = d3.scaleLinear().domain([0, maxDurH * 1.08]).range([innerHh, 0]);
    const yhR = d3.scaleLinear().domain([0, maxTripH * 1.08]).range([innerHh, 0]);

    gh.append('g').attr('class', 'grid-hourly')
      .call(d3.axisLeft(yhL).ticks(4).tickSize(-innerWh).tickFormat(() => ''))
      .call(ax => {
        ax.select('.domain').remove();
        ax.selectAll('.tick line').attr('stroke', '#f3f4f6').attr('stroke-dasharray', '3,3');
      });

    const lineWdDur = d3.line<number>()
      .x((_, i) => xh(i))
      .y(d => yhL(d))
      .curve(d3.curveMonotoneX);
    const lineWeDur = d3.line<number>()
      .x((_, i) => xh(i))
      .y(d => yhL(d))
      .curve(d3.curveMonotoneX);
    const lineWdTrip = d3.line<number>()
      .x((_, i) => xh(i))
      .y(d => yhR(d))
      .curve(d3.curveMonotoneX);
    const lineWeTrip = d3.line<number>()
      .x((_, i) => xh(i))
      .y(d => yhR(d))
      .curve(d3.curveMonotoneX);

    gh.append('path').datum(p.weekday_duration_min_avg_daily).attr('fill', 'none')
      .attr('stroke', CTX_COLORS[0]).attr('stroke-width', 2.2).attr('d', lineWdDur);
    gh.append('path').datum(p.weekend_duration_min_avg_daily).attr('fill', 'none')
      .attr('stroke', HOURLY_WEEKEND_STROKE).attr('stroke-width', 2.2).attr('d', lineWeDur);

    const tripDash = '6 4';
    gh.append('path').datum(p.weekday_trips_avg_daily).attr('fill', 'none')
      .attr('stroke', CTX_COLORS[0]).attr('stroke-opacity', 0.88).attr('stroke-width', 1.9)
      .attr('stroke-dasharray', tripDash).attr('d', lineWdTrip);
    gh.append('path').datum(p.weekend_trips_avg_daily).attr('fill', 'none')
      .attr('stroke', HOURLY_WEEKEND_STROKE).attr('stroke-opacity', 0.88).attr('stroke-width', 1.9)
      .attr('stroke-dasharray', tripDash).attr('d', lineWeTrip);

    gh.append('g').attr('class', 'y-axis').call(
      d3.axisLeft(yhL).ticks(4).tickFormat(d => (typeof d === 'number' && Number.isFinite(d) ? fmtMinAxis(d) : '')),
    ).call(ax => {
      ax.selectAll('text').attr('font-size', 9).attr('fill', '#4b5563');
      ax.select('.domain').remove();
      ax.selectAll('.tick line').attr('stroke', '#e5e7eb');
    });
    gh.append('g').attr('class', 'y-axis-right').attr('transform', `translate(${innerWh},0)`)
      .call(
        d3.axisRight(yhR).ticks(3).tickFormat(d => (typeof d === 'number' && Number.isFinite(d) ? fmtTripAxis(d) : '')),
      ).call(ax => {
        ax.selectAll('text').attr('font-size', 9).attr('fill', '#64748b');
        ax.select('.domain').remove();
        ax.selectAll('.tick line').attr('stroke', '#e5e7eb');
      });

    gh.append('text').attr('transform', 'rotate(-90)').attr('x', -innerHh / 2).attr('y', -36).attr('text-anchor', 'middle')
      .attr('fill', '#6b7280').attr('font-size', 9).text('Riding min / day');
    gh.append('text')
      .attr('transform', `translate(${innerWh + 30},${innerHh / 2}) rotate(90)`)
      .attr('text-anchor', 'middle')
      .attr('fill', '#64748b').attr('font-size', 9).text('Trips / day');

    const legDual = gh.append('g').attr('transform', `translate(${Math.max(4, innerWh - 132)}, 2)`);
    legDual.append('line').attr('x1', 0).attr('x2', 14).attr('y1', 0).attr('y2', 0).attr('stroke', CTX_COLORS[0]).attr('stroke-width', 2);
    legDual.append('text').attr('x', 18).attr('y', 3).attr('font-size', 8).attr('fill', '#374151').text('Weekday time');
    legDual.append('line').attr('x1', 0).attr('x2', 14).attr('y1', 10).attr('y2', 10).attr('stroke', HOURLY_WEEKEND_STROKE).attr('stroke-width', 2);
    legDual.append('text').attr('x', 18).attr('y', 13).attr('font-size', 8).attr('fill', '#374151').text('Weekend time');
    legDual.append('line').attr('x1', 72).attr('x2', 86).attr('y1', 0).attr('y2', 0).attr('stroke', CTX_COLORS[0]).attr('stroke-opacity', 0.88).attr('stroke-dasharray', tripDash).attr('stroke-width', 1.9);
    legDual.append('text').attr('x', 90).attr('y', 3).attr('font-size', 8).attr('fill', '#64748b').text('Weekday trips');
    legDual.append('line').attr('x1', 72).attr('x2', 86).attr('y1', 10).attr('y2', 10).attr('stroke', HOURLY_WEEKEND_STROKE).attr('stroke-opacity', 0.88).attr('stroke-dasharray', tripDash).attr('stroke-width', 1.9);
    legDual.append('text').attr('x', 90).attr('y', 13).attr('font-size', 8).attr('fill', '#64748b').text('Weekend trips');
  } else {
    const maxH = Math.max(d3.max(hourlyWdDepartures) ?? 0, d3.max(hourlyWeDepartures) ?? 0, 1e-6);
    const yh = d3.scaleLinear().domain([0, maxH * 1.08]).range([innerHh, 0]);
    const lineWd = d3.line<number>()
      .x((_, i) => xh(i))
      .y(d => yh(d))
      .curve(d3.curveMonotoneX);
    const lineWe = d3.line<number>()
      .x((_, i) => xh(i))
      .y(d => yh(d))
      .curve(d3.curveMonotoneX);

    if (hourlyWdDepartures.length === 24 && hourlyWeDepartures.length === 24) {
      gh.append('path').datum(hourlyWdDepartures).attr('fill', 'none').attr('stroke', CTX_COLORS[0]).attr('stroke-width', 2.2)
        .attr('d', lineWd);
      gh.append('path').datum(hourlyWeDepartures).attr('fill', 'none').attr('stroke', HOURLY_WEEKEND_STROKE).attr('stroke-width', 2.2)
        .attr('d', lineWe);
    } else {
      gh.append('text').attr('x', innerWh / 2).attr('y', innerHh / 2).attr('text-anchor', 'middle')
        .attr('fill', '#9ca3af').attr('font-size', 11).text('No hourly profile — run npm run prepare:cycling-hourly (or station export)');
    }

    gh.append('g').attr('class', 'y-axis').call(
      d3.axisLeft(yh).ticks(3).tickFormat(d => (+d).toFixed(0)),
    ).call(ax => {
      ax.selectAll('text').attr('font-size', 10).attr('fill', '#4b5563');
      ax.select('.domain').remove();
      ax.selectAll('.tick line').attr('stroke', '#e5e7eb');
    });

    const legH = gh.append('g').attr('transform', `translate(${Math.max(4, innerWh - 120)}, 4)`);
    legH.append('line').attr('x1', 0).attr('x2', 18).attr('y1', 0).attr('y2', 0).attr('stroke', CTX_COLORS[0]).attr('stroke-width', 2);
    legH.append('text').attr('x', 22).attr('y', 4).attr('font-size', 9).attr('fill', '#374151').text('Weekday');
    legH.append('line').attr('x1', 0).attr('x2', 18).attr('y1', 14).attr('y2', 14).attr('stroke', HOURLY_WEEKEND_STROKE).attr('stroke-width', 2);
    legH.append('text').attr('x', 22).attr('y', 18).attr('font-size', 9).attr('fill', '#374151').text('Weekend');
  }

  gh.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${innerHh})`)
    .call(d3.axisBottom(xh).ticks(12).tickFormat(d3.format('d')))
    .call(ax => {
      ax.selectAll('text').attr('font-size', 10).attr('fill', '#4b5563');
      ax.select('.domain').attr('stroke', '#d1d5db');
    });

  gh.append('text').attr('x', innerWh / 2).attr('y', innerHh + (useTripHourly ? 34 : 26)).attr('text-anchor', 'middle')
    .attr('fill', '#6b7280').attr('font-size', 10).text(
      useTripHourly
        ? 'Hour of day (trip start, Oslo) · solid = riding min/day; dashed = trips/day (right scale)'
        : 'Hour of day (start) · summed avg departures / station-day',
    );
}

function paintWhenRidingCharts(prepared: WhenRidingPrepared, dims: WhenRidingPanelDims, opts: WhenRidingInitOptions): void {
  const dom = whenRidingDom;
  if (!dom) return;

  const { buckets, pivot, maxBarMinutes, maxBarTrips, scatterData } = prepared;
  const { barsEl, scatterEl } = dom;

  const marginBars = { top: 48, right: 12, bottom: 68, left: 56 };
  const bw = dims.bars.w;
  const bh = dims.bars.h;
  const innerW = Math.max(80, bw - marginBars.left - marginBars.right);
  const innerH = Math.max(80, bh - marginBars.top - marginBars.bottom);

  whenBarsSvg = d3.select(opts.barsSvg)
    .attr('viewBox', `0 0 ${bw} ${bh}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('width', '100%')
    .attr('height', '100%');
  whenBarsSvg.selectAll('*').remove();
  const gb = whenBarsSvg.append('g').attr('class', 'when-bars-g').attr('transform', `translate(${marginBars.left},${marginBars.top})`);

  const x0 = d3.scaleBand<string>().domain(buckets).range([0, innerW]).padding(0.22);
  const x1 = d3.scaleBand<number>().domain([0, 1, 2, 3]).range([0, x0.bandwidth()]).padding(0.08);
  const maxBar = whenBarsMetricMode === 'minutes' ? maxBarMinutes : maxBarTrips;
  const yb = d3.scaleLinear().domain([0, maxBar * 1.06]).range([innerH, 0]);
  const yTickFmt = (v: number): string =>
    whenBarsMetricMode === 'minutes' ? fmtMinAxis(v) : fmtTripAxis(v);

  gb.append('g').attr('class', 'y-axis').call(
    d3.axisLeft(yb).ticks(5).tickFormat(d => (typeof d === 'number' && Number.isFinite(d) ? yTickFmt(d) : '')),
  ).call(ax => {
    ax.selectAll('text').attr('font-size', 11).attr('fill', '#4b5563');
    ax.select('.domain').remove();
    ax.selectAll('.tick line').attr('stroke', '#e5e7eb');
  });
  gb.append('g').attr('class', 'grid')
    .call(d3.axisLeft(yb).ticks(5).tickSize(-innerW).tickFormat(() => ''))
    .call(ax => {
      ax.select('.domain').remove();
      ax.selectAll('.tick line').attr('stroke', '#f3f4f6').attr('stroke-dasharray', '3,3');
    });
  const xAxisG = gb.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x0).tickSizeOuter(0));
  xAxisG.selectAll<SVGGElement, string>('.tick').attr('transform', d => {
    const x = x0(d);
    return `translate(${(x ?? 0) + x0.bandwidth() / 2},0)`;
  });
  xAxisG.selectAll('.tick text')
    .attr('transform', null)
    .attr('text-anchor', 'middle')
    .each(function (d) {
      const key = String(d);
      const el = d3.select(this);
      el.text(null);
      el.append('tspan').attr('x', 0).attr('dy', '0.71em').attr('fill', '#374151').attr('font-size', 10)
        .text(bucketDisplayName(key));
      const span = bucketHourSpanLabel(key);
      if (span) {
        el.append('tspan').attr('x', 0).attr('dy', '1.15em').attr('fill', '#6b7280').attr('font-size', 9)
          .text(span);
      }
    });
  xAxisG.select('.domain').attr('stroke', '#d1d5db');
  gb.append('text').attr('x', innerW / 2).attr('y', innerH + 54).attr('text-anchor', 'middle')
    .attr('fill', '#6b7280').attr('font-size', 11).text('Time-of-day bucket (trip start, Oslo)');
  gb.append('text')
    .attr('class', 'when-bars-y-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2)
    .attr('y', -44)
    .attr('text-anchor', 'middle')
    .attr('fill', '#6b7280')
    .attr('font-size', 11)
    .text(
      whenBarsMetricMode === 'minutes' ? 'Avg riding minutes / day in bucket' : 'Trips / day in bucket',
    );

  whenBarsYDomainHigh = maxBar * 1.06;

  const whenBarLegendApproxW = 218;
  const leg = gb.append('g')
    .attr('class', 'when-bar-legend')
    .attr('transform', `translate(${Math.max(0, (innerW - whenBarLegendApproxW) / 2)}, -36)`);
  CTX_LABELS.forEach((lab, i) => {
    const row = leg.append('g').attr('transform', `translate(${i % 2 === 0 ? 0 : 118}, ${Math.floor(i / 2) * 14})`);
    row.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', CTX_COLORS[i]);
    row.append('text').attr('x', 14).attr('y', 9).attr('font-size', 9).attr('fill', '#374151').text(lab);
  });

  const bucketGs = gb.selectAll<SVGGElement, typeof pivot[0]>('g.bucket')
    .data(pivot)
    .join('g')
    .attr('class', 'bucket')
    .attr('transform', d => `translate(${x0(d.bucket) ?? 0},0)`);

  bucketGs.selectAll<SVGRectElement, { value: number; ctx: number; bucket: string }>('rect.ctx-bar')
    .data(d => {
      const arr = whenBarsMetricMode === 'minutes' ? d.minutes : d.tripsPerDay;
      return arr.map((v, i) => ({ value: v, ctx: i, bucket: d.bucket }));
    })
    .join('rect')
    .attr('class', d => `ctx-bar ctx-${d.ctx}`)
    .attr('x', d => x1(d.ctx) ?? 0)
    .attr('width', x1.bandwidth())
    // Sync geometry: `updateWhenRiding()` animates opacity on the same rects and would interrupt bar tweens.
    .attr('y', d => yb(d.value))
    .attr('height', d => innerH - yb(d.value))
    .attr('fill', d => CTX_COLORS[d.ctx] ?? '#94a3b8')
    .attr('rx', 2)
    .attr('stroke', 'none')
    .style('cursor', 'crosshair')
    .on('mouseover', function (_ev, d) {
      d3.select(this).attr('stroke', '#111827').attr('stroke-width', 1.5);
      if (whenBarTooltip) {
        const v = d.value;
        const label = whenBarsMetricMode === 'minutes'
          ? (v >= 120 ? `${(v / 60).toFixed(1)} h/day` : `${v.toFixed(0)} min/day`)
          : (v >= 1000 ? `${fmtTripAxis(v)} trips/day` : `${v.toFixed(0)} trips/day`);
        whenBarTooltip.textContent = `${bucketDisplayName(d.bucket)} · ${CTX_LABELS[d.ctx as 0 | 1 | 2 | 3]}: ${label}`;
        whenBarTooltip.style.opacity = '1';
      }
    })
    .on('mousemove', function (ev) {
      if (!whenBarTooltip || !barsEl) return;
      const cr = barsEl.getBoundingClientRect();
      whenBarTooltip.style.left = `${ev.clientX - cr.left + 12}px`;
      whenBarTooltip.style.top = `${ev.clientY - cr.top - 28}px`;
      clampAbsoluteTooltipToContainer(whenBarTooltip, barsEl, TOOLTIP_PAD);
    })
    .on('mouseout', function () {
      d3.select(this).attr('stroke', 'none').attr('stroke-width', 0);
      if (whenBarTooltip) whenBarTooltip.style.opacity = '0';
    });

  syncWhenBarsToggleUi();

  // Scatter (SPLOM: precip, temp, trips, avg trip — matrix + expand)
  const marginSc = { top: 28, right: 18, bottom: 48, left: 56 };
  const sw = dims.scatter.w;
  const sh = dims.scatter.h;

  whenScatterSvg = d3.select(opts.scatterSvg)
    .attr('viewBox', `0 0 ${sw} ${sh}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('width', '100%')
    .attr('height', '100%');
  whenScatterSvg.selectAll('*').remove();
  const scatterOuter = whenScatterSvg
    .append('g')
    .attr('class', 'when-scatter-g')
    .attr('transform', `translate(${marginSc.left},${marginSc.top})`);
  const splomInner = scatterOuter.append('g').attr('class', 'when-splom-inner').attr('opacity', 1);

  paintWhenSplomPanel(splomInner, sw, sh, scatterData, scatterEl);

  if (splomBackBtn) {
    splomBackBtn.style.display = scatterData.length > 0 && splomExpanded ? 'block' : 'none';
    splomBackBtn.setAttribute('aria-expanded', splomExpanded ? 'true' : 'false');
  }

  paintWhenHourlySection(prepared, dims.hourly, opts);
}

const SPL_FADE_OUT_MS = 140;
const SPL_FADE_IN_MS = 220;

function whenChapterActiveStep(): number {
  const whenStepEl = document.querySelector<HTMLElement>('#ch-when .vs-step.is-active[data-chapter="when"]');
  return whenStepEl ? Number(whenStepEl.dataset.step ?? 0) : 0;
}

/** Repaint only the scatter SPLOM (no bars / hourly). Optional crossfade on inner content. */
function scheduleWhenScatterSplomPaint(opts: { fade: boolean }): void {
  const prepared = whenRidingPrepared;
  const dom = whenRidingDom;
  const useOpts = whenRidingLastOpts;
  if (!prepared || !dom || !useOpts) return;

  const { scatterEl } = dom;
  const scatterDims = readPanelRect(scatterEl, WHEN_PANEL_MIN, WHEN_PANEL_MIN);
  const sw = scatterDims.w;
  const sh = scatterDims.h;
  const { scatterData } = prepared;

  whenScatterSvg = d3.select(useOpts.scatterSvg);
  const outer = whenScatterSvg.select<SVGGElement>('g.when-scatter-g');
  const inner = outer.select<SVGGElement>('g.when-splom-inner');
  if (outer.empty() || inner.empty()) {
    scheduleWhenRidingPaint();
    return;
  }

  whenScatterSvg
    .attr('viewBox', `0 0 ${sw} ${sh}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('width', '100%')
    .attr('height', '100%');

  const syncSplomBackBtn = (): void => {
    if (splomBackBtn) {
      splomBackBtn.style.display = scatterData.length > 0 && splomExpanded ? 'block' : 'none';
      splomBackBtn.setAttribute('aria-expanded', splomExpanded ? 'true' : 'false');
    }
  };

  const doPaint = (): void => {
    inner.selectAll('*').remove();
    paintWhenSplomPanel(inner, sw, sh, scatterData, scatterEl);
    syncSplomBackBtn();
  };

  if (!opts.fade) {
    doPaint();
    updateWhenRiding(whenChapterActiveStep());
    return;
  }

  inner.interrupt();
  inner
    .attr('opacity', 1)
    .transition()
    .duration(SPL_FADE_OUT_MS)
    .attr('opacity', 0)
    .on('end', () => {
      doPaint();
      inner.attr('opacity', 0);
      inner
        .transition()
        .duration(SPL_FADE_IN_MS)
        .ease(d3.easeCubicOut)
        .attr('opacity', 1)
        .on('end', () => {
          updateWhenRiding(whenChapterActiveStep());
        });
    });
}

function scheduleWhenRidingPaint(opts?: WhenRidingInitOptions): void {
  if (opts) whenRidingLastOpts = opts;
  const useOpts = whenRidingLastOpts;
  const prepared = whenRidingPrepared;
  const dom = whenRidingDom;
  if (!prepared || !dom || !useOpts) return;

  const dims: WhenRidingPanelDims = {
    bars: readPanelRect(dom.barsEl, WHEN_PANEL_MIN, WHEN_PANEL_MIN),
    scatter: readPanelRect(dom.scatterEl, WHEN_PANEL_MIN, WHEN_PANEL_MIN),
    hourly: readPanelRect(dom.hourlyEl, WHEN_PANEL_MIN, WHEN_HOURLY_MIN_H),
  };
  paintWhenRidingCharts(prepared, dims, useOpts);
  whenRidingLastBarsScatterDims = { bars: dims.bars, scatter: dims.scatter };

  updateWhenRiding(whenChapterActiveStep());
}

/** Debounced resize: full paint unless only the hourly panel changed size (e.g. step 3 reveals hourly row). */
function scheduleWhenRidingResizePaint(): void {
  const prepared = whenRidingPrepared;
  const dom = whenRidingDom;
  const useOpts = whenRidingLastOpts;
  if (!prepared || !dom || !useOpts) return;

  const dims: WhenRidingPanelDims = {
    bars: readPanelRect(dom.barsEl, WHEN_PANEL_MIN, WHEN_PANEL_MIN),
    scatter: readPanelRect(dom.scatterEl, WHEN_PANEL_MIN, WHEN_PANEL_MIN),
    hourly: readPanelRect(dom.hourlyEl, WHEN_PANEL_MIN, WHEN_HOURLY_MIN_H),
  };
  const last = whenRidingLastBarsScatterDims;
  if (
    last &&
    whenPanelBoxDimsApproxEqual(dims.bars, last.bars) &&
    whenPanelBoxDimsApproxEqual(dims.scatter, last.scatter)
  ) {
    paintWhenHourlySection(prepared, dims.hourly, useOpts);
    updateWhenRiding(whenChapterActiveStep());
    return;
  }
  scheduleWhenRidingPaint();
}

export function initWhenRiding(opts: WhenRidingInitOptions): void {
  const barsEl = document.querySelector<HTMLElement>(opts.barsSvg)?.parentElement;
  const scatterEl = document.querySelector<HTMLElement>(opts.scatterSvg)?.parentElement;
  const hourlyEl = document.querySelector<HTMLElement>(opts.hourlySvg)?.parentElement;
  whenHourlyRowEl = document.querySelector(opts.hourlyRow);
  whenFootnoteEl = document.querySelector(opts.footnoteEl);
  whenHintEl = document.querySelector(opts.hintEl);

  if (!barsEl || !scatterEl || !hourlyEl) return;

  whenBarsMetricMode = 'minutes';
  splomExpanded = null;
  if (splomBackBtn) splomBackBtn.style.display = 'none';

  if (whenRidingResizeObserver) {
    whenRidingResizeObserver.disconnect();
    whenRidingResizeObserver = null;
  }
  if (whenRidingResizeDebounce) {
    clearTimeout(whenRidingResizeDebounce);
    whenRidingResizeDebounce = null;
  }
  whenRidingLastBarsScatterDims = null;

  whenRidingLastOpts = opts;
  whenRidingPrepared = prepareWhenRidingData(opts);
  whenRidingDom = { barsEl, scatterEl, hourlyEl };

  if (whenFootnoteEl) {
    if (opts.hourlyRidingProfile?.norm_definition) {
      whenFootnoteEl.textContent = opts.hourlyRidingProfile.norm_definition;
    } else if (opts.stationInOut?.month_label) {
      whenFootnoteEl.textContent = `Hourly chart: all stations summed · calendar month ${opts.stationInOut.month_label} (avg departures per day in that month).`;
    } else {
      whenFootnoteEl.textContent =
        'Hourly chart: run npm run prepare:cycling-hourly after trips_with_context.parquet exists, or export_station_in_out_month.py for station-only fallback.';
    }
  }

  barsEl.style.position = 'relative';
  scatterEl.style.position = 'relative';

  if (whenBarTooltip?.parentElement === barsEl) {
    whenBarTooltip.remove();
  }
  whenBarTooltip = document.createElement('div');
  Object.assign(whenBarTooltip.style, {
    position: 'absolute', pointerEvents: 'none', opacity: '0', zIndex: '20',
    background: 'rgba(255,255,255,0.97)', border: '1px solid #e5e7eb', borderRadius: '6px',
    padding: '4px 8px', fontSize: '11px', fontWeight: '600', color: '#111827', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  });
  barsEl.appendChild(whenBarTooltip);

  barsEl.querySelector('.when-bars-metric-toggle')?.remove();
  whenBarsToggleMinutesBtn = null;
  whenBarsToggleTripsBtn = null;

  {
    const wrap = document.createElement('div');
    wrap.className = 'when-bars-metric-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Bar chart: riding minutes or trips per calendar day in each start-time bucket');
    Object.assign(wrap.style, {
      position: 'absolute',
      top: '6px',
      left: '6px',
      zIndex: '25',
      display: 'flex',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      overflow: 'hidden',
      background: 'rgba(255,255,255,0.97)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    });
    const btnStyle: Partial<CSSStyleDeclaration> = {
      fontSize: '11px',
      fontWeight: '600',
      padding: '4px 10px',
      border: 'none',
      cursor: 'pointer',
      color: '#1e293b',
      background: '#ffffff',
      fontFamily: 'inherit',
    };
    whenBarsToggleMinutesBtn = document.createElement('button');
    whenBarsToggleMinutesBtn.type = 'button';
    whenBarsToggleMinutesBtn.textContent = 'Minutes';
    Object.assign(whenBarsToggleMinutesBtn.style, btnStyle, { borderRight: '1px solid #e5e7eb' });
    whenBarsToggleMinutesBtn.addEventListener('click', () => {
      if (whenBarsMetricMode === 'minutes') return;
      const from = whenBarsMetricMode;
      whenBarsMetricMode = 'minutes';
      syncWhenBarsToggleUi();
      transitionWhenBarsMetric(from);
    });
    whenBarsToggleTripsBtn = document.createElement('button');
    whenBarsToggleTripsBtn.type = 'button';
    whenBarsToggleTripsBtn.textContent = 'Trips';
    Object.assign(whenBarsToggleTripsBtn.style, btnStyle);
    whenBarsToggleTripsBtn.addEventListener('click', () => {
      if (whenBarsMetricMode === 'trips') return;
      const from = whenBarsMetricMode;
      whenBarsMetricMode = 'trips';
      syncWhenBarsToggleUi();
      transitionWhenBarsMetric(from);
    });
    wrap.appendChild(whenBarsToggleMinutesBtn);
    wrap.appendChild(whenBarsToggleTripsBtn);
    barsEl.appendChild(wrap);
  }
  syncWhenBarsToggleUi();

  if (whenScatterTooltip?.parentElement === scatterEl) {
    whenScatterTooltip.remove();
  }
  whenScatterTooltip = document.createElement('div');
  Object.assign(whenScatterTooltip.style, {
    position: 'absolute', pointerEvents: 'none', opacity: '0', zIndex: '20',
    background: 'rgba(255,255,255,0.97)', border: '1px solid #e5e7eb', borderRadius: '6px',
    padding: '4px 8px', fontSize: '11px', fontWeight: '600', color: '#111827', maxWidth: '280px', lineHeight: '1.35',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  });
  scatterEl.appendChild(whenScatterTooltip);

  if (!splomBackBtn) {
    splomBackBtn = document.createElement('button');
    splomBackBtn.type = 'button';
    splomBackBtn.className = 'when-splom-back-btn';
    splomBackBtn.textContent = 'Back to matrix';
    splomBackBtn.setAttribute('aria-label', 'Back to scatter matrix');
    Object.assign(splomBackBtn.style, {
      position: 'absolute',
      top: '6px',
      right: '8px',
      zIndex: '25',
      display: 'none',
      fontSize: '11px',
      fontWeight: '600',
      padding: '4px 10px',
      borderRadius: '6px',
      border: '1px solid #e5e7eb',
      background: 'rgba(255,255,255,0.98)',
      color: '#1e293b',
      cursor: 'pointer',
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    });
    splomBackBtn.addEventListener('click', () => {
      splomExpanded = null;
      if (splomBackBtn) splomBackBtn.style.display = 'none';
      scheduleWhenScatterSplomPaint({ fade: true });
    });
    scatterEl.appendChild(splomBackBtn);
  }

  if (!splomKeydownBound) {
    splomKeydownBound = true;
    document.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !splomExpanded) return;
      splomExpanded = null;
      if (splomBackBtn) splomBackBtn.style.display = 'none';
      scheduleWhenScatterSplomPaint({ fade: true });
    });
  }

  const runPaint = () => scheduleWhenRidingPaint();

  requestAnimationFrame(() => {
    requestAnimationFrame(runPaint);
  });

  whenRidingResizeObserver = new ResizeObserver(() => {
    if (whenRidingResizeDebounce) clearTimeout(whenRidingResizeDebounce);
    whenRidingResizeDebounce = setTimeout(() => scheduleWhenRidingResizePaint(), WHEN_RESIZE_DEBOUNCE_MS);
  });
  whenRidingResizeObserver.observe(barsEl);
  whenRidingResizeObserver.observe(scatterEl);
  whenRidingResizeObserver.observe(hourlyEl);
}

export function updateWhenRiding(step: number): void {
  if (whenBarTooltip) whenBarTooltip.style.opacity = '0';
  if (whenScatterTooltip) whenScatterTooltip.style.opacity = '0';

  if (whenHourlyRowEl) {
    whenHourlyRowEl.classList.toggle('is-visible', step === 3);
  }
  if (whenFootnoteEl) {
    whenFootnoteEl.style.display = step === 3 ? 'block' : 'none';
  }

  if (whenHintEl) {
    const hints = [
      'Left chart: use Minutes / Trips (top-left) to switch bar height. Hover bars for details. Right: 4×4 scatter matrix; hover a cell; click to enlarge.',
      'Compare the four bar colours: weekday vs weekend, with Norwegian public holidays called out.',
      'Right panel: matrix of daily pairs — each dot is one day; click a panel to expand; Esc or Back returns. Hover shows nearest day (same-day network stats; association, not causation).',
      'Bottom: trip starts by hour — solid lines = riding min/day; dashed lines = trips/day (same dash, right-hand scale).',
    ];
    whenHintEl.textContent = hints[Math.min(step, hints.length - 1)] ?? hints[0];
  }

  if (!whenBarsSvg) return;

  // Bar opacities by context
  const barOpacityForCtx = (ctx: number): number => {
    if (step === 0) return ctx === 0 ? 1 : 0.34;
    if (step === 1) return 1;
    if (step === 2) return 0.55;
    return 0.42;
  };

  whenBarsSvg.selectAll<SVGRectElement, { value: number; ctx: number; bucket: string }>('rect.ctx-bar')
    .transition()
    .duration(450)
    .attr('opacity', d => barOpacityForCtx(d.ctx));

  whenBarsSvg.select('.when-bar-legend').transition().duration(400).attr('opacity', step === 0 ? 1 : 0.88);

  const scatterPanelOp = step <= 1 ? 0.28 : step === 2 ? 1 : 0.48;
  whenScatterSvg?.select('.when-scatter-g').transition().duration(450).attr('opacity', scatterPanelOp);

  const dotFillMul = step <= 1 ? 0.58 : step === 2 ? 1.12 : 0.78;
  whenScatterSvg?.selectAll<SVGCircleElement, unknown>('circle.when-splom-cell-dot')
    .transition()
    .duration(450)
    .attr('fill-opacity', Math.min(0.5, whenSplomMatrixDotFillBase * dotFillMul));
  whenScatterSvg?.selectAll<SVGCircleElement, unknown>('circle.when-splom-full-dot')
    .transition()
    .duration(450)
    .attr('fill-opacity', Math.min(0.55, whenScatterDotFillBase * dotFillMul));

  whenHourlySvg?.select('.when-hourly-g').transition().duration(400).attr('opacity', step === 3 ? 1 : 0.35);
}

// ── Chapter 3: Station balance map ────────────────────────────────────────────

let balanceMap: Leaflet.Map | null = null;
let balanceMarkers = new Map<string, Leaflet.CircleMarker>();
let balanceStations: StationDatum[] = [];
let balanceColorFn: (v: number) => string = () => '#94a3b8';
let balanceRadii = new Map<string, number>();
let topDepartHub: StationDatum | null = null;
let topArriveHub: StationDatum | null = null;
let balanceStep = -1;
let balanceHome: MapHomeView | null = null;
let balanceProgrammatic = false;
let balanceResetBtn: HTMLButtonElement | null = null;

function updateBalanceResetVisibility(): void {
  if (!balanceMap || !balanceResetBtn || !balanceHome) return;
  const away = !balanceProgrammatic && mapDiffersFromHome(balanceMap, balanceHome);
  balanceResetBtn.disabled = !away;
  balanceResetBtn.title = away
    ? 'Restore zoom and pan to this story step’s map view'
    : 'Zoom and pan match this step — use after you move the map';
}

function applyBalanceMarkerStyle(id: string): void {
  const s = balanceStations.find(st => st.id === id);
  const cm = balanceMarkers.get(id);
  if (!s || !cm) return;
  const net = (s.trips_as_origin ?? 0) - (s.trips_as_dest ?? 0);
  const isDepart = balanceStep >= 2 && s.id === topDepartHub?.id;
  const isArrive = balanceStep >= 3 && s.id === topArriveHub?.id;
  const radius = balanceRadii.get(id) ?? 6;
  cm.setStyle({
    fillColor: balanceStep === 0 ? '#94a3b8' : balanceColorFn(net),
    fillOpacity: balanceStep === 0 ? 0.5 : (isDepart || isArrive) ? 1 : 0.82,
    color: (isDepart || isArrive) ? '#1e293b' : '#fff',
    weight: (isDepart || isArrive) ? 2.5 : 0.8,
  });
  cm.setRadius((isDepart || isArrive) ? radius + 4 : radius);
}

export async function initBalanceMap(containerId: string, stations: StationDatum[]): Promise<void> {
  const L = (await import('leaflet')).default;
  const el = document.getElementById(containerId);
  if (!el) return;

  balanceStations = stations.filter(s => s.lat && s.lon);

  const netValues = balanceStations.map(s => (s.trips_as_origin ?? 0) - (s.trips_as_dest ?? 0));
  const absMax = Math.max(d3.max(netValues.map(v => Math.abs(v))) ?? 1, 1);
  balanceColorFn = d3.scaleDiverging<string>(d3.interpolateRdBu).domain([-absMax, 0, absMax]);

  const sizeScale = d3.scaleSqrt()
    .domain([0, d3.max(balanceStations, s => (s.trips_as_origin ?? 0) + (s.trips_as_dest ?? 0)) ?? 1])
    .range([4, 20]);

  topDepartHub = [...balanceStations].sort((a, b) =>
    ((b.trips_as_origin ?? 0) - (b.trips_as_dest ?? 0)) - ((a.trips_as_origin ?? 0) - (a.trips_as_dest ?? 0))
  )[0] ?? null;
  topArriveHub = [...balanceStations].sort((a, b) =>
    ((a.trips_as_origin ?? 0) - (a.trips_as_dest ?? 0)) - ((b.trips_as_origin ?? 0) - (b.trips_as_dest ?? 0))
  )[0] ?? null;

  balanceMap = L.map(el, { zoomControl: true, scrollWheelZoom: false, attributionControl: false });
  L.tileLayer(LIGHT_TILE, { maxZoom: 19, attribution: CARTO_ATTR }).addTo(balanceMap);
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(balanceMap);
  balanceMap.setView([59.918, 10.745], 12);
  balanceHome = captureMapHome(balanceMap);
  installMapTooltipClamp(balanceMap);

  balanceMap.on('moveend zoomend', () => {
    if (balanceProgrammatic) return;
    updateBalanceResetVisibility();
  });

  const wrap = el.parentElement;
  if (wrap) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'viz-map-reset';
    btn.textContent = 'Reset zoom & pan';
    btn.addEventListener('click', () => {
      if (!balanceMap || !balanceHome || balanceProgrammatic) return;
      if (!mapDiffersFromHome(balanceMap, balanceHome)) return;
      balanceProgrammatic = true;
      updateBalanceResetVisibility();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        balanceMap!.off('moveend', finish);
        balanceHome = captureMapHome(balanceMap!);
        balanceProgrammatic = false;
        updateBalanceResetVisibility();
      };
      balanceMap.setView([balanceHome.lat, balanceHome.lng], balanceHome.zoom, { animate: true });
      balanceMap.once('moveend', finish);
      window.setTimeout(finish, 1100);
    });
    wrap.appendChild(btn);
    balanceResetBtn = btn;
  }

  for (const s of balanceStations) {
    const net = (s.trips_as_origin ?? 0) - (s.trips_as_dest ?? 0);
    const total = (s.trips_as_origin ?? 0) + (s.trips_as_dest ?? 0);
    const radius = sizeScale(total);
    balanceRadii.set(s.id, radius);
    const cm = L.circleMarker([s.lat, s.lon], {
      radius, fillColor: '#94a3b8', fillOpacity: 0.82, color: '#fff', weight: 0.8,
    });
    const sign = net >= 0 ? '+' : '';
    cm.bindTooltip(
      `<strong>${s.name}</strong><br/>` +
      `Departures: ${(s.trips_as_origin ?? 0).toLocaleString()}<br/>` +
      `Arrivals: ${(s.trips_as_dest ?? 0).toLocaleString()}<br/>` +
      `Net: <strong>${sign}${net.toLocaleString()}</strong>`,
      { direction: 'auto' }
    );
    cm.addTo(balanceMap);
    balanceMarkers.set(s.id, cm);

    const sid = s.id;
    cm.on('mouseover', () => {
      d3.select((cm as unknown as { _path: SVGPathElement })._path).interrupt();
      cm.setStyle({ fillOpacity: 1, color: '#1e293b', weight: 2 });
      cm.setRadius((balanceRadii.get(sid) ?? 6) + 4);
    });
    cm.on('mouseout', () => {
      d3.select((cm as unknown as { _path: SVGPathElement })._path).interrupt();
      applyBalanceMarkerStyle(sid);
    });
  }

  // Color legend
  const legendEl = document.getElementById('balance-legend');
  if (legendEl) {
    const svg = d3.select(legendEl).append('svg').attr('width', 260).attr('height', 46);
    const grad = svg.append('defs').append('linearGradient').attr('id', 'bal-grad').attr('x1', '0%').attr('x2', '100%');
    for (let i = 0; i <= 20; i++) {
      grad.append('stop').attr('offset', `${i * 5}%`).attr('stop-color', balanceColorFn(-absMax + (i / 20) * 2 * absMax));
    }
    svg.append('rect').attr('x', 0).attr('y', 4).attr('width', 260).attr('height', 16).attr('rx', 3)
      .attr('fill', 'url(#bal-grad)').attr('stroke', '#e5e7eb');
    svg.append('text').attr('x', 0).attr('y', 42).attr('font-size', 13).attr('fill', '#1f2937').text('← More arrivals');
    svg.append('text').attr('x', 260).attr('y', 42).attr('font-size', 13).attr('fill', '#1f2937').attr('text-anchor', 'end').text('More departures →');
  }
}

export function updateBalanceMap(step: number): void {
  if (!balanceMap) return;
  balanceMap.invalidateSize();

  const prevStep = balanceStep;
  balanceStep = step;

  for (const [id, cm] of balanceMarkers) {
    const s = balanceStations.find(st => st.id === id);
    if (!s) continue;
    const net = (s.trips_as_origin ?? 0) - (s.trips_as_dest ?? 0);
    const isDepart = step >= 2 && s.id === topDepartHub?.id;
    const isArrive = step >= 3 && s.id === topArriveHub?.id;
    const radius = balanceRadii.get(id) ?? 6;

    const pathEl = (cm as unknown as { _path: SVGPathElement })._path;
    d3.select(pathEl)
      .interrupt()
      .transition().duration(480).ease(d3.easeQuadInOut)
      .attr('fill', step === 0 ? '#94a3b8' : balanceColorFn(net))
      .attr('fill-opacity', step === 0 ? 0.5 : (isDepart || isArrive) ? 1 : 0.82)
      .attr('stroke', (isDepart || isArrive) ? '#1e293b' : '#fff')
      .attr('stroke-width', (isDepart || isArrive) ? 2.5 : 0.8);

    cm.setRadius((isDepart || isArrive) ? radius + 4 : radius);
  }

  if (step === 2 && topDepartHub) {
    if (prevStep !== 2) {
      balanceProgrammatic = true;
      balanceMap.flyTo([topDepartHub.lat, topDepartHub.lon], 14, { duration: 1.2 });
      attachHomeCaptureWhenMoveEnds(balanceMap, h => { balanceHome = h; }, () => { balanceProgrammatic = false; });
    }
    balanceMarkers.get(topDepartHub.id)?.openTooltip();
  } else if (step === 3 && topArriveHub) {
    if (prevStep !== 3) {
      balanceProgrammatic = true;
      balanceMap.flyTo([topArriveHub.lat, topArriveHub.lon], 14, { duration: 1.2 });
      attachHomeCaptureWhenMoveEnds(balanceMap, h => { balanceHome = h; }, () => { balanceProgrammatic = false; });
    }
    balanceMarkers.get(topArriveHub.id)?.openTooltip();
  } else if (step < 2 && prevStep >= 2) {
    const allLatLngs: [number, number][] = balanceStations.map(s => [s.lat, s.lon]);
    balanceProgrammatic = true;
    balanceMap.flyToBounds(allLatLngs, { padding: [24, 24], duration: 1 });
    attachHomeCaptureWhenMoveEnds(balanceMap, h => { balanceHome = h; }, () => { balanceProgrammatic = false; });
  }

  updateBalanceResetVisibility();
}

// ── Chapter 4: Routes map ─────────────────────────────────────────────────────

const TEAL = '#10b981';

interface RouteViz { line: Leaflet.Polyline; route: RouteData; distanceM: number; totalHours: number }

let routesMap: Leaflet.Map | null = null;
let routeVizItems: RouteViz[] = [];
let routesStep = -1;
let routesHome: MapHomeView | null = null;
let routesProgrammatic = false;
let routesResetBtn: HTMLButtonElement | null = null;

function updateRoutesResetVisibility(): void {
  if (!routesMap || !routesResetBtn || !routesHome) return;
  const away = !routesProgrammatic && mapDiffersFromHome(routesMap, routesHome);
  routesResetBtn.disabled = !away;
  routesResetBtn.title = away
    ? 'Restore zoom and pan to this story step’s map view'
    : 'Zoom and pan match this step — use after you move the map';
}

export async function initRoutesMap(
  containerId: string,
  stations: StationDatum[],
  routes: RouteData[],
  routeCounts?: Map<string, number>
): Promise<void> {
  const L = (await import('leaflet')).default;
  const el = document.getElementById(containerId);
  if (!el) return;

  const stationById = new Map(stations.map(s => [s.id, s]));

  routesMap = L.map(el, { zoomControl: true, scrollWheelZoom: false, attributionControl: false });
  L.tileLayer(LIGHT_TILE, { maxZoom: 19, attribution: CARTO_ATTR }).addTo(routesMap);
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(routesMap);
  routesMap.setView([59.918, 10.745], 12);
  routesHome = captureMapHome(routesMap);
  installMapTooltipClamp(routesMap);

  routesMap.on('moveend zoomend', () => {
    if (routesProgrammatic) return;
    updateRoutesResetVisibility();
  });

  const wrap = el.parentElement;
  if (wrap) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'viz-map-reset';
    btn.textContent = 'Reset zoom & pan';
    btn.addEventListener('click', () => {
      if (!routesMap || !routesHome || routesProgrammatic) return;
      if (!mapDiffersFromHome(routesMap, routesHome)) return;
      routesProgrammatic = true;
      updateRoutesResetVisibility();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        routesMap!.off('moveend', finish);
        routesHome = captureMapHome(routesMap!);
        routesProgrammatic = false;
        updateRoutesResetVisibility();
      };
      routesMap.setView([routesHome.lat, routesHome.lng], routesHome.zoom, { animate: true });
      routesMap.once('moveend', finish);
      window.setTimeout(finish, 1100);
    });
    wrap.appendChild(btn);
    routesResetBtn = btn;
  }

  const validRoutes = routes.filter(r => r.encodedPolyline && r.distance_m != null);
  validRoutes.sort((a, b) => (a.distance_m ?? 9999) - (b.distance_m ?? 9999));

  // Station dot markers (only for stations appearing in valid routes)
  const seenIds = new Set<string>();
  for (const r of validRoutes) {
    for (const sid of [r.origin_id, r.dest_id]) {
      if (seenIds.has(sid)) continue;
      seenIds.add(sid);
      const s = stationById.get(sid);
      if (s) {
        L.circleMarker([s.lat, s.lon], {
          radius: 4, fillColor: '#374151', fillOpacity: 0.85, color: '#fff', weight: 1,
        })
          .on('mouseover', function () { this.setStyle({ fillColor: AMBER, fillOpacity: 1 }); this.setRadius(6); })
          .on('mouseout', function () { this.setStyle({ fillColor: '#374151', fillOpacity: 0.85 }); this.setRadius(4); })
          .bindTooltip(s.name, { direction: 'auto' })
          .addTo(routesMap);
      }
    }
  }

  // Route polylines
  for (const route of validRoutes) {
    const pts = decodePolyline(route.encodedPolyline!);
    const line = L.polyline(pts, { color: '#94a3b8', weight: 2, opacity: 0.35 });
    const originName = stationById.get(route.origin_id)?.name ?? route.origin_id;
    const destName = stationById.get(route.dest_id)?.name ?? route.dest_id;
    const km = ((route.distance_m ?? 0) / 1000).toFixed(1);
    const min = Math.round((route.duration_sec ?? 0) / 60);

    // Total hours = trip_count × duration_sec / 3600 (try both directions for undirected key)
    const keyFwd = `${route.origin_id}|${route.dest_id}`;
    const keyRev = `${route.dest_id}|${route.origin_id}`;
    const count = Number(routeCounts?.get(keyFwd) ?? routeCounts?.get(keyRev) ?? 0);
    const totalHours = count * (route.duration_sec ?? 0) / 3600;

    const totalHoursStr = totalHours >= 1000
      ? `${(totalHours / 1000).toFixed(1)}k hrs`
      : `${Math.round(totalHours)} hrs`;
    line.bindTooltip(
      `${originName} → ${destName}<br/>${km} km · ~${min} min by bike` +
      (count > 0 ? `<br/>${count.toLocaleString()} trips · ${totalHoursStr} total` : ''),
      { direction: 'auto', sticky: true }
    );

    let resting: { color: string; weight: number; opacity: number } | null = null;
    line.on('mouseover', function () {
      resting = { color: String(this.options.color), weight: Number(this.options.weight), opacity: Number(this.options.opacity) };
      this.setStyle({ color: AMBER, weight: Math.max(resting.weight, 3) + 1.5, opacity: 1 });
    });
    line.on('mouseout', function () { if (resting) this.setStyle(resting); });

    line.addTo(routesMap);
    routeVizItems.push({ line, route, distanceM: route.distance_m ?? 9999, totalHours });
  }

}

export function updateRoutesMap(step: number): void {
  if (!routesMap) return;
  routesMap.invalidateSize();

  const prevStep = routesStep;
  routesStep = step;
  const TOP_N = 12;

  // For step 3: rank by totalHours descending
  let topByTime: Set<RouteViz> | null = null;
  if (step === 3) {
    const sorted = [...routeVizItems].sort((a, b) => b.totalHours - a.totalHours);
    topByTime = new Set(sorted.slice(0, TOP_N));
  }

  for (const [i, item] of routeVizItems.entries()) {
    const isTopDist = i < TOP_N;
    const isTopTime = topByTime?.has(item) ?? false;
    if (step === 0) {
      item.line.setStyle({ color: '#94a3b8', weight: 2, opacity: 0.35 });
    } else if (step === 1) {
      item.line.setStyle({ color: isTopDist ? AMBER : '#94a3b8', weight: isTopDist ? 4 : 1.5, opacity: isTopDist ? 0.85 : 0.18 });
    } else if (step === 2) {
      item.line.setStyle({ color: isTopDist ? AMBER : '#94a3b8', weight: isTopDist ? 4 : 1, opacity: isTopDist ? 0.9 : 0.1 });
    } else {
      // step 3: highlight top routes by total hours in teal
      item.line.setStyle({ color: isTopTime ? TEAL : '#94a3b8', weight: isTopTime ? 4 : 1, opacity: isTopTime ? 0.9 : 0.08 });
    }
  }

  if (step === 3 && prevStep !== 3 && routesMap && topByTime) {
    const pts: [number, number][] = [...topByTime].flatMap(it =>
      (it.line.getLatLngs() as Leaflet.LatLng[]).map(ll => [ll.lat, ll.lng] as [number, number])
    );
    if (pts.length > 0) {
      routesProgrammatic = true;
      routesMap.flyToBounds(pts, { padding: [48, 48], duration: 1.2 });
      attachHomeCaptureWhenMoveEnds(routesMap, h => { routesHome = h; }, () => { routesProgrammatic = false; });
    }
  } else if ((step === 1 || step === 2) && (prevStep < 1 || prevStep === 3) && routesMap) {
    const pts: [number, number][] = routeVizItems.slice(0, TOP_N).flatMap(it =>
      (it.line.getLatLngs() as Leaflet.LatLng[]).map(ll => [ll.lat, ll.lng] as [number, number])
    );
    if (pts.length > 0) {
      routesProgrammatic = true;
      routesMap.flyToBounds(pts, { padding: [48, 48], duration: 1.2 });
      attachHomeCaptureWhenMoveEnds(routesMap, h => { routesHome = h; }, () => { routesProgrammatic = false; });
    }
  } else if (step === 0 && prevStep >= 1 && routesMap) {
    const allPts: [number, number][] = routeVizItems.flatMap(it =>
      (it.line.getLatLngs() as Leaflet.LatLng[]).map(ll => [ll.lat, ll.lng] as [number, number])
    );
    if (allPts.length > 0) {
      routesProgrammatic = true;
      routesMap.flyToBounds(allPts, { padding: [32, 32], duration: 1 });
      attachHomeCaptureWhenMoveEnds(routesMap, h => { routesHome = h; }, () => { routesProgrammatic = false; });
    }
  }

  updateRoutesResetVisibility();
}
