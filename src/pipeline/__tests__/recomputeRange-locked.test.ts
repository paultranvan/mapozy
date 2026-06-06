import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertTripWithSections, getTripById } from '../../db/trips';
import { insertRawPoint } from '../../db/rawPoints';
import { planRecompute, recomputeForTrips } from '../recomputeRange';
import type { Trip } from '../../types';
import type { Db } from '../../db/client';

function mkTrip(
  startMs: number,
  endMs: number,
  startPlaceId: number | null,
  endPlaceId: number | null
): Trip {
  return {
    id: 0,
    startTimeMs: startMs,
    endTimeMs: endMs,
    startPlaceId,
    endPlaceId,
    distanceM: 1000,
    durationS: 600,
    dominantMode: 'car',
    co2G: 0,
    geojson: '{"type":"LineString","coordinates":[]}',
    manualPurpose: null,
    draft: false,
    draftReason: null,
    edited: false,
    locked: false,
    createdAtMs: startMs,
    sections: [],
    breaks: [],
  };
}

async function seedPlace(db: Db, id: number) {
  await db.runAsync(
    `INSERT INTO places (id, latitude, longitude, radius_m, visit_count, first_seen_ms, last_seen_ms)
     VALUES (?, 45, 5, 50, 1, 0, 0)`,
    id
  );
}

describe('recompute carve-out for locked trips', () => {
  let db: Db;
  let t1: number, t2: number, t3: number;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
    for (const id of [10, 20, 30, 40]) await seedPlace(db, id);
    t1 = await insertTripWithSections(db, mkTrip(1000, 2000, 10, 20));
    t2 = await insertTripWithSections(db, mkTrip(3000, 4000, 20, 30));
    t3 = await insertTripWithSections(db, mkTrip(5000, 6000, 30, 40));
    for (const ms of [1000, 1500, 3000, 3500, 5000, 5500]) {
      await insertRawPoint(db, {
        timestampMs: ms, latitude: 45, longitude: 5, altitude: null,
        accuracyMeters: 5, speedMps: null, bearingDeg: null,
        batteryLevel: null, isCharging: false,
      });
    }
    // Lock the middle trip.
    await db.runAsync(`UPDATE trips SET locked = 1 WHERE id = ?`, t2);
  });

  it('excludes the locked trip from the deletion set and records its range', async () => {
    // Non-contiguous selection [t1, t3] pulls t2 into the span.
    const plan = await planRecompute(db, [t1, t3], 99_999);
    expect(plan.inRangeTripIds).not.toContain(t2);
    expect(plan.inRangeTripIds.sort()).toEqual([t1, t3].sort());
    expect(plan.lockedRanges).toEqual([[3000, 4000]]);
  });

  it('does not delete or rebuild a locked trip in the span', async () => {
    const plan = await planRecompute(db, [t1, t3], 99_999);
    const before = await getTripById(db, t2);
    await recomputeForTrips(db, plan, 99_999);
    const after = await getTripById(db, t2);
    expect(after).not.toBeNull();
    expect(after!.startTimeMs).toBe(before!.startTimeMs);
    expect(after!.endTimeMs).toBe(before!.endTimeMs);
    expect(after!.locked).toBe(true);
  });
});
