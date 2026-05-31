import type { RawPoint, RawActivity, ActivityType } from '../../types';

let nextId = 1;
export function resetIds() {
  nextId = 1;
}

export function mkPoint(
  t: number,
  lat: number,
  lon: number,
  accuracy = 5,
  speedMps: number | null = null
): RawPoint {
  return {
    id: nextId++,
    timestampMs: t,
    latitude: lat,
    longitude: lon,
    altitude: null,
    accuracyMeters: accuracy,
    speedMps,
    bearingDeg: null,
    batteryLevel: null,
    isCharging: false,
    consumed: false,
  };
}

export function mkActivity(
  t: number,
  type: ActivityType,
  confidence = 90
): RawActivity {
  return {
    id: nextId++,
    timestampMs: t,
    type,
    confidence,
    consumed: false,
  };
}

/**
 * Generates a synthetic multi-section trip:
 *   stay at A (35 min)
 *   walk east 200m (4 min)
 *   drive 2km north (3 min)
 *   walk west 200m (4 min)
 *   stay at B (35 min)
 *
 * Stay durations are ≥ 30 min so they trip the trip-boundary threshold
 * (RULE_TRIP_BREAK_MAX) and bound a real trip rather than surfacing as
 * breaks. Returns (points, activities) suitable for full-pipeline tests.
 */
export function syntheticTrip(opts: { startMs?: number } = {}): {
  points: RawPoint[];
  activities: RawActivity[];
} {
  resetIds();
  const t0 = opts.startMs ?? 1_700_000_000_000;
  const points: RawPoint[] = [];
  const activities: RawActivity[] = [];

  const lat0 = 45.0;
  const lon0 = 5.0;

  // Stay at A for 35 minutes, 1 point per minute
  for (let i = 0; i <= 35; i++) {
    points.push(mkPoint(t0 + i * 60_000, lat0, lon0));
  }
  activities.push(mkActivity(t0 + 30_000, 'still'));
  activities.push(mkActivity(t0 + 5 * 60_000, 'still'));

  // Walk east ~200m (each 0.0025deg lon ≈ 200m at lat 45) over 4 minutes, every 30s
  const walkStart = t0 + 36 * 60_000;
  for (let i = 0; i <= 8; i++) {
    points.push(mkPoint(walkStart + i * 30_000, lat0, lon0 + 0.0003 * i));
  }
  for (let i = 0; i < 8; i++) {
    activities.push(mkActivity(walkStart + i * 30_000, 'walking'));
  }

  // Drive 2km north over 3 minutes
  const driveStart = walkStart + 8 * 30_000 + 1000;
  const driveLat = lat0 + 0.018; // ~2km north
  for (let i = 0; i <= 6; i++) {
    const f = i / 6;
    points.push(
      mkPoint(driveStart + i * 30_000, lat0 + 0.018 * f, lon0 + 0.0024)
    );
  }
  for (let i = 0; i < 6; i++) {
    activities.push(mkActivity(driveStart + i * 30_000, 'in_vehicle'));
  }

  // Walk west ~200m over 4 minutes
  const walk2Start = driveStart + 6 * 30_000 + 1000;
  for (let i = 0; i <= 8; i++) {
    points.push(mkPoint(walk2Start + i * 30_000, driveLat, lon0 + 0.0024 - 0.0003 * i));
  }
  for (let i = 0; i < 8; i++) {
    activities.push(mkActivity(walk2Start + i * 30_000, 'walking'));
  }

  // Stay at B for 35 minutes (1 point per minute)
  const stayBStart = walk2Start + 8 * 30_000 + 1000;
  const endLat = driveLat;
  const endLon = lon0;
  for (let i = 0; i <= 35; i++) {
    points.push(mkPoint(stayBStart + i * 60_000, endLat, endLon));
  }
  activities.push(mkActivity(stayBStart + 30_000, 'still'));
  activities.push(mkActivity(stayBStart + 5 * 60_000, 'still'));

  return { points, activities };
}
