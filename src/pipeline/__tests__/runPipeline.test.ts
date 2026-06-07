import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertRawPoint } from '../../db/rawPoints';
import { insertRawActivity } from '../../db/rawActivities';
import { listTrips, getTripById } from '../../db/trips';
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
  // Stay at destination for 35 min (1 point/min) — ≥ 30 min so it ends the trip.
  const stayStart = t0 + 13 * 15_000 + 1000;
  const endLat = lat0 + 0.018;
  for (let i = 0; i <= 35; i++) {
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

  it('serializes concurrent invocations so a trip is not duplicated', async () => {
    // Reproduces the duplicate-trip bug: the app fires runPipeline from several
    // uncoordinated triggers. Two overlapping runs read the same unconsumed
    // points and each insert the same trip. The per-db serialization guard must
    // make the second run wait until the first has marked its points consumed,
    // so it sees nothing left to do.
    const { points, activities } = syntheticTrip();
    for (const p of points) await insertRawPoint(db, p);
    for (const a of activities) await insertRawActivity(db, a);

    const upToMs = points[points.length - 1]!.timestampMs + 1000;
    const [r1, r2] = await Promise.all([
      runPipeline(db, { upToMs, nowMs: upToMs }),
      runPipeline(db, { upToMs, nowMs: upToMs }),
    ]);

    const trips = await listTrips(db, 50, 0);
    expect(trips).toHaveLength(1);
    // Exactly one of the two runs did the insert; the other found no work.
    expect(r1.tripsInserted + r2.tripsInserted).toBe(1);
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

  it('produces a 2-leg trip with one break when a short stop sits between two drives', async () => {
    resetIds();
    const t0 = 1_700_000_000_000;
    const lat0 = 45.0;
    const lon0 = 5.0;
    const points: RawPoint[] = [];
    const activities: RawActivity[] = [];

    // Stay at A for 35 min (1 pt/min) — long, opens the trip
    for (let i = 0; i <= 35; i++) points.push(mkPoint(t0 + i * 60_000, lat0, lon0));
    activities.push(mkActivity(t0 + 30_000, 'still'));

    // Drive 2km north over 3 min
    const drive1Start = t0 + 36 * 60_000;
    for (let i = 0; i <= 12; i++) {
      const f = i / 12;
      points.push(mkPoint(drive1Start + i * 15_000, lat0 + 0.018 * f, lon0));
    }
    for (let i = 0; i < 12; i++) {
      activities.push(mkActivity(drive1Start + i * 15_000, 'in_vehicle'));
    }

    // Short break at midpoint for 20 min (above stall-guard ceiling so it's
    // admitted as a stay, below 30-min trip-boundary so it's a break).
    const midLat = lat0 + 0.018;
    const breakStart = drive1Start + 13 * 15_000;
    for (let i = 0; i <= 20; i++) points.push(mkPoint(breakStart + i * 60_000, midLat, lon0));
    activities.push(mkActivity(breakStart + 30_000, 'still'));

    // Drive another 2km north over 3 min
    const drive2Start = breakStart + 21 * 60_000;
    for (let i = 0; i <= 12; i++) {
      const f = i / 12;
      points.push(mkPoint(drive2Start + i * 15_000, midLat + 0.018 * f, lon0));
    }
    for (let i = 0; i < 12; i++) {
      activities.push(mkActivity(drive2Start + i * 15_000, 'in_vehicle'));
    }

    // Long stay at end for 60 min — closes the trip
    const stayEndStart = drive2Start + 13 * 15_000;
    const endLat = midLat + 0.018;
    for (let i = 0; i <= 60; i++) points.push(mkPoint(stayEndStart + i * 60_000, endLat, lon0));
    activities.push(mkActivity(stayEndStart + 30_000, 'still'));

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

    const tripId = trips[0]!.id!;
    const full = await getTripById(db, tripId);
    expect(full).not.toBeNull();
    expect(full!.breaks).toHaveLength(1);
    expect(full!.sections.length).toBeGreaterThanOrEqual(2);
    // The break sits between two car sections.
    const breakOrdering = full!.breaks[0]!.ordering;
    expect(full!.sections[breakOrdering]!.mode).toBe('car');
    expect(full!.sections[breakOrdering + 1]!.mode).toBe('car');
  });
});
