/**
 * Type definitions for prepared data output from the Python pipeline.
 * Matches the structure from execution_utils.write_with_execution_metadata().
 */

export interface LastExecution {
  timestamp?: string;
  os?: string;
  cpu_count?: number;
  processor?: string;
  ram_gb?: number;
  ram_used_pct?: number;
  duration_seconds?: number;
}

export interface PreparedDataWithMetadata<T> {
  last_execution?: LastExecution;
  data: T;
}

export interface AvgTripTimeByMonthRow {
  year: number;
  month: number;
  avg_trip_seconds: number;
  trip_count: number;
}

/** Dataset info from df.info() - structured for export */
export interface DatasetInfo {
  n_rows: number;
  n_columns: number;
  columns: Array<{ name: string; dtype: string; non_null: number }>;
  memory_mb: number;
}

/** Summary stats from df.describe() - numeric columns */
export type SummaryStats = Record<string, Record<string, number>>;

/** EDA summary from L12_Oslo_Bysykkel_EDA.ipynb */
export interface EdaSummaryStats {
  n_trips: number;
  n_months: number;
  /** Structured dataset info (columns, dtypes, memory) */
  dataset_info?: DatasetInfo;
  /** Numeric columns describe output (count, mean, std, min, 25%, 50%, 75%, max) */
  summary_stats?: SummaryStats;
  duration_stats: {
    mean_min: number;
    median_min: number;
    std_min: number;
    skewness: number;
    kurtosis: number;
  };
  avg_by_month: Array<{
    year: number;
    month: number;
    avg_duration_min: number;
    trip_count: number;
  }>;
  /** Raw null counts per column (added in EDA pipeline) */
  null_counts_per_column?: Record<string, number>;
  /** All stations sorted by trip count (added in EDA pipeline) */
  station_trip_counts?: Array<{ station_name: string; trip_count: number }>;
  /** 1-min bins 0–60 (added in EDA pipeline) */
  duration_distribution?: Array<{ bin_min: number; count: number }>;
}

/** Station from stations.json or isochrone data */
export interface IsochroneStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Bydel (district) from stations_prepare region assignment */
  bydel?: string;
  /** Delbydel (sub-district) from stations_prepare region assignment */
  delbydel?: string;
  /** Elevation in meters above sea level from DOM1 height data */
  elevation_m?: number;
}

export interface IsochronesData {
  stations: IsochroneStation[];
  time_bands_min: number[];
  isochrones: Record<string, Record<string, { type: 'Polygon'; coordinates: number[][][] }>>;
}

/** Slim route from routes-cache export (prepared-data/routes.json) */
export interface RouteData {
  origin_id: string;
  dest_id: string;
  duration_sec: number | null;
  distance_m: number | null;
  encodedPolyline: string | null;
}

export interface RoutesData {
  routes: RouteData[];
}

/** Route pair counts from route_pair_counts.parquet */
export interface RoutePairCount {
  route_key: string;
  count: number;
}

/** Route binned rows from route_by_year.parquet, route_by_month.parquet, route_by_day_YYYY.parquet */
export interface RouteBinnedRow {
  period: string;
  route_key: string;
  hour: number;
  count: number;
}

/** One day of weather from export-weather-to-prepared (Frost Oslo Blindern). */
export interface WeatherOsloRow {
  date: string;
  temperature?: number;
  precipitation?: number;
  wind_speed?: number;
  relative_humidity?: number;
}

/** Weather payload in prepared-data/weather_oslo.json */
export interface WeatherOsloData {
  source_id: string;
  station_name: string;
  data: WeatherOsloRow[];
}

/** Ridge regression summary from cycling_regression.py */
export interface CyclingRegressionSummaries {
  model: string;
  ridge_alpha: number;
  duration_quantile_cap: number;
  min_duration_sec: number;
  train_years: string;
  val_year: number;
  test_years: string;
  route_target_encoding: string;
  metrics: {
    train: { n: number; rmse_log_duration: number; r2: number };
    val_2023: { n: number; rmse_log_duration: number; r2: number };
    test_2024_plus: { n: number; rmse_log_duration: number; r2: number };
  };
  intercept_log: number;
  coefficients: Record<string, number>;
}

