import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertTripWithSections } from '../../db/trips';
import { periodKpi, dailyDistances } from '../periodStats';
import { modeBreakdown } from '../modeBreakdown';
import type { Db } from '../../db/client';
import type { Trip, Mode, Section } from '../../types';

// Legs for multi-section trips: [mode, distanceM, optional userMode override].
type Leg = { mode: Mode; distanceM: number; userMode?: Mode };

function mkTrip(opts: {
  startMs: number;
  distanceM: number;
  durationS: number;
  mode: Mode;
  co2G: number;
  legs?: Leg[];
}): Trip {
  const legs: Leg[] = opts.legs ?? [{ mode: opts.mode, distanceM: opts.distanceM }];
  const legDurationS = opts.durationS / legs.length;
  const sections: Section[] = legs.map((leg, i) => ({
    ordering: i,
    startTimeMs: opts.startMs + i * legDurationS * 1000,
    endTimeMs: opts.startMs + (i + 1) * legDurationS * 1000,
    mode: leg.mode,
    distanceM: leg.distanceM,
    durationS: legDurationS,
    avgSpeedMps: leg.distanceM / legDurationS,
    maxSpeedMps: leg.distanceM / legDurationS,
    co2G: opts.co2G / legs.length,
    geojson: '{}',
    ...(leg.userMode ? { userMode: leg.userMode } : {}),
  }));
  return {
    startTimeMs: opts.startMs,
    endTimeMs: opts.startMs + opts.durationS * 1000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: opts.distanceM,
    durationS: opts.durationS,
    dominantMode: opts.mode,
    co2G: opts.co2G,
    geojson: '{}',
    manualPurpose: null,
    draft: false,
    draftReason: null,
    edited: false,
    locked: false,
    createdAtMs: opts.startMs,
    sections,
    breaks: [],
  };
}

