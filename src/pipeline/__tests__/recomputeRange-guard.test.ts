// src/pipeline/__tests__/recomputeRange-guard.test.ts
import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertTripWithSections, getTripsByIds, setTripEditFlags } from '../../db/trips';
import { insertRawPoint } from '../../db/rawPoints';
import { recomputeForTrips, MissingRawDataError, type RecomputePlan } from '../recomputeRange';
import { resetTripToAuto } from '../../db/tripEdits';
import type { Trip } from '../../types';
import type { Db } from '../../db/client';

function mkTrip(startMs: number, endMs: number): Trip {
  return {
    id: 0,
    startTimeMs: startMs,
    endTimeMs: endMs,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 1000,
    durationS: 600,
    dominantMode: 'car',
    co2G: 0,
    geojson: '{"type":"FeatureCollection","features":[]}',
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

describe('recompute guard on purged raw data', () => {
  let db: Db;
  let tripId: number;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
    // Trip exists but its raw points do not (purged by retention).
    tripId = await insertTripWithSections(db, mkTrip(1000, 2000));
  });

  it('recomputeForTrips refuses and deletes nothing', async () => {
    const plan: RecomputePlan = {
      selectedTripIds: [tripId],
      spanStartMs: 1000,
      spanEndMs: 3000,
      seedPlaceId: null,
      inRangeTripIds: [tripId],
      extraCount: 0,
      missingRawTripIds: [tripId],
      hasTripsAfterSpan: false,
      lockedRanges: [],
    };
    await expect(recomputeForTrips(db, plan, 99_999)).rejects.toThrow(MissingRawDataError);
    expect((await getTripsByIds(db, [tripId])).length).toBe(1); // trip survived
  });

  it('resetTripToAuto refuses BEFORE clearing edit flags', async () => {
    await setTripEditFlags(db, tripId, true, false); // edited=true
    await expect(resetTripToAuto(db, tripId, 99_999)).rejects.toThrow(MissingRawDataError);
    const row = await db.getFirstAsync<{ edited: number }>(
      `SELECT edited FROM trips WHERE id = ?`,
      tripId
    );
    expect(row?.edited).toBe(1); // edit state untouched
  });

  it('resetTripToAuto refuses when exactly one raw point survives (pipeline needs ≥ 2)', async () => {
    // One point inside the trip window — not enough for the pipeline to rebuild.
    await insertRawPoint(db, {
      timestampMs: 1500,
      latitude: 45,
      longitude: 5,
      altitude: null,
      accuracyMeters: 5,
      speedMps: null,
      bearingDeg: null,
      batteryLevel: null,
      isCharging: false,
    });
    await expect(resetTripToAuto(db, tripId, 99_999)).rejects.toThrow(MissingRawDataError);
  });
});
