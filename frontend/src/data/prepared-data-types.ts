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

/** Isochrone data from isochrone_precompute.ipynb */
export interface IsochroneStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface IsochronesData {
  stations: IsochroneStation[];
  time_bands_min: number[];
  isochrones: Record<string, Record<string, { type: 'Polygon'; coordinates: number[][][] }>>;
}

/** Leg in medium format – start derived from route origin or previous leg end */
export interface RouteLeg {
  end_lat: number;
  end_lon: number;
  distance_m: number;
  duration_sec: number;
  encodedPolyline: string;
}

/** Slim or medium route from routes-cache export */
export interface RouteData {
  origin_id: string;
  dest_id: string;
  duration_sec: number | null;
  distance_m: number | null;
  start_lat?: number;
  start_lon?: number;
  encodedPolyline?: string | null;
  legs?: RouteLeg[];
}

export interface RoutesData {
  routes: RouteData[];
}
