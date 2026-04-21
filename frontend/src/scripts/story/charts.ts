import * as d3 from 'd3';
import type { AvgTripTimeByMonthRow } from '../../data/prepared-data-types.js';

// ── Shared types ──────────────────────────────────────────────────────────────

export interface StationDatum {
  id: string;
  name: string;
  lat: number;
  lon: number;
  total_trips: number;
  trips_as_origin: number;
  trips_as_dest: number;
  bydel: string;
  elevation_m: number;
}

export interface StationRank {
  station_name: string;
  trip_count: number;
  bydel?: string;
  trips_as_origin?: number;
  trips_as_dest?: number;
}

// ── Chapter 1: Station map ────────────────────────────────────────────────────

let mapSvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
let mapStations: StationDatum[] = [];
let mapProjection: d3.GeoProjection;
let mapSizeScale: d3.ScalePower<number, number>;

export function initMapViz(
  svgSelector: string,
  stations: StationDatum[],
  geo: GeoJSON.FeatureCollection
): void {
  mapStations = stations;
  const container = document.querySelector<HTMLElement>(svgSelector)!.parentElement!;
  const { width, height } = container.getBoundingClientRect();

  mapSvg = d3.select<SVGSVGElement, unknown>(svgSelector)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', '100%');

  mapProjection = d3.geoMercator().fitSize(
    [width, height],
    {
      type: 'FeatureCollection',
      features: stations.map(s => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
        properties: {}
      }))
    }
  );

  const path = d3.geoPath().projection(mapProjection);

  // District outlines
  mapSvg.selectAll<SVGPathElement, GeoJSON.Feature>('path.district')
    .data(geo.features)
    .join('path')
    .attr('class', 'district')
    .attr('d', path)
    .attr('fill', '#e2e8f0')
    .attr('stroke', '#94a3b8')
    .attr('stroke-width', 0.5);

  mapSizeScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.total_trips) ?? 1])
    .range([3, 14]);

  // Station circles — start uniform size
  mapSvg.selectAll<SVGCircleElement, StationDatum>('circle.station')
    .data(stations)
    .join('circle')
    .attr('class', 'station')
    .attr('cx', d => (mapProjection([d.lon, d.lat]) ?? [0, 0])[0])
    .attr('cy', d => (mapProjection([d.lon, d.lat]) ?? [0, 0])[1])
    .attr('r', 4)
    .attr('fill', '#3b82f6')
    .attr('opacity', 0.65)
    .attr('stroke', 'white')
    .attr('stroke-width', 0.5);

  // Tooltip
  const tooltip = d3.select<HTMLElement, unknown>('#map-tooltip');
  mapSvg.selectAll<SVGCircleElement, StationDatum>('circle.station')
    .on('mouseenter', (event: MouseEvent, d: StationDatum) => {
      tooltip
        .style('display', 'block')
        .style('left', `${(event as MouseEvent).pageX + 12}px`)
        .style('top', `${(event as MouseEvent).pageY - 28}px`)
        .html(`<strong>${d.name}</strong><br/>${d.total_trips.toLocaleString()} trips`);
    })
    .on('mouseleave', () => tooltip.style('display', 'none'));
}

export function updateMapViz(step: number): void {
  mapSvg.selectAll<SVGCircleElement, StationDatum>('circle.station')
    .transition().duration(500)
    .attr('r', d => step === 0 ? 4 : mapSizeScale(d.total_trips))
    .attr('opacity', step === 0 ? 0.65 : 0.75);
}

// ── Chapter 2: Yearly bar chart ───────────────────────────────────────────────

interface YearRow { year: number; trips: number }

let yearSvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
let yearData: YearRow[] = [];
let yearX: d3.ScaleBand<string>;
let yearY: d3.ScaleLinear<number, number>;
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];

