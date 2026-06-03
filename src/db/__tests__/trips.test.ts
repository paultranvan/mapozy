import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { insertTripWithSections, listTrips, deleteTrips } from '../trips';
import { getSectionsForTrip } from '../sections';
import type { Trip } from '../../types';
import type { Db } from '../client';

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
    createdAtMs: startMs,
    sections: [
      {
        ordering: 0,
        startTimeMs: startMs,
        endTimeMs: endMs,
        mode: 'car',
        distanceM: 1000,
        durationS: 600,
        avgSpeedMps: 1.6,
        maxSpeedMps: 3,
        co2G: 0,
        geojson: '{"type":"FeatureCollection","features":[]}',
      },
    ],
    breaks: [],
  };
}

describe('deleteTrips', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('deletes the given trips and cascades their sections', async () => {
    const a = await insertTripWithSections(db, mkTrip(1000, 2000));
    const b = await insertTripWithSections(db, mkTrip(3000, 4000));
    const c = await insertTripWithSections(db, mkTrip(5000, 6000));

    await deleteTrips(db, [a, c]);

    const remaining = await listTrips(db, 100, 0);
    expect(remaining.map((t) => t.id)).toEqual([b]);
    expect(await getSectionsForTrip(db, a)).toHaveLength(0);
    expect(await getSectionsForTrip(db, b)).toHaveLength(1);
  });

  it('is a no-op for an empty id list', async () => {
    const a = await insertTripWithSections(db, mkTrip(1000, 2000));
    await deleteTrips(db, []);
    expect(await listTrips(db, 100, 0)).toHaveLength(1);
    expect(a).toBeGreaterThan(0);
  });
});
