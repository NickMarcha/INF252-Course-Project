import scrollama from 'scrollama';
import * as d3 from 'd3';
import { loadPreparedData } from '../../data/load-prepared-data.js';
import type {
  CyclingDailyNormPoint,
  CyclingDailyNormSeriesData,
  NewsPredictionArticle,
  NewsPredictionArticlesPayload,
} from '../../data/prepared-data-types.js';
import {
  computeNewsReveal,
  isoWithinInclusiveMdRange,
  tripCountByDate,
  type ComputedNewsReveal,
  type TrendLabel,
} from './news-trip-stats.js';
import { bandFillForKind, dayBackgroundKindFromIso } from './news-line-calendar.js';

const defaultLabels = {
  up: 'Increase',
  down: 'Decrease',
  steady: 'Roughly steady',
} as const;

function trendWord(t: TrendLabel): string {
  if (t === 'up') return 'an increase';
  if (t === 'down') return 'a decrease';
  return 'roughly steady counts';
}

function truthSentence(t: TrendLabel): string {
  if (t === 'up') return 'Trip totals were higher than the comparison baseline.';
  if (t === 'down') return 'Trip totals were lower than the comparison baseline.';
  return 'Trip totals were roughly in line with the comparison baseline (small band).';
}

function formatInt(n: number): string {
  return d3.format(',')(Math.round(n));
}

/** Evenly spaced tick indices; small windows show every day. */
function lineChartXTickIndices(xMax: number): number[] {
  if (xMax < 0) return [0];
  const n = xMax + 1;
  if (n <= 9) return Array.from({ length: n }, (_, i) => i);
  const want = 6;
  const out = new Set<number>();
  out.add(0);
  out.add(xMax);
  for (let k = 1; k < want - 1; k++) {
    out.add(Math.round((k / (want - 1)) * xMax));
  }
  return Array.from(out).sort((a, b) => a - b);
}

function datesSpanDifferentYears(points: { date: string }[]): boolean {
  const first = points[0]?.date.slice(0, 4);
  const last = points[points.length - 1]?.date.slice(0, 4);
  return Boolean(first && last && first !== last);
}

function formatLineXTickDate(iso: string | undefined, showYear: boolean): string {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length < 3) return iso;
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return iso;
  const dt = new Date(y, mo - 1, d);
  return dt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(showYear ? { year: '2-digit' } : {}),
  });
}

