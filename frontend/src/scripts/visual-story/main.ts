import scrollama from 'scrollama';
import { loadPreparedData, loadParquetData } from '../../data/load-prepared-data.js';
import type {
  AvgTripTimeByMonthRow,
  CyclingDailyNormSeriesData,
  CyclingDurationByContextData,
  CyclingHourlyRidingProfileData,
  EdaSummaryStats,
  RoutesData,
  RoutePairCount,
  StationInOutLatestFullMonthData,
  WeatherOsloData,
} from '../../data/prepared-data-types.js';
import {
  initHeroMap,
  initYearlyChart, updateYearlyChart,
  initSeasonalChart, updateSeasonalChart,
  initWhenRiding, updateWhenRiding,
  initBalanceMap, updateBalanceMap,
  initRoutesMap, updateRoutesMap,
  type StationDatum,
} from './charts.js';

const base = (import.meta as { env: { BASE_URL: string } }).env.BASE_URL ?? '/';

async function loadStations(): Promise<StationDatum[]> {
  const res = await fetch(`${base}prepared-data/stations.json`);
  if (!res.ok) throw new Error(`stations.json: ${res.status}`);
  const json = await res.json() as unknown;
  // Handle both wrapped { data: { stations: [...] } } and plain array formats
  if (Array.isArray(json)) return json as StationDatum[];
  const wrapped = json as { data?: { stations?: StationDatum[] } | StationDatum[] };
  if (Array.isArray(wrapped.data)) return wrapped.data as StationDatum[];
  return (wrapped.data as { stations?: StationDatum[] })?.stations ?? [];
}

async function loadWeatherJson(): Promise<WeatherOsloData | null> {
  try {
    const res = await fetch(`${base}prepared-data/weather_oslo.json`);
    if (!res.ok) return null;
    return (await res.json()) as WeatherOsloData;
  } catch {
    return null;
  }
}

async function loadAllData() {
  const [
    stations,
    avgTimeRes,
    edaRes,
    routesRes,
    pairCountRows,
    dailyNormRes,
    durationCtxRes,
    hourlyRidingRes,
    stationInOutRes,
    weather,
  ] = await Promise.all([
    loadStations(),
    loadPreparedData<AvgTripTimeByMonthRow[]>('avg_trip_time_by_month.json'),
    loadPreparedData<EdaSummaryStats>('eda_summary_stats.json'),
    loadPreparedData<RoutesData | { routes: unknown[] }>('routes.json'),
    loadParquetData<RoutePairCount>('routes/route_pair_counts.parquet').catch(() => [] as RoutePairCount[]),
    loadPreparedData<CyclingDailyNormSeriesData>('cycling/cycling_daily_norm_series.json').catch(() => ({ data: { series: [], norm_definition: '' } })),
    loadPreparedData<CyclingDurationByContextData>('cycling/cycling_duration_by_context.json').catch(() => ({ data: { duration_by_context: [] } })),
    loadPreparedData<CyclingHourlyRidingProfileData>('cycling/cycling_hourly_riding_profile.json').catch(() => ({
      data: {
        norm_definition: '',
        n_weekday_days: 0,
        n_weekend_days: 0,
        weekday_duration_min_avg_daily: [] as number[],
        weekend_duration_min_avg_daily: [] as number[],
        weekday_trips_avg_daily: [] as number[],
        weekend_trips_avg_daily: [] as number[],
      },
    })),
    loadPreparedData<StationInOutLatestFullMonthData>('stations/station_in_out_latest_full_month.json').catch(() => null),
    loadWeatherJson(),
  ]);

  const avgTime = avgTimeRes.data;
  const eda = edaRes.data;

  // Handle both { routes: [...] } and direct array
  const routesPayload = routesRes.data;
  const routes = ('routes' in routesPayload && Array.isArray(routesPayload.routes))
    ? (routesPayload as RoutesData).routes
    : [];

  const routeCounts = new Map<string, number>(
    pairCountRows.map((r: RoutePairCount) => [String(r.route_key), Number(r.count)])
  );

  const dailySeries = dailyNormRes?.data?.series ?? [];
  const durationByContext = durationCtxRes?.data?.duration_by_context ?? [];
  const calendarDaysByContext = durationCtxRes?.data?.calendar_days_by_context;
  const hr = hourlyRidingRes?.data;
  const hourlyRidingProfile =
    hr &&
    hr.weekday_duration_min_avg_daily?.length === 24 &&
    hr.weekend_duration_min_avg_daily?.length === 24 &&
    hr.weekday_trips_avg_daily?.length === 24 &&
    hr.weekend_trips_avg_daily?.length === 24
      ? hr
      : null;
  const stationInOut = stationInOutRes?.data ?? null;

  return {
    stations,
    avgTime,
    eda,
    routes,
    routeCounts,
    dailySeries,
    durationByContext,
    calendarDaysByContext,
    hourlyRidingProfile,
    stationInOut,
    weather,
  };
}