/** One cell from cycling_duration_by_context.json */
export interface CyclingDurationContextRow {
  time_of_day_bucket: string;
  is_weekend: boolean;
  is_public_holiday: boolean;
  mean_sec: number;
  median_sec: number;
  count: number;
  /** Distinct calendar days in this (weekend × holiday) slice; from cycling_regression.py trip filter. */
  n_days?: number;
}

export interface CyclingCalendarDaysContextRow {
  is_weekend: boolean;
  is_public_holiday: boolean;
  n_days: number;
}

export interface CyclingDurationByContextData {
  duration_by_context: CyclingDurationContextRow[];
  calendar_days_by_context?: CyclingCalendarDaysContextRow[];
}

/** From cycling_hourly_riding_profile.py — avg daily minutes / trips by start hour. */
export interface CyclingHourlyRidingProfileData {
  norm_definition: string;
  duration_quantile_cap?: number;
  min_duration_sec?: number;
  n_weekday_days: number;
  n_weekend_days: number;
  weekday_duration_min_avg_daily: number[];
  weekend_duration_min_avg_daily: number[];
  weekday_trips_avg_daily: number[];
  weekend_trips_avg_daily: number[];
}

/** One day from cycling_daily_norm_series.json */
export interface CyclingDailyNormPoint {
  date: string;
  total_duration_min: number;
  trip_count: number;
  norm_total_min: number | null;
  pct_vs_norm: number | null;
  is_weekend: boolean;
  any_holiday: boolean;
}

export interface CyclingDailyNormSeriesData {
  series: CyclingDailyNormPoint[];
  norm_definition: string;
}

/** Month span for two-year comparison blocks (inclusive months). */
export interface NewsMonthSpanYear {
  year: number;
  startMonth: number;
  endMonth: number;
}

/** Discriminated comparison spec for news prediction stories. */
export type NewsArticleComparison =
  | {
      type: 'tri_year_range';
      start: string;
      end: string;
      /** Inclusive ISO range; month–day compared to each plotted day (same calendar dates each year). */
      highlightRange?: { start: string; end: string };
      /** Full-width line chart only (bars still used for scoring / reveal text). */
      linesOnly?: boolean;
      /** Override default line-chart footnote when present. */
      xAxisLineCaption?: string;
    }
  | {
      type: 'tri_year_month';
      focalYear: number;
      month: number;
    }
  | {
      type: 'explicit_month_three_bars';
      month: number;
      years: [number, number, number] | number[];
      truthCompare: 'last_vs_first';
    }
  | {
      type: 'two_year_month_span';
      left: NewsMonthSpanYear;
      right: NewsMonthSpanYear;
      truthCompare: 'right_vs_left';
    }
  | {
      /** One calendar month in a single year: full-width line only, optional default calendar shading. */
      type: 'single_year_month_line';
      year: number;
      month: number;
      /** ISO YYYY-MM-DD; emphasized on the chart when they fall inside the month (e.g. publication date). */
      markerDates?: string[];
      xAxisLineCaption?: string;
    };

export interface NewsPredictionArticle {
  id: string;
  url: string;
  publishedDate: string;
  title: string;
  summary: string;
  question: string;
  /** When true, the story-news page skips this entry. */
  disabled?: boolean;
  relatedUrls?: string[];
  comparison: NewsArticleComparison;
  predictionLabels?: Partial<{ up: string; down: string; steady: string }>;
  notesForReveal?: string[];
}

export interface NewsPredictionArticlesPayload {
  articles: NewsPredictionArticle[];
}

/** Per-station averages from export_station_in_out_month.py (stations/station_in_out_latest_full_month.json) */
export interface StationInOutDatum {
  id: string;
  avg_weekday_departures: number;
  avg_weekday_destinations: number;
  avg_weekend_departures: number;
  avg_weekend_destinations: number;
  /** Avg trips ending at this station in that clock hour on a typical weekday (24 values). */
  hourly_weekday_destinations?: number[];
  hourly_weekday_departures?: number[];
  hourly_weekend_destinations?: number[];
  hourly_weekend_departures?: number[];
}

export interface StationInOutLatestFullMonthData {
  month_label: string;
  max_period_in_data?: string;
  n_weekdays: number;
  n_weekend_days: number;
  day_coverage_in_month?: number;
  warnings?: string[];
  stations: StationInOutDatum[];
}
