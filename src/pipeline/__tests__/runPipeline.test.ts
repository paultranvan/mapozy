import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertRawPoint } from '../../db/rawPoints';
import { insertRawActivity } from '../../db/rawActivities';
import { listTrips } from '../../db/trips';
import { getSetting, setSetting, SETTING_KEYS } from '../../db/settings';
import { runPipeline } from '../runPipeline';
import { syntheticTrip, mkPoint, mkActivity, resetIds } from './_fixtures';
import type { RawPoint, RawActivity } from '../../types';
import type { Db } from '../../db/client';

function tripThenStay(t0 = 1_700_000_000_000): {
  points: RawPoint[];
  activities: RawActivity[];
} {
  resetIds();
  const points: RawPoint[] = [];
  const activities: RawActivity[] = [];
  const lat0 = 45.0;
  const lon0 = 5.0;
  // Drive 2km north over 3 min (12 points, 15s apart)
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    points.push(mkPoint(t0 + i * 15_000, lat0 + 0.018 * f, lon0));
  }
  for (let i = 0; i < 12; i++) {
    activities.push(mkActivity(t0 + i * 15_000, 'in_vehicle'));
  }
  // Stay at destination for 10 min (1 point/min)
  const stayStart = t0 + 13 * 15_000 + 1000;
  const endLat = lat0 + 0.018;
  for (let i = 0; i <= 10; i++) {
    points.push(mkPoint(stayStart + i * 60_000, endLat, lon0));
  }
  activities.push(mkActivity(stayStart + 30_000, 'still'));
  activities.push(mkActivity(stayStart + 5 * 60_000, 'still'));
  return { points, activities };
}

describe('runPipeline end-to-end', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('processes a synthetic trip from raw → persisted Trip', async () => {
    const { points, activities } = syntheticTrip();
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

    const upToMs = points[points.length - 1]!.timestampMs + 1000;
    const result = await runPipeline(db, { upToMs, nowMs: upToMs });
    expect(result.tripsInserted).toBe(1);

    const trips = await listTrips(db, 10, 0);
    expect(trips).toHaveLength(1);
    const trip = trips[0]!;
    expect(trip.distanceM).toBeGreaterThan(1000);
    expect(['mixed', 'car']).toContain(trip.dominantMode);
    expect(trip.startPlaceId).not.toBeNull();
    expect(trip.endPlaceId).not.toBeNull();
  });

  it('handles empty buffer gracefully', async () => {
    const result = await runPipeline(db, { upToMs: Date.now(), nowMs: Date.now() });
    expect(result.tripsInserted).toBe(0);
  });

  it('ignores a dangling last_known_place_id seed (place no longer exists)', async () => {
    // Reproduces a real user-export bug: the settings table carried
    // last_known_place_id=1 from a prior pipeline run, but the places table
    // was emptied (e.g. by Clear All Data) while sqlite_sequence retained
    // its high-water mark. Without defensive validation, the seed becomes a
    // dangling FK reference and every pipeline run throws on trip insert,
    // leaving raw rows unconsumed forever.
    await setSetting(db, SETTING_KEYS.LAST_KNOWN_PLACE_ID, '1');
    // Push sqlite_sequence so findOrCreatePlace produces id=2, not id=1.
    await db.runAsync(
      `INSERT INTO sqlite_sequence(name,seq) VALUES('places',1)`
    );

    // trip → stay (no preceding stay to overwrite the seed before use)
    const { points, activities } = tripThenStay();
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
    const upToMs = points[points.length - 1]!.timestampMs + 1000;

    const result = await runPipeline(db, { upToMs, nowMs: upToMs });

    expect(result.tripsInserted).toBe(1);
    const trips = await listTrips(db, 10, 0);
    expect(trips).toHaveLength(1);
    // The dangling seed must NOT be used as start_place_id (place 1 doesn't exist).
    expect(trips[0]!.startPlaceId).not.toBe(1);
    // And the stale setting should be cleared (or overwritten with the new id).
    const seedAfter = await getSetting(db, SETTING_KEYS.LAST_KNOWN_PLACE_ID);
    expect(seedAfter).not.toBe('1');
  });
});
