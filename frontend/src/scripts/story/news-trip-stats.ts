import type { CyclingDailyNormPoint, NewsPredictionArticle } from '../../data/prepared-data-types.js';

export type TrendLabel = 'up' | 'down' | 'steady';

/** Relative band for "steady" vs prior aggregate. */
const STEADY_EPS = 0.04;

export function classifyVersusPrior(current: number, prior: number): TrendLabel {
  if (prior <= 0) {
    if (current <= 0) return 'steady';
    return 'up';
  }
  const ratio = current / prior;
  if (ratio > 1 + STEADY_EPS) return 'up';
  if (ratio < 1 - STEADY_EPS) return 'down';
  return 'steady';
}

/** When prior-year sum is zero and baseline calendar year is before 2019 (legacy turdata era). */
function inconclusivePriorYearCaption(baselineCalendarYear: number): string {
  if (baselineCalendarYear < 2019) {
    return (
      'The year-before window has no trip counts here: trip data from before April 2019 was published in a ' +
      'different format, so it was not processed in this dataset.'
    );
  }
  return 'The year-before window has no trip counts in this extract, so direction vs that baseline is not inferred.';
}

export interface RevealBar {
  label: string;
  sum: number;
  missingDayCount: number;
}

/** One year (or block) as daily points; x is 0..n-1 aligned across series for comparison. */
export interface NewsLineSeries {
  label: string;
  /** Index into the bar list — used to pick the same color as the bar chart. */
  barIndex: number;
  points: Array<{ x: number; trips: number; date: string }>;
}

export interface NewsLineBundle {
  series: NewsLineSeries[];
  xAxisLabel: string;
  linesOnly?: boolean;
  highlightRange?: { start: string; end: string };
  /** Fill weekday/weekend/holiday bands without legend hover (uses label series dates). */
  showCalendarBandsByDefault?: boolean;
  /** Draw a dot at each day; dates in `markerDates` get a slightly larger ring. */
  linePointsWithDots?: boolean;
  markerDates?: string[];
}

export interface ComputedNewsReveal {
  bars: RevealBar[];
  truth: TrendLabel;
  truthCaption: string;
  /** When the baseline window has no trips here (often legacy pre-2019 data not processed — see truth caption). */
  inconclusiveBaseline?: boolean;
  /** When false, reveal shows only `truthCaption` (no generic “baseline” sentence). */
  appendComparativeTruthDetail?: boolean;
  /** Daily (or aligned) series for line chart — same windows as bars where applicable. */
  lines?: NewsLineBundle;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function tripCountByDate(series: CyclingDailyNormPoint[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of series) {
    m.set(row.date, row.trip_count);
  }
  return m;
}

function sumForDateKeys(byDate: Map<string, number>, keys: string[]): { sum: number; missing: number } {
  let sum = 0;
  let missing = 0;
  for (const k of keys) {
    if (byDate.has(k)) sum += byDate.get(k)!;
    else missing++;
  }
  return { sum, missing };
}

function parseMonthDay(iso: string): { month: number; day: number } {
  const [, mm, dd] = iso.split('-').map(Number);
  return { month: mm, day: dd };
}

/** Compare calendar month–day only (leap-safe dummy year). */
function mdTime(iso: string): number {
  const [, m, d] = iso.split('-').map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(d)) return 0;
  return new Date(2004, m - 1, d).getTime();
}

export function isoWithinInclusiveMdRange(
  iso: string,
  rangeStartIso: string,
  rangeEndIso: string,
): boolean {
  const t = mdTime(iso);
  return t >= mdTime(rangeStartIso) && t <= mdTime(rangeEndIso);
}