export function initYearlyChart(
  svgSelector: string,
  rows: AvgTripTimeByMonthRow[]
): void {
  const margin = { top: 30, right: 30, bottom: 50, left: 70 };
  const container = document.querySelector<HTMLElement>(svgSelector)!.parentElement!;
  const { width, height } = container.getBoundingClientRect();
  const W = width - margin.left - margin.right;
  const H = height - margin.top - margin.bottom;

  yearData = YEARS.map(yr => ({
    year: yr,
    trips: d3.sum(rows.filter(r => r.year === yr), r => r.trip_count)
  })).filter(d => d.trips > 0);

  yearSvg = d3.select<SVGSVGElement, unknown>(svgSelector)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', '100%');

  const g = yearSvg.append('g')
    .attr('class', 'chart-g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  yearX = d3.scaleBand<string>()
    .domain(yearData.map(d => String(d.year)))
    .range([0, W])
    .padding(0.3);

  yearY = d3.scaleLinear()
    .domain([0, (d3.max(yearData, d => d.trips) ?? 0) * 1.1])
    .range([H, 0]);

  g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(yearX).tickFormat(d => d));

  g.append('g').attr('class', 'y-axis')
    .call(d3.axisLeft(yearY).ticks(5).tickFormat(d => `${(+d / 1_000_000).toFixed(1)}M`));

  g.append('text').attr('class', 'axis-label')
    .attr('x', W / 2).attr('y', H + 44)
    .attr('text-anchor', 'middle').attr('font-size', 12)
    .text('Year');

  g.append('text').attr('class', 'axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -H / 2).attr('y', -55)
    .attr('text-anchor', 'middle').attr('font-size', 12)
    .text('Total trips');

  // Draw bars at zero height
  g.selectAll<SVGRectElement, YearRow>('rect.bar')
    .data(yearData, d => String(d.year))
    .join('rect')
    .attr('class', 'bar')
    .attr('x', d => yearX(String(d.year)) ?? 0)
    .attr('y', H)
    .attr('width', yearX.bandwidth())
    .attr('height', 0)
    .attr('fill', '#cbd5e1')
    .attr('rx', 3);

  // Count labels
  g.selectAll<SVGTextElement, YearRow>('text.bar-label')
    .data(yearData, d => String(d.year))
    .join('text')
    .attr('class', 'bar-label')
    .attr('x', d => (yearX(String(d.year)) ?? 0) + yearX.bandwidth() / 2)
    .attr('y', H - 4)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('opacity', 0)
    .text(d => `${(d.trips / 1_000_000).toFixed(2)}M`);
}

export function updateYearlyChart(step: number): void {
  const activeYear = yearData[step]?.year;
  const g = yearSvg.select<SVGGElement>('.chart-g');
  const H = +(yearSvg.attr('viewBox').split(' ')[3]) - 80;

  g.selectAll<SVGRectElement, YearRow>('rect.bar')
    .transition().duration(450)
    .attr('y', d => yearY(d.trips))
    .attr('height', d => H - yearY(d.trips))
    .attr('fill', d => d.year === activeYear ? '#3b82f6' : '#cbd5e1')
    .attr('opacity', d => d.year === activeYear ? 1 : 0.45);

  g.selectAll<SVGTextElement, YearRow>('text.bar-label')
    .transition().duration(450)
    .attr('y', d => yearY(d.trips) - 6)
    .attr('opacity', d => d.year === activeYear ? 1 : 0)
    .attr('fill', d => d.year === activeYear ? '#1e40af' : 'currentColor');
}

// ── Chapter 3: Seasonal multi-line ───────────────────────────────────────────

let seasonSvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
let seasonData: Map<number, AvgTripTimeByMonthRow[]>;
let seasonYears: number[];
const seasonColor = d3.scaleOrdinal(d3.schemeTableau10);

export function initSeasonalChart(
  svgSelector: string,
  rows: AvgTripTimeByMonthRow[]
): void {
  const margin = { top: 30, right: 20, bottom: 50, left: 70 };
  const container = document.querySelector<HTMLElement>(svgSelector)!.parentElement!;
  const { width, height } = container.getBoundingClientRect();
  const W = width - margin.left - margin.right;
  const H = height - margin.top - margin.bottom;

  seasonYears = [...new Set(rows.map(r => r.year))].sort();
  seasonColor.domain(seasonYears.map(String));
  seasonData = d3.group(rows, r => r.year);

  seasonSvg = d3.select<SVGSVGElement, unknown>(svgSelector)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', '100%');

  const g = seasonSvg.append('g')
    .attr('class', 'chart-g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const xScale = d3.scaleLinear().domain([1, 12]).range([0, W]);
  const yMax = d3.max(rows, r => r.trip_count) ?? 1;
  const yScale = d3.scaleLinear().domain([0, yMax * 1.05]).range([H, 0]);

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(xScale).ticks(12).tickFormat((_d, i) => monthNames[i]));

  g.append('g').attr('class', 'y-axis')
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d => `${(+d / 1000).toFixed(0)}k`));

  g.append('text').attr('class', 'axis-label')
    .attr('x', W / 2).attr('y', H + 44)
    .attr('text-anchor', 'middle').attr('font-size', 12)
    .text('Month');

  g.append('text').attr('class', 'axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -H / 2).attr('y', -55)
    .attr('text-anchor', 'middle').attr('font-size', 12)
    .text('Trips per month');

  const lineGen = d3.line<AvgTripTimeByMonthRow>()
    .x(d => xScale(d.month))
    .y(d => yScale(d.trip_count))
    .curve(d3.curveMonotoneX);

  // Draw all lines at opacity 0
  for (const yr of seasonYears) {
    const yrRows = (seasonData.get(yr) ?? []).sort((a, b) => a.month - b.month);
    g.append('path')
      .datum(yrRows)
      .attr('class', `season-line year-${yr}`)
      .attr('fill', 'none')
      .attr('stroke', seasonColor(String(yr)))
      .attr('stroke-width', 2)
      .attr('opacity', 0)
      .attr('d', lineGen);
  }

  // Legend — inside top-right of the plot area
  const legendRowH = 22;
  const legendPad = 10;
  const legendW = 70;
  const legendH = seasonYears.length * legendRowH + legendPad * 2;
  const legend = g.append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${W - legendW - 8}, 8)`);

  legend.append('rect')
    .attr('width', legendW + 16)
    .attr('height', legendH)
    .attr('rx', 6)
    .attr('fill', 'rgba(15,23,42,0.72)')
    .attr('stroke', 'rgba(148,163,184,0.3)')
    .attr('stroke-width', 1);

  seasonYears.forEach((yr, i) => {
    const row = legend.append('g')
      .attr('class', `legend-row legend-year-${yr}`)
      .attr('transform', `translate(${legendPad}, ${legendPad + i * legendRowH + legendRowH / 2})`);
    row.append('line')
      .attr('x1', 0).attr('x2', 20)
      .attr('stroke', seasonColor(String(yr)))
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round');
    row.append('text')
      .attr('x', 26).attr('dy', '0.35em')
      .attr('font-size', 13)
      .attr('fill', '#e2e8f0')
      .text(yr);
  });
}

export function updateSeasonalChart(step: number): void {
  const visibleYears = new Set(seasonYears.slice(0, step + 1));
  const activeYear = seasonYears[step];

  seasonSvg.selectAll<SVGPathElement, AvgTripTimeByMonthRow[]>('path.season-line')
    .transition().duration(500)
    .attr('opacity', function (this: SVGPathElement) {
      const cls = this.getAttribute('class') ?? '';
      const yr = Number(cls.match(/year-(\d+)/)?.[1]);
      return visibleYears.has(yr) ? (yr === activeYear ? 1 : 0.3) : 0;
    })
    .attr('stroke-width', function (this: SVGPathElement) {
      const cls = this.getAttribute('class') ?? '';
      const yr = Number(cls.match(/year-(\d+)/)?.[1]);
      return yr === activeYear ? 2.5 : 1.5;
    });

  // Sync legend row opacity with line opacity
  for (const yr of seasonYears) {
    const op = visibleYears.has(yr) ? (yr === activeYear ? 1 : 0.4) : 0.15;
    seasonSvg.select<SVGGElement>(`.legend-year-${yr}`)
      .transition().duration(500)
      .attr('opacity', op);
  }
}

// ── Chapter 4: Top stations horizontal bar ───────────────────────────────────

let stationsSvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
let stationsAllData: StationRank[] = [];
const TOP_N_STEPS = [5, 10, 20];

const stationsTooltip = () => d3.select<HTMLElement, unknown>('#stations-tooltip');

export function initStationsChart(
  svgSelector: string,
  stations: StationRank[]
): void {
  stationsAllData = stations;

  const container = document.querySelector<HTMLElement>(svgSelector)!.parentElement!;
  const { width, height } = container.getBoundingClientRect();

  stationsSvg = d3.select<SVGSVGElement, unknown>(svgSelector)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', '100%');

  stationsSvg.append('g').attr('class', 'chart-g');
  updateStationsChart(0);
}

export function updateStationsChart(step: number): void {
  const topN = TOP_N_STEPS[step] ?? 5;
  const margin = { top: 20, right: 30, bottom: 30, left: 180 };
  const viewBox = stationsSvg.attr('viewBox').split(' ').map(Number);
  const width = viewBox[2];
  const height = viewBox[3];
  const W = width - margin.left - margin.right;
  const rowH = Math.min(28, (height - margin.top - margin.bottom) / topN);
  const H = rowH * topN;

  const visible = stationsAllData.slice(0, topN);
  const g = stationsSvg.select<SVGGElement>('.chart-g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear()
    .domain([0, (d3.max(visible, d => d.trip_count) ?? 1) * 1.1])
    .range([0, W]);

  const y = d3.scaleBand<string>()
    .domain(visible.map(d => d.station_name))
    .range([0, H])
    .padding(0.2);

  // Axes
  g.selectAll('.x-axis').remove();
  g.selectAll('.y-axis').remove();

  g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(x).ticks(4).tickFormat(d => `${(+d / 1000).toFixed(0)}k`));

  g.append('g').attr('class', 'y-axis')
    .call(d3.axisLeft(y).tickSize(0))
    .select('.domain').remove();

  // Bars
  g.selectAll<SVGRectElement, StationRank>('rect.hbar')
    .data(visible, d => d.station_name)
    .join(
      enter => enter.append('rect').attr('class', 'hbar')
        .attr('x', 0)
        .attr('y', d => y(d.station_name) ?? 0)
        .attr('width', 0)
        .attr('height', y.bandwidth())
        .attr('fill', '#3b82f6')
        .attr('rx', 3)
        .call(e => e.transition().duration(500).attr('width', d => x(d.trip_count))),
      update => update.transition().duration(500)
        .attr('y', d => y(d.station_name) ?? 0)
        .attr('width', d => x(d.trip_count))
        .attr('height', y.bandwidth()),
      exit => exit.transition().duration(300).attr('width', 0).remove()
    )
    .on('mouseenter', (event: MouseEvent, d: StationRank) => {
      // Highlight hovered bar
      d3.select<SVGRectElement, StationRank>(event.currentTarget as SVGRectElement)
        .transition().duration(120)
        .attr('fill', '#60a5fa');

      const originPct = d.trips_as_origin != null && d.trip_count > 0
        ? Math.round((d.trips_as_origin / d.trip_count) * 100)
        : null;

      const lines = [
        `<strong>${d.station_name}</strong>`,
        d.bydel ? `<span class="tt-district">${d.bydel}</span>` : '',
        `<span class="tt-row"><span class="tt-label">Total trips</span><span class="tt-value">${d.trip_count.toLocaleString()}</span></span>`,
        d.trips_as_origin != null
          ? `<span class="tt-row"><span class="tt-label">As origin</span><span class="tt-value">${d.trips_as_origin!.toLocaleString()}${originPct != null ? ` (${originPct}%)` : ''}</span></span>`
          : '',
        d.trips_as_dest != null
          ? `<span class="tt-row"><span class="tt-label">As destination</span><span class="tt-value">${d.trips_as_dest!.toLocaleString()}</span></span>`
          : '',
      ].filter(Boolean).join('');

      stationsTooltip()
        .style('display', 'block')
        .style('left', `${event.pageX + 14}px`)
        .style('top', `${event.pageY - 10}px`)
        .html(lines);
    })
    .on('mousemove', (event: MouseEvent) => {
      stationsTooltip()
        .style('left', `${event.pageX + 14}px`)
        .style('top', `${event.pageY - 10}px`);
    })
    .on('mouseleave', (event: MouseEvent) => {
      d3.select<SVGRectElement, StationRank>(event.currentTarget as SVGRectElement)
        .transition().duration(150)
        .attr('fill', '#3b82f6');
      stationsTooltip().style('display', 'none');
    });
}

// ── Chapter 5: Duration dual-line ─────────────────────────────────────────────

let durSvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
let durData: AvgTripTimeByMonthRow[] = [];

export function initDurationChart(
  svgSelector: string,
  rows: AvgTripTimeByMonthRow[]
): void {
  durData = rows.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

  const margin = { top: 30, right: 80, bottom: 50, left: 70 };
  const container = document.querySelector<HTMLElement>(svgSelector)!.parentElement!;
  const { width, height } = container.getBoundingClientRect();
  const W = width - margin.left - margin.right;
  const H = height - margin.top - margin.bottom;

  durSvg = d3.select<SVGSVGElement, unknown>(svgSelector)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', '100%');

  const g = durSvg.append('g')
    .attr('class', 'chart-g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const parseDate = (r: AvgTripTimeByMonthRow) =>
    new Date(r.year, r.month - 1, 1);

  const xScale = d3.scaleTime()
    .domain(d3.extent(rows, parseDate) as [Date, Date])
    .range([0, W]);

  const yDur = d3.scaleLinear()
    .domain([0, (d3.max(rows, r => r.avg_trip_seconds / 60) ?? 20) * 1.1])
    .range([H, 0]);

  const yCount = d3.scaleLinear()
    .domain([0, (d3.max(rows, r => r.trip_count) ?? 1) * 1.1])
    .range([H, 0]);

  g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(xScale).ticks(8).tickFormat(d => d3.timeFormat('%Y')(d as Date)));

  g.append('g').attr('class', 'y-axis-left')
    .call(d3.axisLeft(yDur).ticks(5).tickFormat(d => `${d}m`));

  g.append('g').attr('class', 'y-axis-right').attr('transform', `translate(${W},0)`)
    .call(d3.axisRight(yCount).ticks(5).tickFormat(d => `${(+d / 1000).toFixed(0)}k`));

  // Axis labels
  g.append('text').attr('class', 'axis-label dur-label')
    .attr('transform', 'rotate(-90)').attr('x', -H / 2).attr('y', -55)
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', '#3b82f6')
    .text('Avg duration (min)');

  g.append('text').attr('class', 'axis-label count-label')
    .attr('transform', 'rotate(90)').attr('x', H / 2).attr('y', -(W + 68))
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', '#f59e0b')
    .text('Trip count');

  // Duration line
  const durLine = d3.line<AvgTripTimeByMonthRow>()
    .x(d => xScale(parseDate(d)))
    .y(d => yDur(d.avg_trip_seconds / 60))
    .curve(d3.curveMonotoneX);

  g.append('path').datum(rows.sort((a, b) => parseDate(a).getTime() - parseDate(b).getTime()))
    .attr('class', 'dur-line')
    .attr('fill', 'none')
    .attr('stroke', '#3b82f6')
    .attr('stroke-width', 2)
    .attr('opacity', 0)
    .attr('d', durLine);

  // Count area
  const countArea = d3.area<AvgTripTimeByMonthRow>()
    .x(d => xScale(parseDate(d)))
    .y0(H)
    .y1(d => yCount(d.trip_count))
    .curve(d3.curveMonotoneX);

  g.append('path').datum(rows.sort((a, b) => parseDate(a).getTime() - parseDate(b).getTime()))
    .attr('class', 'count-area')
    .attr('fill', '#f59e0b')
    .attr('opacity', 0)
    .attr('d', countArea);

  // Summer highlight band (June–August) — only for years with actual summer data
  const summerMonths = new Set([6, 7, 8]);
  const years = [...new Set(rows.filter(r => summerMonths.has(r.month)).map(r => r.year))].sort();
  for (const yr of years) {
    const x0 = xScale(new Date(yr, 5, 1));
    const x1 = xScale(new Date(yr, 8, 1));
    g.append('rect').attr('class', 'summer-band')
      .attr('x', x0).attr('y', 0)
      .attr('width', x1 - x0).attr('height', H)
      .attr('fill', '#fef9c3').attr('opacity', 0);
  }
}

export function updateDurationChart(step: number): void {
  const g = durSvg.select('.chart-g');

  if (step >= 0) {
    g.select('.dur-line').transition().duration(500).attr('opacity', 1);
  }
  if (step >= 1) {
    g.select('.count-area').transition().duration(500).attr('opacity', 0.25);
  }
  if (step >= 2) {
    g.selectAll('.summer-band').transition().duration(500).attr('opacity', 0.6);
  } else {
    g.selectAll('.summer-band').transition().duration(300).attr('opacity', 0);
  }
}
