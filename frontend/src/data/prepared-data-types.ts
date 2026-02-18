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

/** EDA summary from L12_Oslo_Bysykkel_EDA.ipynb */
export interface EdaSummaryStats {
  n_trips: number;
  n_months: number;
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
