import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import {
  insertTripWithSections,
  listTrips,
  deleteTrips,
  getTripsByIds,
  getTripsOverlapping,
  getTripBefore,
  getTripAfter,
} from '../trips';
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
    draft: false,
    draftReason: null,
    edited: false,
    locked: false,
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

  it('round-trips edited/locked flags', async () => {
    const t = mkTrip(1000, 2000);
    t.edited = true;
    t.locked = true;
    const id = await insertTripWithSections(db, t);
    const got = (await getTripsByIds(db, [id]))[0]!;
    expect(got.edited).toBe(true);
    expect(got.locked).toBe(true);
  });
});

describe('trip range helpers', () => {
  let db: Db;
  let a: number, b: number, c: number;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
    a = await insertTripWithSections(db, mkTrip(1000, 2000));
    b = await insertTripWithSections(db, mkTrip(3000, 4000));
    c = await insertTripWithSections(db, mkTrip(5000, 6000));
  });

  it('getTripsByIds returns the requested trips ordered by start', async () => {
    const got = await getTripsByIds(db, [c, a]);
    expect(got.map((t) => t.id)).toEqual([a, c]);
  });

  it('getTripsOverlapping returns trips intersecting the half-open span', async () => {
    // span [3000, 5000): includes b (start 3000) but not c (start == 5000).
    const got = await getTripsOverlapping(db, 3000, 5000);
    expect(got.map((t) => t.id)).toEqual([b]);
  });

  it('getTripsOverlapping includes a trip that straddles the start bound', async () => {
    // span [1500, 3500): a ends at 2000 (> 1500) and starts before -> overlaps.
    const got = await getTripsOverlapping(db, 1500, 3500);
    expect(got.map((t) => t.id)).toEqual([a, b]);
  });

  it('getTripBefore returns the latest trip starting before ms', async () => {
    expect((await getTripBefore(db, 3000))?.id).toBe(a);
    expect(await getTripBefore(db, 1000)).toBeNull();
  });

  it('getTripAfter returns the earliest trip starting at/after ms', async () => {
    expect((await getTripAfter(db, 4000))?.id).toBe(c);
    expect(await getTripAfter(db, 6000)).toBeNull();
  });
});
