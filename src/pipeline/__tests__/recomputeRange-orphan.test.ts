// Regression for the "Avenue Flouquet" bug (tester DB, 2 Jul 2026): a bounded
// recompute left two raw points permanently unconsumed (its re-run held them as
// an open tail, but no future run ever completes a *historical* tail). Days
// later a live pipeline run merged those stale orphans with fresh points,
// manufactured a multi-day gap stay anchored at the orphan's coordinates, and
// assigned the new trip a start place ~150 m from where it really began —
// instead of the user's Home place.
import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { listTrips } from '../../db/trips';
import { insertRawPoint, markPointsConsumed, getUnconsumedPointsInRange } from '../../db/rawPoints';
import { planRecompute, recomputeForTrips } from '../recomputeRange';
import { runPipeline } from '../runPipeline';
import type { Db } from '../../db/client';

const T0 = 1_700_000_000_000;
const LAT0 = 45.0;
const LON = 5.0;
const DEG_800M = 0.00719; // ~800 m of latitude

async function addPoint(db: Db, timestampMs: number, latitude: number) {
  return insertRawPoint(db, {
    timestampMs, latitude, longitude: LON, altitude: null,
    accuracyMeters: 5, speedMps: null, bearingDeg: null,
    batteryLevel: null, isCharging: false,
  });
}

// stay@A → drive → stay@B → drive → stay@C. Two trips; the user's "home" for
// the rest of the scenario is C. Places end up ~800 m apart (distinct places).
async function seedTwoTrips(db: Db) {
  let t = T0;
  for (let k = 0; k <= 2; k++) {
    const lat = LAT0 + DEG_800M * k;
    for (let i = 0; i <= 35; i++) await addPoint(db, t + i * 60_000, lat);
    t += 36 * 60_000;
    if (k === 2) break;
    for (let i = 0; i <= 12; i++) {
      await addPoint(db, t + i * 15_000, lat + (DEG_800M * i) / 12);
    }
    t += 13 * 15_000;
  }
  return t; // end of data
}

describe('recompute of a gap-terminated trip', () => {
  // A trip whose end stay is a GAP dwell (subway ride, GPS dropout) needs the
  // post-gap fix — which is the NEXT trip's first point, sitting exactly at
  // spanEndMs — to close its terminating stay. The span reset must therefore
  // stay inclusive of spanEndMs: drop that point and the re-run sees the trip
  // as an endless open tail and can't rebuild it.
  it('rebuilds a trip that ends in a tracking gap', async () => {
    const db = createMockDb();
    await runMigrations(db);
    let t = T0;
    // stay@A, walk A→B
    for (let i = 0; i <= 35; i++) await addPoint(db, t + i * 60_000, LAT0);
    t += 36 * 60_000;
    for (let i = 0; i <= 20; i++) await addPoint(db, t + i * 30_000, LAT0 + (0.0054 * i) / 20);
    t += 21 * 30_000;
    // 45-min gap, resuming ~300 m further: long enough to end the trip
    // (> RULE_TRIP_BREAK_MAX 30 min), short of the plausibility window (60 min),
    // and displaced past the 100 m dwell radius → a GAP dwell splits the walks.
    t += 45 * 60_000;
    const bPrime = LAT0 + 0.0054 + 0.0027;
    // walk B'→C, stay@C
    for (let i = 0; i <= 20; i++) await addPoint(db, t + i * 30_000, bPrime + (0.0054 * i) / 20);
    t += 21 * 30_000;
    for (let i = 0; i <= 35; i++) await addPoint(db, t + i * 60_000, bPrime + 0.0054);
    const endMs = t + 36 * 60_000;

    await runPipeline(db, { upToMs: endMs + 1, nowMs: endMs });
    const before = await listTrips(db, 100, 0);
    expect(before.length).toBe(2);
    const gapTrip = before[1]!; // walk A→B, ends in the gap

    const plan = await planRecompute(db, [gapTrip.id!], endMs);
    expect(plan.hasTripsAfterSpan).toBe(true);
    await recomputeForTrips(db, plan, endMs);

    const after = await listTrips(db, 100, 0);
    expect(after.length).toBe(2);
    const rebuilt = after[1]!;
    expect(rebuilt.startTimeMs).toBe(gapTrip.startTimeMs);
    expect(Math.round(rebuilt.distanceM)).toBe(Math.round(gapTrip.distanceM));
    // and nothing in the span is left dangling
    expect(await getUnconsumedPointsInRange(db, 0, plan.spanEndMs)).toEqual([]);
  });
});

describe('bounded recompute cannot strand unconsumed orphans', () => {
  let db: Db;
  let endMs: number;
  let trip1Id: number;
  let strayLat: number;

  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
    endMs = await seedTwoTrips(db);
    await runPipeline(db, { upToMs: endMs + 1, nowMs: endMs });
    const trips = await listTrips(db, 100, 0); // start DESC
    expect(trips.length).toBe(2);
    trip1Id = trips[1]!.id!;
    const trip2 = trips[0]!;

    // Two stray fixes inside trip1's recompute span, ~150 m off the B stay —
    // displaced enough (>100 m dwell radius) that the re-run can't absorb them
    // into the stay, so they become a trailing 2-point group with no end stay.
    // Mirrors the field incident, where the orphaned pair was a duplicated
    // GPS-resume fix 140 m from the stay it followed.
    strayLat = LAT0 + DEG_800M + 0.00135; // B + ~150 m
    const s1 = await addPoint(db, trip2.startTimeMs - 120_000, strayLat);
    const s2 = await addPoint(db, trip2.startTimeMs - 60_000, strayLat);
    await markPointsConsumed(db, [s1, s2]);
  });

  it('leaves zero unconsumed points inside the span when trips exist after it', async () => {
    const plan = await planRecompute(db, [trip1Id], endMs);
    expect(plan.hasTripsAfterSpan).toBe(true);
    await recomputeForTrips(db, plan, endMs);
    const leftovers = await getUnconsumedPointsInRange(db, 0, plan.spanEndMs - 1);
    expect(leftovers).toEqual([]);
  });

  it('a later live run starts the next trip from the seed place, not a stale orphan', async () => {
    const plan = await planRecompute(db, [trip1Id], endMs);
    await recomputeForTrips(db, plan, endMs);
    const tripsBefore = await listTrips(db, 100, 0);
    const homePlaceId = tripsBefore[0]!.endPlaceId; // C — where the user "lives"

    // Two days later: a walk leaves straight from C (no leading stay captured,
    // exactly like a morning departure whose overnight points were consumed).
    const t1 = endMs + 2 * 24 * 3600_000;
    for (let i = 0; i <= 20; i++) {
      await addPoint(db, t1 + i * 30_000, LAT0 + 2 * DEG_800M + (0.0054 * i) / 20);
    }
    const walkEnd = t1 + 21 * 30_000;
    for (let i = 0; i <= 35; i++) {
      await addPoint(db, walkEnd + i * 60_000, LAT0 + 2 * DEG_800M + 0.0054);
    }
    const nowMs = walkEnd + 36 * 60_000;
    await runPipeline(db, { upToMs: nowMs + 1, nowMs });

    const trips = await listTrips(db, 100, 0);
    const newTrips = trips.filter((t) => t.startTimeMs >= t1 - 3600_000);
    expect(newTrips.length).toBe(1);
    expect(newTrips[0]!.startPlaceId).toBe(homePlaceId);
  });
});
