import scrollama from 'scrollama';
import { loadPreparedData } from '../../data/load-prepared-data.js';
import type { AvgTripTimeByMonthRow, EdaSummaryStats } from '../../data/prepared-data-types.js';
import {
  initMapViz, updateMapViz,
  initYearlyChart, updateYearlyChart,
  initSeasonalChart, updateSeasonalChart,
  initStationsChart, updateStationsChart,
  initDurationChart, updateDurationChart,
  type StationDatum,
} from './charts.js';

const base = (import.meta as { env: { BASE_URL: string } }).env.BASE_URL ?? '/';

async function loadAllData() {
  const [stationsRes, districtRes, avgTimeRes, edaRes] = await Promise.all([
    fetch(`${base}prepared-data/stations.json`).then(async r => {
      if (!r.ok) throw new Error(`stations.json: ${r.status}`);
      const json = await r.json() as { data?: { stations?: StationDatum[] } } | StationDatum[];
      if (Array.isArray(json)) return json;
      return (json as { data?: { stations?: StationDatum[] } }).data?.stations ?? [];
    }),
    fetch(`${base}prepared-data/delbydeler.geojson`).then(r => {
      if (!r.ok) throw new Error(`delbydeler.geojson: ${r.status}`);
      return r.json() as Promise<GeoJSON.FeatureCollection>;
    }),
    loadPreparedData<AvgTripTimeByMonthRow[]>('avg_trip_time_by_month.json'),
    loadPreparedData<EdaSummaryStats>('eda_summary_stats.json'),
  ]);

  // Build a lookup from station name → metadata for tooltip enrichment
  const stationMeta = new Map(stationsRes.map(s => [s.name, s]));

  const stationRanks = (edaRes.data.station_trip_counts ?? []).map(r => {
    const meta = stationMeta.get(r.station_name);
    return {
      ...r,
      bydel: meta?.bydel,
      trips_as_origin: meta?.trips_as_origin,
      trips_as_dest: meta?.trips_as_dest,
    };
  });

  return {
    stations: stationsRes,
    districts: districtRes,
    avgTime: avgTimeRes.data,
    stationRanks,
  };
}

function dispatch(chapter: string, step: number) {
  switch (chapter) {
    case 'intro':    updateMapViz(step); break;
    case 'temporal': updateYearlyChart(step); break;
    case 'seasonal': updateSeasonalChart(step); break;
    case 'stations': updateStationsChart(step); break;
    case 'duration': updateDurationChart(step); break;
  }
}

async function init() {
  const loadingEl = document.getElementById('story-loading');

  try {
    const { stations, districts, avgTime, stationRanks } = await loadAllData();

    initMapViz('#viz-map', stations, districts);
    initYearlyChart('#viz-yearly', avgTime);
    initSeasonalChart('#viz-seasonal', avgTime);
    initStationsChart('#viz-stations', stationRanks);
    initDurationChart('#viz-duration', avgTime);

    // Trigger the first step of each chapter so charts render in their initial state
    updateMapViz(0);
    updateYearlyChart(0);
    updateSeasonalChart(0);
    updateStationsChart(0);
    updateDurationChart(0);

    loadingEl?.remove();

    const scroller = scrollama();
    scroller
      .setup({ step: '.step', offset: 0.5 })
      .onStepEnter(({ element }: { element: HTMLElement; index: number; direction: string }) => {
        document.querySelectorAll<HTMLElement>('.step').forEach(el => el.classList.remove('is-active'));
        element.classList.add('is-active');
        const chapter = element.dataset.chapter ?? '';
        const step = Number(element.dataset.step ?? 0);
        dispatch(chapter, step);
      });

    window.addEventListener('resize', () => scroller.resize());

  } catch (err) {
    console.error('Story data load failed:', err);
    if (loadingEl) {
      loadingEl.textContent = 'Failed to load data. Please refresh.';
      loadingEl.style.color = '#ef4444';
    }
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}
