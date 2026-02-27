#!/usr/bin/env node
/**
 * Export routes from routes-cache/ to prepared-data/routes.json (slim format).
 * Reads full cached responses and writes only essential fields for frontend.
 *
 * Size: Full cache ~12 KB/route. Slim ~400 bytes/route.
 * At 85k routes: full ~1 GB (gitignored), slim ~25 MB.
 *
 * Warns if any route has more than one leg (unexpected for station-to-station).
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const cacheDir = path.join(projectRoot, 'routes-cache', 'single');
const preparedDir = path.join(projectRoot, 'prepared-data');
const slimOutPath = path.join(preparedDir, 'routes.json');
const mediumOutPath = path.join(preparedDir, 'routes_medium.json');

function parseDuration(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d+)s$/);
  return m ? parseInt(m[1], 10) : null;
}

function exportRoutes() {
  let files = [];
  if (fs.existsSync(cacheDir)) {
    files = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.json'));
  } else {
    console.log('routes-cache/single/ not found, writing empty routes.');
  }
  const routes = [];

  for (const file of files) {
    const full = path.join(cacheDir, file);
    const raw = JSON.parse(fs.readFileSync(full, 'utf-8'));
    const { origin_id, dest_id, response } = raw;
    const r = response?.routes?.[0];
    if (!r) continue;

    const legs = r.legs ?? [];
    if (legs.length > 1) {
      console.warn(`[WARN] Route ${origin_id}→${dest_id} has ${legs.length} legs (expected 1 for station-to-station)`);
    }

    const durationSec = parseDuration(r.duration) ?? parseDuration(legs[0]?.duration);
    const encodedPolyline =
      r.polyline?.encodedPolyline ?? legs[0]?.polyline?.encodedPolyline;
    const distanceM = r.distanceMeters ?? legs[0]?.distanceMeters;

    routes.push({
      origin_id: String(origin_id),
      dest_id: String(dest_id),
      duration_sec: durationSec,
      distance_m: distanceM,
      encodedPolyline: encodedPolyline || null,
    });
  }

  const timestamp = new Date().toISOString();
  fs.mkdirSync(preparedDir, { recursive: true });

  const data = {
    last_export: { timestamp },
    data: { routes },
  };
  fs.writeFileSync(slimOutPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Exported ${routes.length} route(s) to prepared-data/routes.json`);

  if (fs.existsSync(mediumOutPath)) {
    fs.unlinkSync(mediumOutPath);
    console.log('Removed deprecated prepared-data/routes_medium.json');
  }
}

exportRoutes();
