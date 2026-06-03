import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertTripWithSections } from '../../db/trips';
import { insertRawPoint } from '../../db/rawPoints';
import { planRecompute } from '../recomputeRange';
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
    geojson: '{"type":"FeatureCollection","features":[]}',
    manualPurpose: null,
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

describe('planRecompute', () => {
  let db: Db;
  let t1: number, t2: number, t3: number;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
    await seedPlace(db, 10);
    await seedPlace(db, 20);
    await seedPlace(db, 30);
    await seedPlace(db, 40);
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
  });

  it('plans the middle trip: span to next start, seed from previous end', async () => {
    const plan = await planRecompute(db, [t2], 99_999);
    expect(plan.spanStartMs).toBe(3000);
    expect(plan.spanEndMs).toBe(5000);
    expect(plan.seedPlaceId).toBe(20);
    expect(plan.inRangeTripIds).toEqual([t2]);
    expect(plan.extraCount).toBe(0);
    expect(plan.missingRawTripIds).toEqual([]);
    expect(plan.hasTripsAfterSpan).toBe(true);
  });

  it('non-contiguous selection pulls the in-between trip into range with a warning count', async () => {
    const plan = await planRecompute(db, [t1, t3], 99_999);
    expect(plan.spanStartMs).toBe(1000);
    expect(plan.spanEndMs).toBe(99_999);
    expect(plan.seedPlaceId).toBeNull();
    expect(plan.inRangeTripIds.sort()).toEqual([t1, t2, t3].sort());
    expect(plan.extraCount).toBe(1);
    expect(plan.hasTripsAfterSpan).toBe(false);
  });

  it('flags trips whose window has no raw points', async () => {
    await db.runAsync(`DELETE FROM raw_points WHERE timestamp_ms BETWEEN 3000 AND 4000`);
    const plan = await planRecompute(db, [t2], 99_999);
    expect(plan.missingRawTripIds).toEqual([t2]);
  });
});
