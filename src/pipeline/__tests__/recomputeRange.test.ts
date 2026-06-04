import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertTripWithSections, listTrips } from '../../db/trips';
import { insertRawPoint } from '../../db/rawPoints';
import { insertRawActivity } from '../../db/rawActivities';
import { planRecompute, recomputeForTrips } from '../recomputeRange';
import { runPipeline } from '../runPipeline';
import { getSetting, SETTING_KEYS } from '../../db/settings';
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
    draft: false,
    draftReason: null,
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

  it('falls back to nowMs and no-seed-after for the last trip in history', async () => {
    const plan = await planRecompute(db, [t3], 99_999);
    expect(plan.spanStartMs).toBe(5000);
    expect(plan.spanEndMs).toBe(99_999); // no trip after t3 -> nowMs
    expect(plan.seedPlaceId).toBe(30);   // end place of t2
    expect(plan.inRangeTripIds).toEqual([t3]);
    expect(plan.hasTripsAfterSpan).toBe(false);
  });

  it('flags trips whose window has no raw points', async () => {
    await db.runAsync(`DELETE FROM raw_points WHERE timestamp_ms BETWEEN 3000 AND 4000`);
    const plan = await planRecompute(db, [t2], 99_999);
    expect(plan.missingRawTripIds).toEqual([t2]);
  });
});

// Builds a chain of N trips: stay@P0 -> drive -> stay@P1 -> ... -> stay@PN.
// Each stay is 35 min (ends a trip); each drive is 3 min north.
async function seedTripChain(db: Db, n: number, t0 = 1_700_000_000_000) {
  let t = t0;
  const lat0 = 45.0;
  const lon0 = 5.0;
  const stayMin = 35;
  for (let k = 0; k <= n; k++) {
    const lat = lat0 + 0.02 * k; // ~2.2km between stays
    for (let i = 0; i <= stayMin; i++) {
      await insertRawPoint(db, {
        timestampMs: t + i * 60_000, latitude: lat, longitude: lon0, altitude: null,
        accuracyMeters: 5, speedMps: null, bearingDeg: null, batteryLevel: null, isCharging: false,
      });
    }
    await insertRawActivity(db, { timestampMs: t + 60_000, type: 'still', confidence: 90 });
    await insertRawActivity(db, { timestampMs: t + 10 * 60_000, type: 'still', confidence: 90 });
    t += stayMin * 60_000 + 60_000;
    if (k === n) break;
    const nextLat = lat0 + 0.02 * (k + 1);
    for (let i = 0; i <= 12; i++) {
      const f = i / 12;
      await insertRawPoint(db, {
        timestampMs: t + i * 15_000, latitude: lat + (nextLat - lat) * f, longitude: lon0,
        altitude: null, accuracyMeters: 5, speedMps: null, bearingDeg: null,
        batteryLevel: null, isCharging: false,
      });
      await insertRawActivity(db, { timestampMs: t + i * 15_000, type: 'in_vehicle', confidence: 90 });
    }
    t += 13 * 15_000 + 1000;
  }
  return t;
}

describe('recomputeForTrips end-to-end', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('rebuilds only the middle trip and leaves neighbours unchanged', async () => {
    const endMs = await seedTripChain(db, 3);
    await runPipeline(db, { upToMs: endMs + 1, nowMs: endMs });
    const before = await listTrips(db, 100, 0); // start DESC
    expect(before.length).toBe(3);
    const first = before[2]!;
    const middle = before[1]!;
    const last = before[0]!;

    const plan = await planRecompute(db, [middle.id!], endMs);
    expect(plan.inRangeTripIds).toEqual([middle.id]);
    const savedSeed = await getSetting(db, SETTING_KEYS.LAST_KNOWN_PLACE_ID);

    await recomputeForTrips(db, plan, endMs);

    const after = await listTrips(db, 100, 0);
    expect(after.length).toBe(3);
    const afterFirst = after[2]!;
    const afterLast = after[0]!;
    expect(afterFirst.id).toBe(first.id);
    expect(afterLast.id).toBe(last.id);
    expect(afterFirst.distanceM).toBe(first.distanceM);
    expect(afterLast.distanceM).toBe(last.distanceM);
    const afterMiddle = after[1]!;
    expect(afterMiddle.startPlaceId).toBe(middle.startPlaceId);
    expect(afterMiddle.endPlaceId).toBe(middle.endPlaceId);
    expect(await getSetting(db, SETTING_KEYS.LAST_KNOWN_PLACE_ID)).toBe(savedSeed);
  });
});