function isDarkMode(): boolean {
  return (
    document.documentElement.classList.contains('dark') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Same calendar role → same color on every article (lines + bars). */
const NEWS_STORY_YEAR_COLORS = {
  previous: '#A6CEE3',
  current: '#1F78B4',
  next: '#33A02C',
} as const;

function newsStoryColorForBarIndex(barIndex: number, numBars: number): string {
  if (numBars >= 3) {
    if (barIndex === 0) return NEWS_STORY_YEAR_COLORS.previous;
    if (barIndex === 1) return NEWS_STORY_YEAR_COLORS.current;
    if (barIndex === 2) return NEWS_STORY_YEAR_COLORS.next;
    return NEWS_STORY_YEAR_COLORS.current;
  }
  if (numBars === 2) {
    return barIndex === 0 ? NEWS_STORY_YEAR_COLORS.previous : NEWS_STORY_YEAR_COLORS.current;
  }
  return NEWS_STORY_YEAR_COLORS.current;
}

function renderNewsViz(
  svgEl: SVGSVGElement,
  computed: ComputedNewsReveal,
  truth: TrendLabel,
  userPick: TrendLabel | null,
): void {
  const parent = svgEl.parentElement;
  const w = Math.max(300, (parent?.clientWidth ?? 640) - 40);
  const isDark = isDarkMode();
  const axisColor = isDark ? '#94a3b8' : '#64748b';

  const bars = computed.bars.map(b => ({ label: b.label, sum: b.sum }));
  const numBars = bars.length;
  const focalIndex = numBars >= 3 ? 1 : numBars === 2 ? 1 : 0;
  const lines = computed.lines;

  const topSummary = 18;
  const colTitleY = 30;
  const rowTop = 38;
  const outerPad = 8;
  const gapCol = 16;
  /** Plot row height ≈ 80% of viewport, bounded so nav + steps stay usable. */
  const innerRowHeight = Math.max(220, Math.min(Math.round(window.innerHeight * 0.8), 960));

  const summary =
    userPick && userPick === truth
      ? `${trendWord(truth)} — matches your pick.`
      : userPick
        ? `${trendWord(truth)} — differs from your pick.`
        : trendWord(truth);

  /** Side-by-side: line | bar. No lines: single full-width bar chart. */
  const hasLines = Boolean(lines && lines.series.length > 0);
  const marginLine = {
    top: 30,
    right: 4,
    bottom: lines?.showCalendarBandsByDefault ? 60 : 56,
    left: 40,
  };
  const marginBarSolo = { top: 10, right: 12, bottom: 58, left: 50 };
  const marginBarPair = { top: 22, right: 6, bottom: 54, left: 34 };

  const ihSolo = innerRowHeight - marginBarSolo.top - marginBarSolo.bottom;
  let totalH: number;
  if (hasLines) {
    totalH = rowTop + innerRowHeight + 22;
  } else {
    totalH = topSummary + 4 + marginBarSolo.top + ihSolo + marginBarSolo.bottom + 12;
  }

  const svg = d3
    .select(svgEl)
    .attr('viewBox', `0 0 ${w} ${totalH}`)
    .attr('width', '100%')
    .attr('height', totalH);

  svg.selectAll('*').remove();

  svg
    .append('text')
    .attr('x', w / 2)
    .attr('y', 14)
    .attr('text-anchor', 'middle')
    .attr('fill', axisColor)
    .attr('font-size', 11)
    .text(summary);

  if (hasLines && lines) {
    const linesOnly = lines.linesOnly === true;
    const calDefault = lines.showCalendarBandsByDefault === true;
    const lineDots = lines.linePointsWithDots === true;
    const markerDateSet = new Set(lines.markerDates ?? []);
    const hideCalendarHoverLegend = calDefault && lines.series.length <= 1;
    const availW = w - 2 * outerPad;
    const lineColW = linesOnly ? availW : availW * 0.52;
    const barColW = linesOnly ? 0 : availW - lineColW - gapCol;

    const iwLine = lineColW - marginLine.left - marginLine.right;
    const ihLine = innerRowHeight - marginLine.top - marginLine.bottom;
    const iwBar = barColW - marginBarPair.left - marginBarPair.right;
    const ihBar = innerRowHeight - marginBarPair.top - marginBarPair.bottom;

    const lineGX = outerPad + marginLine.left;
    const lineGY = rowTop + marginLine.top;
    const barGX = outerPad + lineColW + gapCol + marginBarPair.left;
    const barGY = rowTop + marginBarPair.top;

    svg
      .append('text')
      .attr('x', outerPad + lineColW / 2)
      .attr('y', colTitleY)
      .attr('text-anchor', 'middle')
      .attr('fill', axisColor)
      .attr('font-size', 12)
      .attr('font-weight', '600')
      .text(
        linesOnly && lines.series.length <= 1
          ? 'Daily trips by day'
          : linesOnly
            ? 'Daily trips (same calendar span each year)'
            : 'Daily trips (trend)',
      );
    if (!linesOnly) {
      svg
        .append('text')
        .attr('x', outerPad + lineColW + gapCol + barColW / 2)
        .attr('y', colTitleY)
        .attr('text-anchor', 'middle')
        .attr('fill', axisColor)
        .attr('font-size', 12)
        .attr('font-weight', '600')
        .text('Window totals (bars)');
    }

    const allPoints = lines.series.flatMap(s => s.points);
    const xMax = d3.max(allPoints, d => d.x) ?? 1;
    const yMax = d3.max(allPoints, d => d.trips) ?? 1;

    const xScale = d3.scaleLinear().domain([0, xMax]).range([0, iwLine]);
    const yScale = d3
      .scaleLinear()
      .domain([0, yMax * 1.06])
      .nice()
      .range([ihLine, 0]);

    const gLine = svg.append('g').attr('transform', `translate(${lineGX},${lineGY})`);

    const labelBarIndex = numBars === 2 ? 0 : focalIndex;
    const labelSeries =
      lines.series.find(s => s.barIndex === labelBarIndex) ?? lines.series[0]!;

    const gCalBands = gLine.append('g').attr('class', 'news-line-cal-bands').style('pointer-events', 'none');

    const hr = lines.highlightRange;
    if (hr) {
      const gHi = gLine.append('g').attr('class', 'news-line-festival-highlight').style('pointer-events', 'none');
      for (let i = 0; i <= xMax; i++) {
        const iso = labelSeries.points[i]?.date;
        if (!iso || !isoWithinInclusiveMdRange(iso, hr.start, hr.end)) continue;
        const x0 = Math.max(0, xScale(i - 0.5));
        const x1 = Math.min(iwLine, xScale(i + 0.5));
        const bw = Math.max(0, x1 - x0);
        if (bw <= 0) continue;
        gHi
          .append('rect')
          .attr('x', x0)
          .attr('y', 0)
          .attr('width', bw)
          .attr('height', ihLine)
          .attr('fill', isDark ? 'rgba(251, 191, 36, 0.16)' : 'rgba(251, 191, 36, 0.22)')
          .attr('stroke', isDark ? 'rgba(245, 158, 11, 0.45)' : 'rgba(217, 119, 6, 0.55)')
          .attr('stroke-width', 1);
      }
    }

    const shortLabel = (s: (typeof lines.series)[0]) =>
      s.label.replace(' (year before)', ' −1').replace(' (focal)', '').replace(' (year after)', ' +1');

    const legSlot = Math.min(200, iwLine / Math.max(1, lines.series.length));
    const legendFont = 11;

    type LineSeries = (typeof lines.series)[0];

    function paintCalBandsForSeries(s: LineSeries) {
      gCalBands.selectAll('*').remove();
      for (let i = 0; i <= xMax; i++) {
        const iso = s.points[i]?.date;
        if (!iso) continue;
        const kind = dayBackgroundKindFromIso(iso);
        const x0 = Math.max(0, xScale(i - 0.5));
        const x1 = Math.min(iwLine, xScale(i + 0.5));
        const bw = Math.max(0, x1 - x0);
        if (bw <= 0) continue;
        gCalBands
          .append('rect')
          .attr('x', x0)
          .attr('y', 0)
          .attr('width', bw)
          .attr('height', ihLine)
          .attr('fill', bandFillForKind(kind, isDark));
      }
    }

    const gCalHint = gLine
      .append('g')
      .attr('class', 'news-line-cal-hint')
      .attr('opacity', 0)
      .style('pointer-events', 'none');

    const calHintEntries: { kind: 'weekday' | 'weekend' | 'holiday'; label: string; w: number }[] = [
      { kind: 'weekday', label: 'Weekday', w: 68 },
      { kind: 'weekend', label: 'Weekend', w: 72 },
      { kind: 'holiday', label: 'Public holiday (NO)', w: 118 },
    ];

    function showCalHintForSeries(s: LineSeries) {
      gCalHint.selectAll('*').remove();
      const lab = shortLabel(s);
      const title =
        lab.length > 42 ? `Norway calendar — ${lab.slice(0, 40)}…` : `Norway calendar — ${lab}`;
      gCalHint
        .append('text')
        .attr('x', iwLine / 2)
        .attr('y', ihLine + 32)
        .attr('text-anchor', 'middle')
        .attr('fill', axisColor)
        .attr('font-size', 9)
        .text(title);

      const totalW = calHintEntries.reduce((a, e) => a + e.w, 0);
      let hx = (iwLine - totalW) / 2;
      const hy = ihLine + 44;
      for (const e of calHintEntries) {
        const hg = gCalHint.append('g').attr('transform', `translate(${hx},${hy})`);
        hg.append('rect')
          .attr('x', 0)
          .attr('y', -9)
          .attr('width', 10)
          .attr('height', 10)
          .attr('rx', 2)
          .attr('fill', bandFillForKind(e.kind, isDark));
        hg.append('text')
          .attr('x', 14)
          .attr('y', 0)
          .attr('fill', axisColor)
          .attr('font-size', 9)
          .text(e.label);
        hx += e.w;
      }
      gCalHint.attr('opacity', 1);
      gCalHint.raise();
    }

    function clearCalOverlay() {
      if (calDefault) {
        paintCalBandsForSeries(labelSeries);
      } else {
        gCalBands.selectAll('*').remove();
      }
      gCalHint.selectAll('*').remove();
      gCalHint.attr('opacity', 0);
    }

    if (calDefault) {
      paintCalBandsForSeries(labelSeries);
    }

    if (!hideCalendarHoverLegend) {
      const leg = gLine.append('g').attr('class', 'news-line-legend');
      leg.on('pointerleave', clearCalOverlay);

      lines.series.forEach((s, i) => {
        const stroke = newsStoryColorForBarIndex(s.barIndex, numBars);
        const g = leg.append('g').attr('transform', `translate(${i * legSlot},-14)`);
        g.append('line')
          .attr('x1', 0)
          .attr('x2', 22)
          .attr('y1', 0)
          .attr('y2', 0)
          .attr('stroke', stroke)
          .attr('stroke-width', 2.75);
        g.append('text')
          .attr('x', 28)
          .attr('y', 4)
          .attr('fill', axisColor)
          .attr('font-size', legendFont)
          .text(shortLabel(s).length > 22 ? `${shortLabel(s).slice(0, 20)}…` : shortLabel(s));
        g.append('rect')
          .attr('class', 'news-line-legend-hit')
          .attr('x', -8)
          .attr('y', -12)
          .attr('width', Math.max(legSlot + 10, 80))
          .attr('height', 18)
          .attr('fill', 'transparent')
          .style('cursor', 'pointer');
        g.append('title').text(
          'Show weekday, weekend, and Norwegian public holiday shading for this series.',
        );
        g.on('pointerenter', () => {
          paintCalBandsForSeries(s);
          showCalHintForSeries(s);
        });
      });
    }

    const lineGen = d3
      .line<{ x: number; trips: number }>()
      .x(d => xScale(d.x))
      .y(d => yScale(d.trips))
      .curve(d3.curveMonotoneX);

    for (const s of lines.series) {
      const stroke = newsStoryColorForBarIndex(s.barIndex, numBars);
      gLine
        .append('path')
        .datum(s.points)
        .attr('fill', 'none')
        .attr('stroke', stroke)
        .attr('stroke-width', 2.2)
        .attr('stroke-linejoin', 'round')
        .attr('d', lineGen);
    }

    if (lineDots) {
      const gDots = gLine.append('g').attr('class', 'news-line-dots').style('pointer-events', 'none');
      for (const s of lines.series) {
        const stroke = newsStoryColorForBarIndex(s.barIndex, numBars);
        for (const p of s.points) {
          const emph = markerDateSet.has(p.date);
          const tip = `${p.date}: ${formatInt(p.trips)} trips`;
          const dot = gDots
            .append('circle')
            .attr('cx', xScale(p.x))
            .attr('cy', yScale(p.trips))
            .attr('r', emph ? 5.25 : 3.4)
            .attr('fill', isDark ? '#0f172a' : '#ffffff')
            .attr('stroke', stroke)
            .attr('stroke-width', emph ? 2.5 : 1.65);
          dot.append('title').text(tip);
        }
      }
    }

    if (hr) {
      const cap = `Festival window: ${formatLineXTickDate(hr.start, false)}–${formatLineXTickDate(hr.end, false)}`;
      const capG = gLine.append('g').attr('class', 'news-line-festival-caption').style('pointer-events', 'none');
      capG
        .append('rect')
        .attr('x', iwLine - 198)
        .attr('y', 2)
        .attr('width', 196)
        .attr('height', 18)
        .attr('rx', 4)
        .attr('fill', isDark ? 'rgba(15, 23, 42, 0.72)' : 'rgba(255, 255, 255, 0.88)')
        .attr('stroke', isDark ? 'rgba(245, 158, 11, 0.35)' : 'rgba(217, 119, 6, 0.35)');
      capG
        .append('text')
        .attr('x', iwLine - 100)
        .attr('y', 14)
        .attr('text-anchor', 'middle')
        .attr('fill', axisColor)
        .attr('font-size', 9.5)
        .attr('font-weight', '600')
        .text(cap.length > 48 ? `${cap.slice(0, 46)}…` : cap);
      capG.raise();
    }

    const tickIdx = lineChartXTickIndices(xMax);
    const showYearOnTicks = datesSpanDifferentYears(labelSeries.points);
    const xTickFormat = (v: d3.NumberValue) => {
      const i = Math.round(Number(v));
      const iso = labelSeries.points[i]?.date;
      const t = formatLineXTickDate(iso, showYearOnTicks);
      return t || String(i);
    };

    gLine
      .append('g')
      .attr('transform', `translate(0,${ihLine})`)
      .call(
        d3
          .axisBottom(xScale)
          .tickValues(tickIdx)
          .tickFormat(xTickFormat),
      )
      .call(ax => ax.selectAll('path,line').attr('stroke', axisColor))
      .call(ax => ax.selectAll('text').attr('fill', axisColor).attr('font-size', 11));

    gLine
      .append('g')
      .call(d3.axisLeft(yScale).ticks(4).tickFormat(d => formatInt(Number(d))))
      .call(ax => ax.selectAll('path,line').attr('stroke', axisColor))
      .call(ax => ax.selectAll('text').attr('fill', axisColor).attr('font-size', 11));

    gLine
      .append('text')
      .attr('x', iwLine / 2)
      .attr('y', ihLine + 18)
      .attr('text-anchor', 'middle')
      .attr('fill', axisColor)
      .attr('font-size', 10.5)
      .text(lines.xAxisLabel);

    if (calDefault && hideCalendarHoverLegend) {
      const gStatic = gLine.append('g').attr('class', 'news-line-cal-legend-static');
      const swTotal = calHintEntries.reduce((a, e) => a + e.w, 0);
      let sx = (iwLine - swTotal) / 2;
      const sy = ihLine + 34;
      for (const e of calHintEntries) {
        const hg = gStatic.append('g').attr('transform', `translate(${sx},${sy})`);
        hg.append('rect')
          .attr('x', 0)
          .attr('y', -9)
          .attr('width', 10)
          .attr('height', 10)
          .attr('rx', 2)
          .attr('fill', bandFillForKind(e.kind, isDark));
        hg.append('text')
          .attr('x', 14)
          .attr('y', 0)
          .attr('fill', axisColor)
          .attr('font-size', 9)
          .text(e.label);
        sx += e.w;
      }
    }

    if (!linesOnly) {
      const xBand = d3
        .scaleBand<string>()
        .domain(bars.map((_, i) => String(i)))
        .range([0, iwBar])
        .padding(0.22);
      const maxBar = d3.max(bars, d => d.sum) ?? 1;
      const yBar = d3
        .scaleLinear()
        .domain([0, maxBar * 1.08])
        .nice()
        .range([ihBar, 0]);

      const gBar = svg.append('g').attr('transform', `translate(${barGX},${barGY})`);

      gBar
        .selectAll('rect')
        .data(bars)
        .join('rect')
        .attr('x', (_, i) => xBand(String(i)) ?? 0)
        .attr('y', d => yBar(d.sum))
        .attr('width', xBand.bandwidth())
        .attr('height', d => ihBar - yBar(d.sum))
        .attr('rx', 4)
        .attr('fill', (_, i) => newsStoryColorForBarIndex(i, numBars));

      gBar
        .selectAll('text.val')
        .data(bars)
        .join('text')
        .attr('class', 'val')
        .attr('text-anchor', 'middle')
        .attr('x', (_, i) => (xBand(String(i)) ?? 0) + xBand.bandwidth() / 2)
        .attr('y', d => yBar(d.sum) - 5)
        .attr('fill', axisColor)
        .attr('font-size', 12)
        .text(d => formatInt(d.sum));

      const xAxisBar = d3.axisBottom(xBand).tickFormat(i => {
        const idx = Number(i);
        const short = bars[idx]!.label
          .replace(' (year before)', ' −1')
          .replace(' (focal)', '')
          .replace(' (year after)', ' +1');
        return short.length > 12 ? `${short.slice(0, 10)}…` : short;
      });

      gBar
        .append('g')
        .attr('transform', `translate(0,${ihBar})`)
        .call(xAxisBar)
        .call(ax => ax.selectAll('text').attr('transform', 'rotate(-22)').style('text-anchor', 'end'))
        .call(ax => ax.selectAll('path,line').attr('stroke', axisColor))
        .call(ax => ax.selectAll('text').attr('fill', axisColor).attr('font-size', 11));

      gBar
        .append('g')
        .call(d3.axisLeft(yBar).ticks(4).tickFormat(d => formatInt(Number(d))))
        .call(ax => ax.selectAll('path,line').attr('stroke', axisColor))
        .call(ax => ax.selectAll('text').attr('fill', axisColor).attr('font-size', 11));

      gBar
        .append('text')
        .attr('x', iwBar / 2)
        .attr('y', ihBar + 44)
        .attr('text-anchor', 'middle')
        .attr('fill', axisColor)
        .attr('font-size', 10.5)
        .text('Same windows as lines');
    }
    return;
  }

  /* Fallback: bars only (full width) */
  const yCursor = topSummary + 4;
  const iw = w - marginBarSolo.left - marginBarSolo.right;
  const ih = ihSolo;
  const x = d3
    .scaleBand<string>()
    .domain(bars.map((_, i) => String(i)))
    .range([0, iw])
    .padding(0.25);

  const max = d3.max(bars, d => d.sum) ?? 1;
  const y = d3
    .scaleLinear()
    .domain([0, max * 1.08])
    .nice()
    .range([ih, 0]);

  const gBar = svg
    .append('g')
    .attr('transform', `translate(${marginBarSolo.left},${yCursor + marginBarSolo.top})`);

  gBar
    .selectAll('rect')
    .data(bars)
    .join('rect')
    .attr('x', (_, i) => x(String(i)) ?? 0)
    .attr('y', d => y(d.sum))
    .attr('width', x.bandwidth())
    .attr('height', d => ih - y(d.sum))
    .attr('rx', 4)
    .attr('fill', (_, i) => newsStoryColorForBarIndex(i, numBars));

  gBar
    .selectAll('text.val')
    .data(bars)
    .join('text')
    .attr('class', 'val')
    .attr('text-anchor', 'middle')
    .attr('x', (_, i) => (x(String(i)) ?? 0) + x.bandwidth() / 2)
    .attr('y', d => y(d.sum) - 6)
    .attr('fill', axisColor)
    .attr('font-size', 11)
    .text(d => formatInt(d.sum));

  const xAxis = d3.axisBottom(x).tickFormat(i => {
    const idx = Number(i);
    const short = bars[idx]!.label
      .replace(' (year before)', ' −1')
      .replace(' (focal)', '')
      .replace(' (year after)', ' +1');
    return short.length > 16 ? `${short.slice(0, 14)}…` : short;
  });

  gBar
    .append('g')
    .attr('transform', `translate(0,${ih})`)
    .call(xAxis)
    .call(ax => ax.selectAll('text').attr('transform', 'rotate(-28)').style('text-anchor', 'end'))
    .call(ax => ax.selectAll('path,line').attr('stroke', axisColor))
    .call(ax => ax.selectAll('text').attr('fill', axisColor));

  gBar
    .append('g')
    .call(d3.axisLeft(y).ticks(4).tickFormat(d => formatInt(Number(d))))
    .call(ax => ax.selectAll('path,line').attr('stroke', axisColor))
    .call(ax => ax.selectAll('text').attr('fill', axisColor));

  gBar
    .append('text')
    .attr('x', iw / 2)
    .attr('y', ih + 48)
    .attr('text-anchor', 'middle')
    .attr('fill', axisColor)
    .attr('font-size', 10)
    .text('Totals (bars)');
}

function fillRevealDom(
  article: NewsPredictionArticle,
  computed: ComputedNewsReveal,
  userPick: TrendLabel | null,
): void {
  const root = document.querySelector<HTMLElement>(`[data-reveal-root="${article.id}"]`);
  if (!root) return;
  const guessEl = root.querySelector<HTMLElement>('.reveal-user-guess');
  const truthEl = root.querySelector<HTMLElement>('.reveal-data-truth');
  const matchEl = root.querySelector<HTMLElement>('.reveal-match');
  const notesEl = root.querySelector<HTMLElement>('.reveal-notes');

  const labels = { ...defaultLabels, ...article.predictionLabels };
  if (guessEl) {
    guessEl.textContent = userPick
      ? `Your pick: ${userPick === 'up' ? labels.up : userPick === 'down' ? labels.down : labels.steady}.`
      : 'You did not pick an option — scroll up to choose, or just read the totals below.';
  }
  if (truthEl) {
    const extra =
      computed.appendComparativeTruthDetail === false ? '' : ` ${truthSentence(computed.truth)}`;
    truthEl.textContent = computed.inconclusiveBaseline
      ? computed.truthCaption
      : `${computed.truthCaption}${extra}`;
  }
  if (matchEl) {
    if (!userPick) matchEl.textContent = '';
    else if (userPick === computed.truth) matchEl.textContent = 'That matches your prediction.';
    else matchEl.textContent = 'That differs from your prediction — both are still compatible with many real-world explanations.';
  }
  if (notesEl) {
    const items = article.notesForReveal ?? [];
    notesEl.innerHTML =
      items.length > 0 ? `<ul>${items.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : '';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildArticleSection(
  article: NewsPredictionArticle,
  computed: ComputedNewsReveal,
  onPick: (pick: TrendLabel) => void,
): HTMLElement {
  const labels = { ...defaultLabels, ...article.predictionLabels };
  const section = document.createElement('section');
  section.className = 'story-chapter';
  section.id = `chapter-${article.id}`;

  const sticky = document.createElement('div');
  sticky.className = 'sticky-graphic';
  const chTitle = document.createElement('span');
  chTitle.className = 'chapter-title';
  chTitle.textContent = article.title;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', `viz-news-${article.id}`);
  svg.setAttribute('role', 'img');

  sticky.append(chTitle, svg);

  const steps = document.createElement('div');
  steps.className = 'scroll-steps';

  const rel =
    article.relatedUrls && article.relatedUrls.length
      ? `<p class="meta">Related: ${article.relatedUrls.map(u => `<a class="source-link" href="${escapeHtml(u)}">${escapeHtml(u)}</a>`).join('<br/>')}</p>`
      : '';

  const urlBlock = article.url
    ? `<p class="meta"><a class="source-link" href="${escapeHtml(article.url)}">Source article</a></p>`
    : '<p class="meta">Synthetic scenario (no external article).</p>';

  steps.innerHTML = `
    <div class="step" data-chapter="${escapeHtml(article.id)}" data-step="0">
      <div class="step-card">
        <h3>Context</h3>
        <p class="meta">Published ${escapeHtml(article.publishedDate)}</p>
        ${urlBlock}
        <p>${escapeHtml(article.summary)}</p>
        ${rel}
      </div>
    </div>
    <div class="step" data-chapter="${escapeHtml(article.id)}" data-step="1">
      <div class="step-card">
        <h3>Your prediction</h3>
        <p>${escapeHtml(article.question)}</p>
        <div class="pred-buttons" data-buttons="${escapeHtml(article.id)}">
          <button type="button" data-guess="up">${escapeHtml(labels.up)}</button>
          <button type="button" data-guess="down">${escapeHtml(labels.down)}</button>
          <button type="button" data-guess="steady">${escapeHtml(labels.steady)}</button>
        </div>
      </div>
    </div>
    <div class="step" data-chapter="${escapeHtml(article.id)}" data-step="2">
      <div class="step-card" data-reveal-root="${escapeHtml(article.id)}">
        <h3>What the data shows</h3>
        <p class="reveal-user-guess"></p>
        <p class="reveal-data-truth reveal-truth"></p>
        <p class="reveal-match"></p>
        <div class="reveal-notes"></div>
      </div>
    </div>
  `;

  section.append(sticky, steps);

  const btnRoot = section.querySelector<HTMLElement>(`[data-buttons="${article.id}"]`);
  btnRoot?.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.getAttribute('data-guess') as TrendLabel;
      btnRoot.querySelectorAll('button').forEach(b => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      onPick(g);
      const revealStep = section.querySelector<HTMLElement>(
        `.step[data-chapter="${CSS.escape(article.id)}"][data-step="2"]`,
      );
      revealStep?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  return section;
}

async function init() {
  const loadingEl = document.getElementById('story-news-loading');
  const main = document.getElementById('story-news');
  if (!main) return;

  try {
    const [articlesRes, dailyRes] = await Promise.all([
      loadPreparedData<NewsPredictionArticlesPayload>('story/news_prediction_articles.json'),
      loadPreparedData<CyclingDailyNormSeriesData>('cycling/cycling_daily_norm_series.json'),
    ]);

    const articles = articlesRes.data.articles.filter(a => !a.disabled);
    const series: CyclingDailyNormPoint[] = dailyRes.data.series;
    const byDate = tripCountByDate(series);

    const computedById = new Map<string, ComputedNewsReveal>();
    const userChoices = new Map<string, TrendLabel>();

    for (const a of articles) {
      computedById.set(a.id, computeNewsReveal(byDate, a));
    }

    for (const article of articles) {
      const computed = computedById.get(article.id)!;
      const section = buildArticleSection(article, computed, pick => {
        userChoices.set(article.id, pick);
        fillRevealDom(article, computed, pick);
        const svg = document.getElementById(`viz-news-${article.id}`) as SVGSVGElement | null;
        if (svg) {
          renderNewsViz(svg, computed, computed.truth, pick);
        }
      });
      main.appendChild(section);
    }

    loadingEl?.remove();

    const scroller = scrollama();
    scroller
      .setup({ step: '.step', offset: 0.5 })
      .onStepEnter(({ element }: { element: HTMLElement }) => {
        document.querySelectorAll<HTMLElement>('.step').forEach(el => el.classList.remove('is-active'));
        element.classList.add('is-active');
        const chapter = element.dataset.chapter ?? '';
        const step = Number(element.dataset.step ?? 0);
        if (chapter === 'preface') return;

        const article = articles.find(a => a.id === chapter);
        if (!article) return;
        const computed = computedById.get(article.id)!;
        const svg = document.getElementById(`viz-news-${article.id}`) as SVGSVGElement | null;
        if (!svg) return;

        if (step >= 2) {
          const pick = userChoices.get(article.id) ?? null;
          fillRevealDom(article, computed, pick);
          renderNewsViz(svg, computed, computed.truth, pick);
        } else if (step === 1) {
          svg.innerHTML = '';
          const hint = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          hint.setAttribute('x', '50%');
          hint.setAttribute('y', '50%');
          hint.setAttribute('text-anchor', 'middle');
          hint.setAttribute('fill', '#64748b');
          hint.setAttribute('font-size', '14');
          hint.textContent = 'Choose an option on the right, then scroll to reveal.';
          svg.appendChild(hint);
        } else {
          svg.innerHTML = '';
        }
      });

    window.addEventListener('resize', () => scroller.resize());
  } catch (err) {
    console.error('story-news load failed', err);
    if (loadingEl) {
      loadingEl.textContent = 'Failed to load data. Please refresh.';
      loadingEl.style.color = '#ef4444';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}
