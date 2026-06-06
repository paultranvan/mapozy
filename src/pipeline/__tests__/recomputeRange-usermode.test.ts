import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { listTrips, getTripById } from '../../db/trips';
import { insertRawPoint } from '../../db/rawPoints';
import { insertRawActivity } from '../../db/rawActivities';
import { planRecompute, recomputeForTrips } from '../recomputeRange';
import { runPipeline } from '../runPipeline';
import type { Db } from '../../db/client';

// One trip: stay@P0 -> drive north -> stay@P1.
async function seedOneTrip(db: Db, t0 = 1_700_000_000_000): Promise<number> {
  let t = t0;
  const lat0 = 45.0;
  const lon0 = 5.0;
  const stayMin = 35;
  for (let k = 0; k <= 1; k++) {
    const lat = lat0 + 0.02 * k;
    for (let i = 0; i <= stayMin; i++) {
      await insertRawPoint(db, {
        timestampMs: t + i * 60_000, latitude: lat, longitude: lon0, altitude: null,
        accuracyMeters: 5, speedMps: null, bearingDeg: null, batteryLevel: null, isCharging: false,
      });
    }
    await insertRawActivity(db, { timestampMs: t + 60_000, type: 'still', confidence: 90 });
    await insertRawActivity(db, { timestampMs: t + 10 * 60_000, type: 'still', confidence: 90 });
    t += stayMin * 60_000 + 60_000;
    if (k === 1) break;
    const nextLat = lat0 + 0.02;
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

describe('user_mode survives a no-op recompute', () => {
  it('keeps the override when the rebuilt section bounds are identical', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const endMs = await seedOneTrip(db);
    await runPipeline(db, { upToMs: endMs + 1, nowMs: endMs });

    const trips = await listTrips(db, 100, 0);
    expect(trips.length).toBe(1);
    const trip = (await getTripById(db, trips[0]!.id!))!;
    const sec = trip.sections[0]!;
    // override the auto mode
    await db.runAsync(`UPDATE sections SET user_mode = 'train' WHERE id = ?`, sec.id!);
    await db.runAsync(`UPDATE trips SET edited = 1 WHERE id = ?`, trip.id!);

    const plan = await planRecompute(db, [trip.id!], endMs);
    await recomputeForTrips(db, plan, endMs);

    const after = await listTrips(db, 100, 0);
    expect(after.length).toBe(1);
    const rebuilt = (await getTripById(db, after[0]!.id!))!;
    expect(rebuilt.sections.some((s) => s.userMode === 'train')).toBe(true);
    expect(rebuilt.edited).toBe(true);
    expect(rebuilt.dominantMode).toBe('train');
  });
});
