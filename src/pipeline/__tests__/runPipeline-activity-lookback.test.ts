import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertRawPoint } from '../../db/rawPoints';
import { insertRawActivity } from '../../db/rawActivities';
import { listTrips, getTripById } from '../../db/trips';
import { runPipeline } from '../runPipeline';
import { planRecompute, recomputeForTrips } from '../recomputeRange';
import { mkPoint, mkActivity, resetIds } from './_fixtures';
import type { RawPoint, RawActivity } from '../../types';
import type { Db } from '../../db/client';

/**
 * Field pattern (tester export 2026-08-02, trips 226/260/283/274): the activity
 * recogniser fires in_vehicle 20-30 s BEFORE the first GPS fix that leaves the
 * departure place, so the drive's only in_vehicle event sits just ahead of the
 * trip's first point. Stay 35 min at A → in_vehicle → 2 km drive (3 min) →
 * walking → 200 m walk (2 min) → stay 35 min at B.
 */
function driveThenWalk(t0 = 1_700_000_000_000) {
  resetIds();
  const points: RawPoint[] = [];
  const activities: RawActivity[] = [];
  const lat0 = 45.0;
  const lon0 = 5.0;
  for (let i = 0; i <= 35; i++) points.push(mkPoint(t0 + i * 60_000, lat0, lon0));
  activities.push(mkActivity(t0 + 30_000, 'still', 100));
  const depart = t0 + 36 * 60_000;
  // Last stationary fix 10 s before departure; in_vehicle 30 s before it.
  points.push(mkPoint(depart - 10_000, lat0, lon0));
  activities.push(mkActivity(depart - 30_000, 'in_vehicle', 100));
  for (let i = 0; i <= 12; i++) {
    points.push(mkPoint(depart + i * 15_000, lat0 + 0.018 * (i / 12), lon0));
  }
  const walkStart = depart + 13 * 15_000;
  activities.push(mkActivity(walkStart, 'walking', 100));
  for (let i = 0; i <= 8; i++) {
    points.push(mkPoint(walkStart + i * 15_000, lat0 + 0.018, lon0 - 0.0003 * i));
  }
  const stayB = walkStart + 9 * 15_000;
  for (let i = 0; i <= 35; i++) points.push(mkPoint(stayB + i * 60_000, lat0 + 0.018, lon0 - 0.0024));
  activities.push(mkActivity(stayB + 30_000, 'still', 100));
  return { points, activities, depart, walkStart, stayB, endMs: stayB + 35 * 60_000 };
}

async function seed(db: Db, points: RawPoint[], activities: RawActivity[]) {
  for (const p of points) {
    await insertRawPoint(db, {
      timestampMs: p.timestampMs,
      latitude: p.latitude,
      longitude: p.longitude,
      altitude: p.altitude,
      accuracyMeters: p.accuracyMeters,
      speedMps: p.speedMps,
      bearingDeg: p.bearingDeg,
      batteryLevel: p.batteryLevel,
      isCharging: p.isCharging,
    });
  }
  for (const a of activities) {
    await insertRawActivity(db, {
      timestampMs: a.timestampMs,
      type: a.type,
      confidence: a.confidence,
    });
  }
}

async function modesOfOnlyTrip(db: Db): Promise<string[]> {
  const trips = await listTrips(db, 10, 0);
  expect(trips).toHaveLength(1);
  const full = await getTripById(db, trips[0]!.id!);
  return full!.sections.map((s) => s.mode);
}

describe('RULE_SECTION_ACTIVITY_WINDOW look-back survives incremental runs', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('single run: the drive is a car section (baseline)', async () => {
    const { points, activities, endMs } = driveThenWalk();
    await seed(db, points, activities);
    await runPipeline(db, { upToMs: endMs + 1, nowMs: endMs });
    expect(await modesOfOnlyTrip(db)).toEqual(['car', 'walk']);
  });

  it('open-tail hold keeps the in_vehicle event that precedes the trip\'s first fix', async () => {
    const { points, activities, stayB, endMs } = driveThenWalk();
    await seed(db, points, activities);
    // Run 1 lands 3 min into the arrival stay: too short to be a dwell, so the
    // trip is an open tail. Everything before its first fix is consumed.
    const mid = stayB + 3 * 60_000;
    const r1 = await runPipeline(db, { upToMs: mid, nowMs: mid });
    expect(r1.tripsInserted).toBe(0);
    // Run 2 closes the trip. Before the fix, the in_vehicle event (30 s before
    // the first fix) was consumed by run 1, the drive read as "unknown" and got
    // merged into the following walking section → a 2 km "walk" at 40 km/h.
    await runPipeline(db, { upToMs: endMs + 1, nowMs: endMs });
    expect(await modesOfOnlyTrip(db)).toEqual(['car', 'walk']);
  });

  it('recompute resets the activities in the look-back window before the span', async () => {
    const { points, activities, endMs } = driveThenWalk();
    await seed(db, points, activities);
    await runPipeline(db, { upToMs: endMs + 1, nowMs: endMs });
    const before = await listTrips(db, 10, 0);
    expect(before).toHaveLength(1);
    expect(await modesOfOnlyTrip(db)).toEqual(['car', 'walk']);

    const plan = await planRecompute(db, [before[0]!.id!], endMs);
    await recomputeForTrips(db, plan, endMs);
    // Before the fix the span started at the trip's first fix, so the
    // in_vehicle event 30 s earlier stayed consumed and the rebuilt trip
    // became a single walk section.
    expect(await modesOfOnlyTrip(db)).toEqual(['car', 'walk']);
  });
});
