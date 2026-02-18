/**
 * Load prepared data from /prepared-data/ (synced from project root).
 * Types align with Python pipeline output (write_with_execution_metadata).
 */

import type { PreparedDataWithMetadata } from './prepared-data-types.js';

const base = import.meta.env.BASE_URL ?? '/';

export async function loadPreparedData<T>(
  filename: string
): Promise<PreparedDataWithMetadata<T>> {
  const url = `${base}prepared-data/${filename}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${filename}: ${res.status}`);
  }
  const json = (await res.json()) as PreparedDataWithMetadata<T>;
  if (!json || typeof json !== 'object') {
    throw new Error(`Invalid prepared data: ${filename}`);
  }
  return json;
}