describe('stats', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('periodKpi sums trips in range', async () => {
    await insertTripWithSections(db, mkTrip({ startMs: 1000, distanceM: 1000, durationS: 600, mode: 'walk', co2G: 0 }));
    await insertTripWithSections(db, mkTrip({ startMs: 2000, distanceM: 5000, durationS: 600, mode: 'car', co2G: 1090 }));
    await insertTripWithSections(db, mkTrip({ startMs: 99999, distanceM: 9999, durationS: 600, mode: 'car', co2G: 2179 }));
    const k = await periodKpi(db, 0, 5000);
    expect(k.totalDistanceM).toBe(6000);
    expect(k.tripsCount).toBe(2);
    expect(k.totalCo2G).toBeCloseTo(1090, 0);
  });

  it('modeBreakdown aggregates per mode', async () => {
    await insertTripWithSections(db, mkTrip({ startMs: 1000, distanceM: 1000, durationS: 600, mode: 'walk', co2G: 0 }));
    await insertTripWithSections(db, mkTrip({ startMs: 2000, distanceM: 5000, durationS: 600, mode: 'car', co2G: 1090 }));
    const bd = await modeBreakdown(db, 0, 100_000);
    expect(bd).toHaveLength(2);
    const car = bd.find((b) => b.mode === 'car')!;
    const walk = bd.find((b) => b.mode === 'walk')!;
    expect(car.distanceM).toBe(5000);
    expect(walk.distanceM).toBe(1000);
  });

  it('modeBreakdown groups by effective mode (user_mode override wins)', async () => {
    // Auto-detected as car, corrected by the user to bus.
    await insertTripWithSections(db, mkTrip({
      startMs: 1000, distanceM: 5000, durationS: 600, mode: 'car', co2G: 1090,
      legs: [{ mode: 'car', distanceM: 5000, userMode: 'bus' }],
    }));
    await insertTripWithSections(db, mkTrip({ startMs: 2000, distanceM: 1000, durationS: 600, mode: 'walk', co2G: 0 }));
    const bd = await modeBreakdown(db, 0, 100_000);
    expect(bd.map((b) => b.mode).sort()).toEqual(['bus', 'walk']);
    expect(bd.find((b) => b.mode === 'bus')!.distanceM).toBe(5000);
  });

  it('periodKpi with a mode filter sums only that mode’s sections', async () => {
    // Mixed trip: walk 1 km + car 5 km.
    await insertTripWithSections(db, mkTrip({
      startMs: 1000, distanceM: 6000, durationS: 1200, mode: 'car', co2G: 1090,
      legs: [{ mode: 'walk', distanceM: 1000 }, { mode: 'car', distanceM: 5000 }],
    }));
    // Pure walk trip.
    await insertTripWithSections(db, mkTrip({ startMs: 2000, distanceM: 1500, durationS: 600, mode: 'walk', co2G: 0 }));
    // Out of range.
    await insertTripWithSections(db, mkTrip({ startMs: 999_999, distanceM: 9000, durationS: 600, mode: 'car', co2G: 100 }));

    const car = await periodKpi(db, 0, 5000, 'car');
    expect(car.totalDistanceM).toBe(5000);
    expect(car.tripsCount).toBe(1);

    const walk = await periodKpi(db, 0, 5000, 'walk');
    expect(walk.totalDistanceM).toBe(2500);
    expect(walk.tripsCount).toBe(2); // mixed trip counts once

    // Unfiltered path unchanged: whole-trip totals.
    const all = await periodKpi(db, 0, 5000);
    expect(all.totalDistanceM).toBe(7500);
    expect(all.tripsCount).toBe(2);
  });

  it('periodKpi mode filter respects user_mode overrides', async () => {
    await insertTripWithSections(db, mkTrip({
      startMs: 1000, distanceM: 5000, durationS: 600, mode: 'car', co2G: 1090,
      legs: [{ mode: 'car', distanceM: 5000, userMode: 'bus' }],
    }));
    expect((await periodKpi(db, 0, 5000, 'car')).totalDistanceM).toBe(0);
    expect((await periodKpi(db, 0, 5000, 'bus')).totalDistanceM).toBe(5000);
  });

  it('dailyDistances groups by local day', async () => {
    const day1 = new Date('2026-01-01T10:00:00Z').getTime();
    const day2 = new Date('2026-01-02T10:00:00Z').getTime();
    await insertTripWithSections(db, mkTrip({ startMs: day1, distanceM: 1000, durationS: 60, mode: 'walk', co2G: 0 }));
    await insertTripWithSections(db, mkTrip({ startMs: day1 + 3600_000, distanceM: 500, durationS: 60, mode: 'walk', co2G: 0 }));
    await insertTripWithSections(db, mkTrip({ startMs: day2, distanceM: 2000, durationS: 60, mode: 'bike', co2G: 0 }));
    const daily = await dailyDistances(db, 0, day2 + 86_400_000);
    expect(daily).toHaveLength(2);
    expect(daily[0]!.tripsCount).toBe(2);
    expect(daily[1]!.tripsCount).toBe(1);
  });

  it('dailyDistances with a mode filter buckets that mode’s legs by trip day', async () => {
    const day1 = new Date('2026-01-01T10:00:00Z').getTime();
    const day2 = new Date('2026-01-02T10:00:00Z').getTime();
    // Day 1: mixed walk+car trip, plus a pure walk trip.
    await insertTripWithSections(db, mkTrip({
      startMs: day1, distanceM: 6000, durationS: 1200, mode: 'car', co2G: 1090,
      legs: [{ mode: 'walk', distanceM: 1000 }, { mode: 'car', distanceM: 5000 }],
    }));
    await insertTripWithSections(db, mkTrip({ startMs: day1 + 3600_000, distanceM: 500, durationS: 60, mode: 'walk', co2G: 0 }));
    // Day 2: bike only.
    await insertTripWithSections(db, mkTrip({ startMs: day2, distanceM: 2000, durationS: 60, mode: 'bike', co2G: 0 }));

    const walkDaily = await dailyDistances(db, 0, day2 + 86_400_000, 'walk');
    expect(walkDaily).toHaveLength(1); // no walk on day 2
    expect(walkDaily[0]!.distanceM).toBe(1500);
    expect(walkDaily[0]!.tripsCount).toBe(2);

    const carDaily = await dailyDistances(db, 0, day2 + 86_400_000, 'car');
    expect(carDaily).toHaveLength(1);
    expect(carDaily[0]!.distanceM).toBe(5000);
    expect(carDaily[0]!.tripsCount).toBe(1);
  });
});

