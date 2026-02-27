#!/usr/bin/env node
/**
 * Export routes from routes-cache/ to prepared-data/routes.json (slim format).
 * Reads full cached responses and writes only essential fields for frontend.
 *
 * Size: Full cache ~12 KB/route (steps, nav instructions, etc). Slim ~300 bytes/route
 * (origin_id, dest_id, duration_sec, distance_m, encodedPolyline). At 85k routes:
 * full ~1 GB (gitignored), slim ~25 MB (acceptable for prepared-data).
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const cacheDir = path.join(projectRoot, 'routes-cache', 'single');
const outPath = path.join(projectRoot, 'prepared-data', 'routes.json');

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

    const durationSec = parseDuration(r.duration) ?? parseDuration(r.legs?.[0]?.duration);
    const encodedPolyline =
      r.polyline?.encodedPolyline ?? r.legs?.[0]?.polyline?.encodedPolyline;

    routes.push({
      origin_id: String(origin_id),
      dest_id: String(dest_id),
      duration_sec: durationSec,
      distance_m: r.distanceMeters ?? r.legs?.[0]?.distanceMeters,
      encodedPolyline: encodedPolyline || null,
    });
  }

  const data = {
    last_export: { timestamp: new Date().toISOString() },
    data: { routes },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(
    `Exported ${routes.length} route(s) to prepared-data/routes.json`
  );
}

exportRoutes();
