import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertTripWithSections } from '../../db/trips';
import { periodKpi, dailyDistances } from '../periodStats';
import { modeBreakdown } from '../modeBreakdown';
import type { Db } from '../../db/client';
import type { Trip, Mode } from '../../types';

function mkTrip(opts: {
  startMs: number;
  distanceM: number;
  durationS: number;
  mode: Mode;
  co2G: number;
}): Trip {
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
    sections: [
      {
        ordering: 0,
        startTimeMs: opts.startMs,
        endTimeMs: opts.startMs + opts.durationS * 1000,
        mode: opts.mode,
        distanceM: opts.distanceM,
        durationS: opts.durationS,
        avgSpeedMps: opts.distanceM / opts.durationS,
        maxSpeedMps: opts.distanceM / opts.durationS,
        co2G: opts.co2G,
        geojson: '{}',
      },
    ],
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
});
