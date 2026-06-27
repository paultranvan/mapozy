import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertRawPoint } from '../../db/rawPoints';
import { listTrips, getTripById } from '../../db/trips';
import { getPlaceById } from '../../db/places';
import { runPipeline } from '../runPipeline';
import { mkPoint, resetIds } from './_fixtures';
import { haversineMeters } from '../../lib/distance';
import type { RawPoint } from '../../types';
import type { Db } from '../../db/client';

// Reproduces the tester's "started from Avenue d'Italie but the map shows
// Villejuif" bug: trip 1 ends at A, GPS is suspended (power-save) for >30 min
// during which the user rides a bus ~4 km to B, then trip 2 is recorded B→C.
// The gap stay between the trips is centered at A (the pre-gap departure), so
// trip 2's start place must NOT be anchored to A — it must follow the real
// first fix at B.
function tripGapTrip(t0 = 1_700_000_000_000): RawPoint[] {
  resetIds();
  const pts: RawPoint[] = [];
  const lon = 5.0;
  const A = 45.018;
  const B = 45.053; // ~3.9 km north of A
  const C = 45.063; // ~1.1 km north of B

  // Trip 1: drive 0→A over 3 min.
  for (let i = 0; i <= 12; i++) pts.push(mkPoint(t0 + i * 15_000, 45.0 + 0.018 * (i / 12), lon));
  // Stay at A for 35 min (≥30 min → ends trip 1).
  const stayA = t0 + 13 * 15_000 + 1000;
  for (let i = 0; i <= 35; i++) pts.push(mkPoint(stayA + i * 60_000, A, lon));
  // GPS gap: next fix is 31 min later, ~3.9 km away at B (bus ride, untracked).
  const resumeB = stayA + 35 * 60_000 + 31 * 60_000;
  // Trip 2: drive B→C over 3 min, starting at B.
  for (let i = 0; i <= 12; i++) pts.push(mkPoint(resumeB + i * 15_000, B + (C - B) * (i / 12), lon));
  // Stay at C for 35 min (≥30 min → ends trip 2).
  const stayC = resumeB + 13 * 15_000 + 1000;
  for (let i = 0; i <= 35; i++) pts.push(mkPoint(stayC + i * 60_000, C, lon));
  return pts;
}

describe('runPipeline — gap start stay does not mislabel the origin', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('anchors the post-gap trip start to where GPS resumed, not the pre-gap place', async () => {
    const pts = tripGapTrip();
    for (const p of pts) {
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
    const upToMs = pts[pts.length - 1]!.timestampMs + 1000;
    await runPipeline(db, { upToMs, nowMs: upToMs });

    const trips = await listTrips(db, 10, 0); // newest-first
    expect(trips.length).toBe(2);
    const secondTrip = await getTripById(db, trips[0]!.id!); // the later (B→C) trip
    expect(secondTrip!.startPlaceId).not.toBeNull();
    const startPlace = await getPlaceById(db, secondTrip!.startPlaceId!);

    const A = 45.018;
    const B = 45.053;
    const dToA = haversineMeters(startPlace!.latitude, startPlace!.longitude, A, 5.0);
    const dToB = haversineMeters(startPlace!.latitude, startPlace!.longitude, B, 5.0);
    // The start place follows the resumed fix (B), not the pre-gap departure (A).
    expect(dToB).toBeLessThan(dToA);
    expect(dToB).toBeLessThan(300);
  });
});
