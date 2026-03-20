#!/usr/bin/env node
/**
 * Export weather-cache (Frost API) to prepared-data/weather_oslo.json
 * for the frontend weather page. Safe no-op when weather-cache is missing.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const cacheDir = path.join(projectRoot, 'weather-cache');
const outPath = path.join(projectRoot, 'prepared-data', 'weather_oslo.json');

/** Map Frost elementId to our field name (handles short and aggregate names). */
function fieldForElementId(elementId) {
  if (!elementId || typeof elementId !== 'string') return null;
  const id = elementId.toLowerCase();
  if (id.includes('air_temperature') || id === 'temperature') return 'temperature';
  if (id.includes('precipitation_amount') || id === 'precipitation') return 'precipitation';
  if (id.includes('wind_speed') || id === 'wind_speed') return 'wind_speed';
  if (id.includes('relative_humidity') || id === 'relative_humidity') return 'relative_humidity';
  return null;
}

/** Parse referenceTime to date string YYYY-MM-DD. */
function toDateKey(refTime) {
  if (!refTime || typeof refTime !== 'string') return null;
  const match = refTime.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function main() {
  if (!fs.existsSync(cacheDir)) {
    console.log('weather-cache/ not found, skipping weather export.');
    return;
  }

  const files = fs.readdirSync(cacheDir)
    .filter((f) => f.endsWith('.json') && /^[A-Z0-9]+_\d{4}-\d{2}\.json$/.test(f))
    .sort();

  if (files.length === 0) {
    console.log('No weather cache files found, skipping weather export.');
    ensureEmptyOutput();
    return;
  }

  // date -> { sums: { temperature?, precipitation?, wind_speed?, relative_humidity? }, counts: { ... } }
  const byDate = new Map();

  for (const file of files) {
    const fullPath = path.join(cacheDir, file);
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    } catch (e) {
      console.warn(`Skipping invalid JSON: ${file}`);
      continue;
    }

    const responseData = payload?.response?.data;
    if (!Array.isArray(responseData)) continue;

    for (const item of responseData) {
      const refTime = item.referenceTime;
      const dateKey = toDateKey(refTime);
      if (!dateKey) continue;

      const obs = item.observations;
      if (!Array.isArray(obs)) continue;

      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, {
          sums: {},
          counts: {},
        });
      }
      const acc = byDate.get(dateKey);

      for (const o of obs) {
        const field = fieldForElementId(o.elementId);
        if (field == null || typeof o.value !== 'number') continue;
        if (!acc.sums[field]) acc.sums[field] = 0;
        if (!acc.counts[field]) acc.counts[field] = 0;
        acc.sums[field] += o.value;
        acc.counts[field]++;
      }
    }
  }

  // One row per day: mean for temperature/wind_speed/relative_humidity, sum for precipitation
  const data = Array.from(byDate.entries())
    .map(([date, acc]) => {
      const row = { date };
      for (const field of ['temperature', 'wind_speed', 'relative_humidity']) {
        const n = acc.counts[field];
        if (n && acc.sums[field] != null) row[field] = acc.sums[field] / n;
      }
      if (acc.counts.precipitation && acc.sums.precipitation != null) {
        row.precipitation = acc.sums.precipitation;
      }
      return row;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const sourceId = (data.length && files[0]) ? files[0].replace(/_.*$/, '') : 'SN18700';
  const output = {
    source_id: sourceId,
    station_name: 'Oslo Blindern',
    data,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Exported ${data.length} weather rows to prepared-data/weather_oslo.json`);
}

function ensureEmptyOutput() {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    source_id: 'SN18700',
    station_name: 'Oslo Blindern',
    data: [],
  }, null, 2), 'utf-8');
  console.log('Wrote empty weather_oslo.json (no cache data).');
}

main();
