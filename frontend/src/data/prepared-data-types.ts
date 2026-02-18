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
