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
