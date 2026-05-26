/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
/**
 * One-off: compare segmentation output WITH and WITHOUT the new
 * RULE_STATIONARY_BOUNDARY refinement on a user DB export. Reports the
 * gap from each trip's first/last point to its associated place.
 *
 * Usage: npx tsx scripts/compare-segmentation.ts <path-to-export.db>
 */
import { accuracyFilter } from '../src/pipeline/accuracyFilter';
import { segmentation, type Segment } from '../src/pipeline/segmentation';
import { haversineMeters } from '../src/lib/distance';
import type { RawPoint, RawActivity } from '../src/types';

function open(path: string) {
  const Better = require('better-sqlite3');
  return new Better(path, { readonly: true });
}

function loadPoints(db: any): RawPoint[] {
  return db
    .prepare('SELECT * FROM raw_points ORDER BY timestamp_ms')
    .all()
    .map((r: any) => ({
      id: r.id,
      timestampMs: r.timestamp_ms,
      latitude: r.latitude,
      longitude: r.longitude,
      altitude: r.altitude,
      accuracyMeters: r.accuracy_m,
      speedMps: r.speed_mps,
      bearingDeg: r.bearing_deg,
      batteryLevel: r.battery_level,
      isCharging: !!r.is_charging,
      consumed: !!r.consumed,
    }));
}

function loadActivities(db: any): RawActivity[] {
  return db
    .prepare('SELECT * FROM raw_activities ORDER BY timestamp_ms')
    .all()
    .map((r: any) => ({
      id: r.id,
      timestampMs: r.timestamp_ms,
      type: r.type,
      confidence: r.confidence,
      consumed: !!r.consumed,
    }));
}

function loadPlaces(db: any) {
  return db
    .prepare('SELECT id, latitude, longitude, display_name FROM places')
    .all()
    .map((r: any) => ({ id: r.id, lat: r.latitude, lon: r.longitude, name: r.display_name }));
}

function nearestPlace(lat: number, lon: number, places: ReturnType<typeof loadPlaces>) {
  let best = places[0]!;
  let bestD = haversineMeters(lat, lon, best.lat, best.lon);
  for (const p of places.slice(1)) {
    const d = haversineMeters(lat, lon, p.lat, p.lon);
    if (d < bestD) { best = p; bestD = d; }
  }
  return { place: best, dist: bestD };
}

function reportTrips(
  label: string,
  segs: Segment[],
  places: ReturnType<typeof loadPlaces>
) {
  console.log(`\n=== ${label} ===`);
  const trips = segs.filter((s) => s.kind === 'trip') as Array<{
    kind: 'trip';
    points: RawPoint[];
  }>;
  const stays = segs.filter((s) => s.kind === 'stay') as Array<{
    kind: 'stay';
    startMs: number;
    endMs: number;
    centerLat: number;
    centerLon: number;
  }>;
  console.log(`  ${trips.length} trips, ${stays.length} stays`);
  trips.forEach((t, i) => {
    const first = t.points[0]!;
    const last = t.points[t.points.length - 1]!;
    const fp = nearestPlace(first.latitude, first.longitude, places);
    const lp = nearestPlace(last.latitude, last.longitude, places);
    const startT = new Date(first.timestampMs).toISOString().slice(11, 19);
    const endT = new Date(last.timestampMs).toISOString().slice(11, 19);
    const dur = Math.round((last.timestampMs - first.timestampMs) / 1000);
    console.log(
      `  Trip ${i + 1}  ${startT}→${endT}  ${t.points.length} pts  ${dur}s  ` +
        `start ${fp.dist.toFixed(0)}m from P${fp.place.id}, end ${lp.dist.toFixed(0)}m from P${lp.place.id}`
    );
  });
  stays.forEach((s, i) => {
    const startT = new Date(s.startMs).toISOString().slice(11, 19);
    const endT = new Date(s.endMs).toISOString().slice(11, 19);
    const dur = Math.round((s.endMs - s.startMs) / 1000);
    const np = nearestPlace(s.centerLat, s.centerLon, places);
    console.log(
      `  Stay ${i + 1}  ${startT}→${endT}  ${dur}s  center→P${np.place.id} ${np.dist.toFixed(0)}m`
    );
  });
}

function main() {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error('Usage: compare-segmentation <db>');
    process.exit(1);
  }
  const db = open(dbPath);
  const pts = loadPoints(db);
  const acts = loadActivities(db);
  const places = loadPlaces(db);
  const filtered = accuracyFilter(pts);

  console.log(`Raw points: ${pts.length} (filtered: ${filtered.length})`);
  console.log(`Places:`);
  for (const p of places)
    console.log(`  P${p.id} (${p.lat.toFixed(5)},${p.lon.toFixed(5)}) ${p.name ?? ''}`);

  // OLD behaviour: tiny window + huge displacement → every point is "stationary"
  // relative to itself, so refineDwellBoundary returns the original dwell
  // boundaries (legacy behaviour).
  const segsOld = segmentation(filtered, acts, {
    stationaryWindowMs: 1,
    stationaryMaxDisplacementM: 1e9,
  });
  reportTrips('OLD (no stationary refinement)', segsOld, places);

  const segsNew = segmentation(filtered, acts);
  reportTrips('NEW (RULE_STATIONARY_BOUNDARY defaults)', segsNew, places);
}

main();
