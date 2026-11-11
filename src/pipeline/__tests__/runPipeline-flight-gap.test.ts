import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertRawPoint } from '../../db/rawPoints';
import { insertRawActivity } from '../../db/rawActivities';
import { listTrips, getTripById } from '../../db/trips';
import { getPlaceById } from '../../db/places';
import { runPipeline } from '../runPipeline';
import { mkPoint, mkActivity, resetIds } from './_fixtures';
import { haversineMeters } from '../../lib/distance';
import type { RawPoint, RawActivity } from '../../types';
import type { Db } from '../../db/client';

// Tester export 2026-11-09: drive to CDG, a long wait at the gate, then the
// phone goes to airplane mode for a ~17 h flight and the next fix is in
// Manila. The gate wait is a dwell, so the airborne hop sits between a stay
// and the arrival trip. It used to belong to no segment (single run: a 1.9 km
// "bike" trip) or, when the gate fixes were consumed by an earlier run, to be
// dropped entirely (the Manila trip started from nowhere).
const CDG = { lat: 49.0, lon: 2.55 };
const MNL = { lat: 14.52, lon: 121.01 };
const T0 = 1_700_000_000_000;

function scenario(): {
  points: RawPoint[];
  activities: RawActivity[];
  gateEndMs: number;
  arriveMs: number;
} {
  resetIds();
  const points: RawPoint[] = [];
  const activities: RawActivity[] = [];
  // Drive ~2 km to the airport over 3 min.
  for (let i = 0; i <= 12; i++) {
    points.push(mkPoint(T0 + i * 15_000, CDG.lat - 0.018 * (1 - i / 12), CDG.lon));
    activities.push(mkActivity(T0 + i * 15_000, 'in_vehicle'));
  }
  // Wait at the gate for 40 min (a stay that ends the drive).
  const gateStart = T0 + 13 * 15_000;
  for (let i = 0; i <= 40; i++) points.push(mkPoint(gateStart + i * 60_000, CDG.lat, CDG.lon));
  activities.push(mkActivity(gateStart + 30_000, 'still'));
  const gateEndMs = gateStart + 40 * 60_000;
  // Airplane mode for 17 h, next fix ~10 700 km away.
  const arriveMs = gateEndMs + 17 * 3_600_000;
  // Walk out of the arrival terminal for 6 min.
  for (let i = 0; i <= 12; i++) {
    points.push(mkPoint(arriveMs + i * 30_000, MNL.lat + 0.0004 * i, MNL.lon));
  }
  activities.push(mkActivity(arriveMs + 30_000, 'walking'));
  // Stay at the hotel for 40 min.
  const hotelStart = arriveMs + 13 * 30_000;
  for (let i = 0; i <= 40; i++) {
    points.push(mkPoint(hotelStart + i * 60_000, MNL.lat + 0.0048, MNL.lon));
  }
  return { points, activities, gateEndMs, arriveMs };
}

async function insertAll(db: Db, points: RawPoint[], activities: RawActivity[]) {
  for (const p of points) await insertRawPoint(db, p);
  for (const a of activities) await insertRawActivity(db, a);
}

async function flightTrip(db: Db) {
  const trips = await listTrips(db, 10, 0);
  for (const t of trips) {
    const full = (await getTripById(db, t.id!))!;
    if (full.sections.some((s) => s.mode === 'plane')) return full;
  }
  return null;
}

describe('runPipeline — airplane-mode flight right after a gate wait', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('keeps the hop as a plane section when both sides are in one run', async () => {
    const { points, activities, gateEndMs } = scenario();
    await insertAll(db, points, activities);
    const upToMs = points[points.length - 1]!.timestampMs + 1000;
    await runPipeline(db, { upToMs, nowMs: upToMs });

    const trip = await flightTrip(db);
    expect(trip).not.toBeNull();
    expect(trip!.dominantMode).toBe('plane');
    expect(trip!.distanceM).toBeGreaterThan(10_000_000);
    expect(trip!.startTimeMs).toBe(gateEndMs);
  });

  it('reconnects the hop when the gate fixes were consumed by an earlier run', async () => {
    const { points, activities, gateEndMs, arriveMs } = scenario();
    await insertAll(db, points, activities);
    // Run 1 fires at the gate (stationary detection), before the flight.
    await runPipeline(db, { upToMs: gateEndMs + 1000, nowMs: gateEndMs + 1000 });
    expect(await flightTrip(db)).toBeNull();
    // Run 2 fires after landing.
    const upToMs = points[points.length - 1]!.timestampMs + 1000;
    await runPipeline(db, { upToMs, nowMs: upToMs });

    const trip = await flightTrip(db);
    expect(trip).not.toBeNull();
    expect(trip!.dominantMode).toBe('plane');
    expect(trip!.startTimeMs).toBe(gateEndMs);
    expect(trip!.endTimeMs).toBeGreaterThan(arriveMs);
    // The trip starts at the departure airport, not where GPS resumed.
    const start = (await getPlaceById(db, trip!.startPlaceId!))!;
    expect(haversineMeters(start.latitude, start.longitude, CDG.lat, CDG.lon)).toBeLessThan(500);
  });

  it('does not reach back across an overnight gap at the same place', async () => {
    resetIds();
    const points: RawPoint[] = [];
    // Evening at home, consumed by a first run.
    for (let i = 0; i <= 40; i++) points.push(mkPoint(T0 + i * 60_000, 45.0, 5.0));
    const eveningEnd = T0 + 40 * 60_000;
    // 9 h without fixes, then a morning walk starting 200 m away.
    const morning = eveningEnd + 9 * 3_600_000;
    for (let i = 0; i <= 12; i++) points.push(mkPoint(morning + i * 30_000, 45.0018 + 0.0004 * i, 5.0));
    const stay = morning + 13 * 30_000;
    for (let i = 0; i <= 40; i++) points.push(mkPoint(stay + i * 60_000, 45.0066, 5.0));
    await insertAll(db, points, []);

    await runPipeline(db, { upToMs: eveningEnd + 1000, nowMs: eveningEnd + 1000 });
    const upToMs = points[points.length - 1]!.timestampMs + 1000;
    await runPipeline(db, { upToMs, nowMs: upToMs });

    const trips = await listTrips(db, 10, 0);
    expect(trips).toHaveLength(1);
    expect(trips[0]!.startTimeMs).toBeGreaterThanOrEqual(morning);
  });
});
