import * as d3 from 'd3';
import type { AvgTripTimeByMonthRow, RouteData } from '../../data/prepared-data-types.js';
import type * as Leaflet from 'leaflet';

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

// ── Hero map ──────────────────────────────────────────────────────────────────

export async function initHeroMap(containerId: string, stations: StationDatum[]): Promise<void> {
  const L = (await import('leaflet')).default;
  const el = document.getElementById(containerId);
  if (!el) return;

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
    ax.selectAll('text').attr('font-size', 13).attr('fill', '#374151');
    ax.select('.domain').attr('stroke', '#d1d5db');
    ax.selectAll('.tick line').attr('stroke', '#d1d5db');
  };

  g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${yearH})`)
    .call(d3.axisBottom(yearX)).call(axStyle);
  g.append('g').attr('class', 'y-axis')
    .call(d3.axisLeft(yearY).ticks(5).tickFormat(d => `${(+d / 1_000_000).toFixed(1)}M`))
    .call(ax => { ax.selectAll('text').attr('font-size', 12).attr('fill', '#6b7280'); ax.select('.domain').remove(); ax.selectAll('.tick line').attr('stroke', '#e5e7eb'); });
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(yearY).ticks(5).tickSize(-W).tickFormat(() => ''))
    .call(ax => { ax.select('.domain').remove(); ax.selectAll('.tick line').attr('stroke', '#f3f4f6').attr('stroke-dasharray', '3,3'); });

  g.append('text').attr('x', W / 2).attr('y', yearH + 48).attr('text-anchor', 'middle').attr('fill', '#9ca3af').attr('font-size', 12).text('Year');
  g.append('text').attr('transform', 'rotate(-90)').attr('x', -yearH / 2).attr('y', -58).attr('text-anchor', 'middle').attr('fill', '#9ca3af').attr('font-size', 12).text('Total trips');

  g.selectAll<SVGRectElement, YearRow>('rect.bar')
    .data(yearData, d => String(d.year)).join('rect').attr('class', 'bar')
    .attr('x', d => yearX(String(d.year)) ?? 0).attr('y', yearH)
    .attr('width', yearX.bandwidth()).attr('height', 0).attr('fill', MUTED).attr('rx', 4);

  g.selectAll<SVGTextElement, YearRow>('text.bar-label')
    .data(yearData, d => String(d.year)).join('text').attr('class', 'bar-label')
    .attr('x', d => (yearX(String(d.year)) ?? 0) + yearX.bandwidth() / 2)
    .attr('y', yearH - 6).attr('text-anchor', 'middle').attr('font-size', 12).attr('opacity', 0)
    .text(d => `${(d.trips / 1_000_000).toFixed(2)}M`);
}

export function updateYearlyChart(step: number): void {
  const activeYear = yearData[step]?.year;
  const g = yearSvg.select<SVGGElement>('.chart-g');
  g.selectAll<SVGRectElement, YearRow>('rect.bar').transition().duration(480)
    .attr('y', d => yearY(d.trips)).attr('height', d => yearH - yearY(d.trips))
    .attr('fill', d => d.year === activeYear ? AMBER : MUTED)
    .attr('opacity', d => d.year === activeYear ? 1 : 0.55);
  g.selectAll<SVGTextElement, YearRow>('text.bar-label').transition().duration(480)
    .attr('y', d => yearY(d.trips) - 8)
    .attr('opacity', d => d.year === activeYear ? 1 : 0)
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
    .call(ax => { ax.selectAll('text').attr('font-size', 12).attr('fill', '#374151'); ax.select('.domain').attr('stroke', '#d1d5db'); ax.selectAll('.tick line').attr('stroke', '#d1d5db'); });
  g.append('g').attr('class', 'y-axis')
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d => `${(+d / 1000).toFixed(0)}k`))
    .call(ax => { ax.selectAll('text').attr('font-size', 12).attr('fill', '#6b7280'); ax.select('.domain').remove(); ax.selectAll('.tick line').attr('stroke', '#e5e7eb'); });
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

  g.append('text').attr('x', W / 2).attr('y', H + 48).attr('text-anchor', 'middle').attr('fill', '#9ca3af').attr('font-size', 12).text('Month');
  g.append('text').attr('transform', 'rotate(-90)').attr('x', -H / 2).attr('y', -58).attr('text-anchor', 'middle').attr('fill', '#9ca3af').attr('font-size', 12).text('Trips per month');

  const legendG = g.append('g').attr('transform', `translate(${W - 68}, 8)`);
  legendG.append('rect').attr('width', 64).attr('height', seasonYears.length * 20 + 12).attr('rx', 6)
    .attr('fill', 'rgba(249,250,251,0.92)').attr('stroke', '#e5e7eb');
  seasonYears.forEach((yr, i) => {
    const row = legendG.append('g').attr('class', `legend-year-${yr}`).attr('transform', `translate(8, ${12 + i * 20})`);
    row.append('line').attr('x1', 0).attr('x2', 18).attr('stroke', SEASON_PALETTE[i % SEASON_PALETTE.length]).attr('stroke-width', 2.5).attr('stroke-linecap', 'round');
    row.append('text').attr('x', 22).attr('dy', '0.35em').attr('font-size', 11).attr('fill', '#374151').text(yr);
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

  // Dot circles — one per data point, per year
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
          seasonTooltipEl.textContent = `${monthAbbr[d.month - 1]} ${d.year}: ${d.trip_count.toLocaleString()} trips`;
          seasonTooltipEl.style.color = color;
          seasonTooltipEl.style.left = `${screen.x - cr.left + 12}px`;
          seasonTooltipEl.style.top = `${screen.y - cr.top - 40}px`;
          seasonTooltipEl.style.opacity = '1';
        }
      })
      .on('mouseout', function () {
        d3.select(this).attr('r', 4);
        if (seasonTooltipEl) seasonTooltipEl.style.opacity = '0';
      });
  }
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

// ── Chapter 3: Station balance map ────────────────────────────────────────────

let balanceMap: Leaflet.Map | null = null;
let balanceMarkers = new Map<string, Leaflet.CircleMarker>();
let balanceStations: StationDatum[] = [];
let balanceColorFn: (v: number) => string = () => '#94a3b8';
let balanceRadii = new Map<string, number>();
let topDepartHub: StationDatum | null = null;
let topArriveHub: StationDatum | null = null;
let balanceStep = -1;

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
      { direction: 'top' }
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
    const svg = d3.select(legendEl).append('svg').attr('width', 210).attr('height', 36);
    const grad = svg.append('defs').append('linearGradient').attr('id', 'bal-grad').attr('x1', '0%').attr('x2', '100%');
    for (let i = 0; i <= 20; i++) {
      grad.append('stop').attr('offset', `${i * 5}%`).attr('stop-color', balanceColorFn(-absMax + (i / 20) * 2 * absMax));
    }
    svg.append('rect').attr('x', 0).attr('y', 4).attr('width', 210).attr('height', 14).attr('rx', 3)
      .attr('fill', 'url(#bal-grad)').attr('stroke', '#e5e7eb');
    svg.append('text').attr('x', 0).attr('y', 32).attr('font-size', 10).attr('fill', '#6b7280').text('← More arrivals');
    svg.append('text').attr('x', 210).attr('y', 32).attr('font-size', 10).attr('fill', '#6b7280').attr('text-anchor', 'end').text('More departures →');
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
    if (prevStep !== 2) balanceMap.flyTo([topDepartHub.lat, topDepartHub.lon], 14, { duration: 1.2 });
    balanceMarkers.get(topDepartHub.id)?.openTooltip();
  } else if (step === 3 && topArriveHub) {
    if (prevStep !== 3) balanceMap.flyTo([topArriveHub.lat, topArriveHub.lon], 14, { duration: 1.2 });
    balanceMarkers.get(topArriveHub.id)?.openTooltip();
  } else if (step < 2 && prevStep >= 2) {
    const allLatLngs: [number, number][] = balanceStations.map(s => [s.lat, s.lon]);
    balanceMap.flyToBounds(allLatLngs, { padding: [24, 24], duration: 1 });
  }
}

// ── Chapter 4: Routes map ─────────────────────────────────────────────────────

const TEAL = '#10b981';

interface RouteViz { line: Leaflet.Polyline; route: RouteData; distanceM: number; totalHours: number }

let routesMap: Leaflet.Map | null = null;
let routeVizItems: RouteViz[] = [];
let routesStep = -1;

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
          .bindTooltip(s.name, { direction: 'top' })
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
      { direction: 'top' }
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
    if (pts.length > 0) routesMap.flyToBounds(pts, { padding: [48, 48], duration: 1.2 });
  } else if (step === 2 && prevStep !== 2 && routesMap) {
    const topItems = routeVizItems.slice(0, TOP_N);
    const pts: [number, number][] = topItems.flatMap(it =>
      (it.line.getLatLngs() as Leaflet.LatLng[]).map(ll => [ll.lat, ll.lng] as [number, number])
    );
    if (pts.length > 0) routesMap.flyToBounds(pts, { padding: [48, 48], duration: 1.2 });
  } else if (step < 2 && prevStep >= 2 && routesMap) {
    const allPts: [number, number][] = routeVizItems.flatMap(it =>
      (it.line.getLatLngs() as Leaflet.LatLng[]).map(ll => [ll.lat, ll.lng] as [number, number])
    );
    if (allPts.length > 0) routesMap.flyToBounds(allPts, { padding: [32, 32], duration: 1 });
  }
}
