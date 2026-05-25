import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertRawPoint } from '../../db/rawPoints';
import { insertRawActivity } from '../../db/rawActivities';
import { listTrips } from '../../db/trips';
import { runPipeline } from '../runPipeline';
import { syntheticTrip } from './_fixtures';
import type { Db } from '../../db/client';

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
});