function animateCounter(el: HTMLElement, target: number, suffix = '') {
  const duration = 1200;
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(ease * target).toLocaleString() + suffix;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function syncWhenChapterCopySide(step: number) {
  document.getElementById('ch-when')?.setAttribute('data-when-copy-side', step <= 1 ? 'right' : 'left');
}

function dispatch(chapter: string, step: number) {
  switch (chapter) {
    case 'yearly': updateYearlyChart(step); break;
    case 'seasonal': updateSeasonalChart(step); break;
    case 'when':
      updateWhenRiding(step);
      syncWhenChapterCopySide(step);
      break;
    case 'balance': updateBalanceMap(step); break;
    case 'routes': updateRoutesMap(step); break;
  }
}

async function init() {
  const loadingEl = document.getElementById('vs-loading');

  try {
    const {
      stations,
      avgTime,
      eda,
      routes,
      routeCounts,
      dailySeries,
      durationByContext,
      calendarDaysByContext,
      hourlyRidingProfile,
      stationInOut,
      weather,
    } = await loadAllData();

    // Hero stats
    const tripsEl = document.getElementById('stat-trips');
    const stationsEl = document.getElementById('stat-stations');
    if (tripsEl) animateCounter(tripsEl, Math.round(eda.n_trips / 100_000) * 100_000, '+');
    if (stationsEl) animateCounter(stationsEl, stations.length);

    // Init all visualizations
    await initHeroMap('hero-map', stations);
    initYearlyChart('#viz-yearly', avgTime);
    initSeasonalChart('#viz-seasonal', avgTime);
    initWhenRiding({
      barsSvg: '#viz-when-bars',
      scatterSvg: '#viz-when-scatter',
      hourlySvg: '#viz-when-hourly',
      hourlyRow: '#viz-when-hourly-row',
      footnoteEl: '#viz-when-footnote',
      hintEl: '#viz-when-hint',
      durationByContext,
      calendarDaysByContext,
      hourlyRidingProfile,
      dailySeries,
      weather,
      stationInOut,
    });
    await initBalanceMap('viz-balance-map', stations);
    await initRoutesMap('viz-routes-map', stations, routes, routeCounts);

    // Trigger initial states
    updateYearlyChart(0);
    updateSeasonalChart(0);
    updateWhenRiding(0);
    updateBalanceMap(0);
    updateRoutesMap(0);

    loadingEl?.remove();

    const scroller = scrollama();
    scroller
      .setup({ step: '.vs-step', offset: 0.5 })
      .onStepEnter(({ element }: { element: HTMLElement }) => {
        document.querySelectorAll<HTMLElement>('.vs-step').forEach(el => el.classList.remove('is-active'));
        element.classList.add('is-active');
        dispatch(element.dataset.chapter ?? '', Number(element.dataset.step ?? 0));
      });

    window.addEventListener('resize', () => scroller.resize());

  } catch (err) {
    console.error('Visual story data load failed:', err);
    if (loadingEl) {
      loadingEl.textContent = 'Failed to load data. Please refresh.';
      (loadingEl as HTMLElement).style.color = '#ef4444';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}