/** Same month/day window as template start–end, applied to `targetYear`. */
function dateKeysForTemplateRange(
  targetYear: number,
  templateStart: string,
  templateEnd: string,
): string[] {
  const s = parseMonthDay(templateStart);
  const e = parseMonthDay(templateEnd);
  const keys: string[] = [];
  const cur = new Date(targetYear, s.month - 1, s.day);
  const end = new Date(targetYear, e.month - 1, e.day);
  while (cur <= end) {
    keys.push(ymd(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()));
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
}

function sumCalendarMonth(byDate: Map<string, number>, year: number, month: number): { sum: number; missing: number } {
  const dim = daysInMonth(year, month);
  const keys: string[] = [];
  for (let d = 1; d <= dim; d++) keys.push(ymd(year, month, d));
  return sumForDateKeys(byDate, keys);
}

/** Chronological list of YYYY-MM-DD for every day from startMonth through endMonth (inclusive) in `year`. */
function dateKeysYearMonthSpan(year: number, startMonth: number, endMonth: number): string[] {
  const keys: string[] = [];
  for (let m = startMonth; m <= endMonth; m++) {
    const dim = daysInMonth(year, m);
    for (let d = 1; d <= dim; d++) keys.push(ymd(year, m, d));
  }
  return keys;
}

function sumYearMonthSpanInclusive(
  byDate: Map<string, number>,
  y: number,
  startMonth: number,
  endMonth: number,
): { sum: number; missing: number } {
  let sum = 0;
  let missing = 0;
  for (let m = startMonth; m <= endMonth; m++) {
    const r = sumCalendarMonth(byDate, y, m);
    sum += r.sum;
    missing += r.missing;
  }
  return { sum, missing };
}

function labelForTriYear(y: number, focalYear: number): string {
  if (y === focalYear - 1) return `${y} (year before)`;
  if (y === focalYear + 1) return `${y} (year after)`;
  return `${y} (focal)`;
}

export function computeNewsReveal(
  byDate: Map<string, number>,
  article: NewsPredictionArticle,
): ComputedNewsReveal {
  const c = article.comparison;

  if (c.type === 'single_year_month_line') {
    const { year, month } = c;
    const monthName = new Date(year, month - 1, 1).toLocaleString('en', { month: 'long' });
    const dim = daysInMonth(year, month);
    const keys: string[] = [];
    for (let d = 1; d <= dim; d++) keys.push(ymd(year, month, d));
    const { sum, missing } = sumForDateKeys(byDate, keys);
    const points = keys.map((date, x) => ({
      x,
      trips: byDate.get(date) ?? 0,
      date,
    }));
    const markerSet = new Set(c.markerDates ?? []);
    const pub = article.publishedDate.slice(0, 10);
    if (keys.includes(pub)) markerSet.add(pub);

    return {
      bars: [{ label: `${monthName} ${year}`, sum, missingDayCount: missing }],
      truth: 'steady',
      truthCaption: `${monthName} ${year} by day (no year-on-year comparison in this view).`,
      appendComparativeTruthDetail: false,
      lines: {
        series: [{ label: `${monthName} ${year}`, barIndex: 0, points }],
        xAxisLabel:
          c.xAxisLineCaption ??
          `Each dot is one day in ${monthName} ${year}. Shading: weekday, weekend, or Norwegian public holiday.`,
        linesOnly: true,
        showCalendarBandsByDefault: true,
        linePointsWithDots: true,
        markerDates: Array.from(markerSet),
      },
    };
  }

  if (c.type === 'tri_year_range') {
    const focalYear = Number(c.start.slice(0, 4));
    const years = [focalYear - 1, focalYear, focalYear + 1];
    const linesOnly = c.linesOnly === true;
    const highlightRange = c.highlightRange;
    const bars: RevealBar[] = years.map(y => {
      const keys = dateKeysForTemplateRange(y, c.start, c.end);
      const { sum, missing } = sumForDateKeys(byDate, keys);
      return {
        label: labelForTriYear(y, focalYear),
        sum,
        missingDayCount: missing,
      };
    });
    const lineSeries: NewsLineSeries[] = years.map((y, barIndex) => {
      const keys = dateKeysForTemplateRange(y, c.start, c.end);
      const points = keys.map((date, x) => ({
        x,
        trips: byDate.get(date) ?? 0,
        date,
      }));
      return { label: labelForTriYear(y, focalYear), barIndex, points };
    });
    const prior = bars[0]!.sum;
    const focal = bars[1]!.sum;
    const inconclusive = prior === 0 && focal > 0;
    const truth = inconclusive ? 'steady' : classifyVersusPrior(focal, prior);
    return {
      bars,
      truth,
      truthCaption: inconclusive
        ? inconclusivePriorYearCaption(focalYear - 1)
        : `Focal year (${focalYear}) vs the year before, same calendar window`,
      inconclusiveBaseline: inconclusive,
      lines: {
        series: lineSeries,
        xAxisLabel:
          c.xAxisLineCaption ??
          'Each line uses the same calendar day within the window; tick labels show that day in the focal year.',
        linesOnly,
        highlightRange,
      },
    };
  }

  if (c.type === 'tri_year_month') {
    const { focalYear, month } = c;
    const years = [focalYear - 1, focalYear, focalYear + 1];
    const bars: RevealBar[] = years.map(y => {
      const { sum, missing } = sumCalendarMonth(byDate, y, month);
      const monthName = new Date(y, month - 1, 1).toLocaleString('en', { month: 'long' });
      return {
        label: `${monthName} ${y}`,
        sum,
        missingDayCount: missing,
      };
    });
    const priorM = bars[0]!.sum;
    const focalM = bars[1]!.sum;
    const inconclusive = priorM === 0 && focalM > 0;
    const truth = inconclusive ? 'steady' : classifyVersusPrior(focalM, priorM);
    const monthName = new Date(focalYear, month - 1, 1).toLocaleString('en', { month: 'long' });
    const lineSeries: NewsLineSeries[] = years.map((y, barIndex) => {
      const dim = daysInMonth(y, month);
      const keys: string[] = [];
      for (let d = 1; d <= dim; d++) keys.push(ymd(y, month, d));
      const points = keys.map((date, x) => ({
        x,
        trips: byDate.get(date) ?? 0,
        date,
      }));
      return { label: `${monthName} ${y}`, barIndex, points };
    });
    return {
      bars,
      truth,
      truthCaption: inconclusive
        ? inconclusivePriorYearCaption(focalYear - 1)
        : `${focalYear} vs ${focalYear - 1} (full calendar month)`,
      inconclusiveBaseline: inconclusive,
      lines: {
        series: lineSeries,
        xAxisLabel: `Each calendar day of ${monthName} (axis dates from ${focalYear}).`,
      },
    };
  }

  if (c.type === 'explicit_month_three_bars') {
    const years = c.years as number[];
    const bars: RevealBar[] = years.map(y => {
      const { sum, missing } = sumCalendarMonth(byDate, y, c.month);
      const monthName = new Date(y, c.month - 1, 1).toLocaleString('en', { month: 'long' });
      return { label: `${monthName} ${y}`, sum, missingDayCount: missing };
    });
    const monthName = new Date(years[0]!, c.month - 1, 1).toLocaleString('en', { month: 'long' });
    const lineSeries: NewsLineSeries[] = years.map((y, barIndex) => {
      const dim = daysInMonth(y, c.month);
      const keys: string[] = [];
      for (let d = 1; d <= dim; d++) keys.push(ymd(y, c.month, d));
      const points = keys.map((date, x) => ({
        x,
        trips: byDate.get(date) ?? 0,
        date,
      }));
      return { label: `${monthName} ${y}`, barIndex, points };
    });
    const first = bars[0]!.sum;
    const last = bars[bars.length - 1]!.sum;
    const truth = classifyVersusPrior(last, first);
    const midYear = years[1] ?? years[0];
    return {
      bars,
      truth,
      truthCaption: `${years[years.length - 1]} vs ${years[0]} (same month)`,
      lines: {
        series: lineSeries,
        xAxisLabel: `Each calendar day of ${monthName} (axis dates from ${midYear}).`,
      },
    };
  }

  if (c.type === 'two_year_month_span') {
    const L = sumYearMonthSpanInclusive(byDate, c.left.year, c.left.startMonth, c.left.endMonth);
    const R = sumYearMonthSpanInclusive(byDate, c.right.year, c.right.startMonth, c.right.endMonth);
    const bars: RevealBar[] = [
      {
        label: `${c.left.year} (months ${c.left.startMonth}–${c.left.endMonth})`,
        sum: L.sum,
        missingDayCount: L.missing,
      },
      {
        label: `${c.right.year} (months ${c.right.startMonth}–${c.right.endMonth})`,
        sum: R.sum,
        missingDayCount: R.missing,
      },
    ];
    const truth = classifyVersusPrior(R.sum, L.sum);
    const keysL = dateKeysYearMonthSpan(c.left.year, c.left.startMonth, c.left.endMonth);
    const keysR = dateKeysYearMonthSpan(c.right.year, c.right.startMonth, c.right.endMonth);
    const n = Math.min(keysL.length, keysR.length);
    const lineSeries: NewsLineSeries[] = [
      {
        label: bars[0]!.label,
        barIndex: 0,
        points: keysL.slice(0, n).map((date, x) => ({
          x,
          trips: byDate.get(date) ?? 0,
          date,
        })),
      },
      {
        label: bars[1]!.label,
        barIndex: 1,
        points: keysR.slice(0, n).map((date, x) => ({
          x,
          trips: byDate.get(date) ?? 0,
          date,
        })),
      },
    ];
    return {
      bars,
      truth,
      truthCaption: `${c.right.year} block vs ${c.left.year} block (trip totals)`,
      lines: {
        series: lineSeries,
        xAxisLabel:
          'Same ordinal day in each block (axis dates from the first block’s calendar).',
      },
    };
  }

  return { bars: [], truth: 'steady', truthCaption: 'Unknown comparison' };
}