describe('hourlyDistances', () => {
  it('zero-fills 24 hours and buckets trips by local start hour', async () => {
    const { hourlyDistances } = require('../periodStats');
    const db: Db = createMockDb() as unknown as Db;
    await runMigrations(db);
    // Two trips at 07h local, one at 18h local, on the same day.
    const day = new Date(2026, 5, 29); // 29 Jun 2026 local midnight
    const at = (h: number, m = 0) => day.getTime() + (h * 60 + m) * 60_000;
    await insertTripWithSections(db, mkTrip({ startMs: at(7, 35), distanceM: 13_600, durationS: 3480, mode: 'car', co2G: 100 }));
    await insertTripWithSections(db, mkTrip({ startMs: at(7, 50), distanceM: 1_000, durationS: 600, mode: 'walk', co2G: 0 }));
    await insertTripWithSections(db, mkTrip({ startMs: at(18, 14), distanceM: 18_400, durationS: 5160, mode: 'car', co2G: 150 }));

    const buckets = await hourlyDistances(db, day.getTime(), day.getTime() + 86_400_000 - 1);
    expect(buckets).toHaveLength(24);
    expect(buckets[7]).toMatchObject({ label: '07h', distanceM: 14_600, tripsCount: 2 });
    expect(buckets[18]).toMatchObject({ label: '18h', distanceM: 18_400, tripsCount: 1 });
    expect(buckets[3]).toMatchObject({ distanceM: 0, tripsCount: 0 });
  });

  it('with a mode filter, zero-fills and sums only that mode’s legs', async () => {
    const { hourlyDistances } = require('../periodStats');
    const db: Db = createMockDb() as unknown as Db;
    await runMigrations(db);
    const day = new Date(2026, 5, 29);
    const at = (h: number, m = 0) => day.getTime() + (h * 60 + m) * 60_000;
    // 07h: mixed walk+car trip. 18h: pure car trip.
    await insertTripWithSections(db, mkTrip({
      startMs: at(7, 35), distanceM: 14_600, durationS: 3480, mode: 'car', co2G: 100,
      legs: [{ mode: 'walk', distanceM: 1000 }, { mode: 'car', distanceM: 13_600 }],
    }));
    await insertTripWithSections(db, mkTrip({ startMs: at(18, 14), distanceM: 18_400, durationS: 5160, mode: 'car', co2G: 150 }));

    const buckets = await hourlyDistances(db, day.getTime(), day.getTime() + 86_400_000 - 1, 'car');
    expect(buckets).toHaveLength(24);
    expect(buckets[7]).toMatchObject({ distanceM: 13_600, tripsCount: 1 });
    expect(buckets[18]).toMatchObject({ distanceM: 18_400, tripsCount: 1 });
    expect(buckets[3]).toMatchObject({ distanceM: 0, tripsCount: 0 });

    const walkBuckets = await hourlyDistances(db, day.getTime(), day.getTime() + 86_400_000 - 1, 'walk');
    expect(walkBuckets[7]).toMatchObject({ distanceM: 1000, tripsCount: 1 });
    expect(walkBuckets[18]).toMatchObject({ distanceM: 0, tripsCount: 0 });
  });
});
