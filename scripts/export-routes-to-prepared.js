#!/usr/bin/env node
/**
 * Export routes from routes-cache/ to prepared-data.
 * Writes two formats:
 * - routes.json (slim): origin_id, dest_id, duration_sec, distance_m, encodedPolyline
 * - routes_medium.json (medium): route origin + legs with end_lat/lon, distance, duration, polyline per leg
 *
 * Size: Full cache ~12 KB/route. Slim ~400 bytes/route. Medium ~480 bytes/route.
 * At 85k routes: full ~1 GB (gitignored), slim ~25 MB, medium ~35 MB.
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
  const routesSlim = [];
  const routesMedium = [];

  for (const file of files) {
    const full = path.join(cacheDir, file);
    const raw = JSON.parse(fs.readFileSync(full, 'utf-8'));
    const { origin_id, dest_id, response } = raw;
    const r = response?.routes?.[0];
    if (!r) continue;

    const durationSec = parseDuration(r.duration) ?? parseDuration(r.legs?.[0]?.duration);
    const encodedPolyline =
      r.polyline?.encodedPolyline ?? r.legs?.[0]?.polyline?.encodedPolyline;
    const distanceM = r.distanceMeters ?? r.legs?.[0]?.distanceMeters;

    routesSlim.push({
      origin_id: String(origin_id),
      dest_id: String(dest_id),
      duration_sec: durationSec,
      distance_m: distanceM,
      encodedPolyline: encodedPolyline || null,
    });

    // Medium format: route origin + legs with end_lat/lon only
    const legs = r.legs ?? [];
    const startLocation = legs[0]?.startLocation?.latLng;
    const mediumRoute = {
      origin_id: String(origin_id),
      dest_id: String(dest_id),
      duration_sec: durationSec,
      distance_m: distanceM,
      start_lat: startLocation?.latitude ?? null,
      start_lon: startLocation?.longitude ?? null,
      legs: legs.map((leg) => {
        const endLoc = leg.endLocation?.latLng;
        return {
          end_lat: endLoc?.latitude ?? null,
          end_lon: endLoc?.longitude ?? null,
          distance_m: leg.distanceMeters ?? null,
          duration_sec: parseDuration(leg.duration) ?? null,
          encodedPolyline: leg.polyline?.encodedPolyline ?? '',
        };
      }),
    };
    routesMedium.push(mediumRoute);
  }

  const timestamp = new Date().toISOString();
  fs.mkdirSync(preparedDir, { recursive: true });

  const slimData = {
    last_export: { timestamp },
    data: { routes: routesSlim },
  };
  fs.writeFileSync(slimOutPath, JSON.stringify(slimData, null, 2), 'utf-8');
  console.log(`Exported ${routesSlim.length} route(s) to prepared-data/routes.json`);

  const mediumData = {
    last_export: { timestamp },
    data: { routes: routesMedium },
  };
  fs.writeFileSync(mediumOutPath, JSON.stringify(mediumData, null, 2), 'utf-8');
  console.log(`Exported ${routesMedium.length} route(s) to prepared-data/routes_medium.json`);
}

exportRoutes();
