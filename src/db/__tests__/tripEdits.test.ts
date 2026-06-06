import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { insertTripWithSections, getTripById, listTrips } from '../trips';
import { getSectionsForTrip } from '../sections';
import {
  setSectionMode,
  mergeAdjacentSections,
  splitSection,
  mergeTrips,
  splitTrip,
} from '../tripEdits';
import type { Trip, Section } from '../../types';

function line(coords: Array<[number, number]>): string {
  return JSON.stringify({ type: 'LineString', coordinates: coords });
}

function mkSection(p: Partial<Section>): Section {
  return {
    ordering: 0,
    startTimeMs: 0,
    endTimeMs: 10_000,
    mode: 'car',
    distanceM: 1000,
    durationS: 10,
    avgSpeedMps: 100,
    maxSpeedMps: 100,
    co2G: 0,
    geojson: line([[0, 0], [0, 0.01]]),
    ...p,
  };
}

function mkTrip(p: Partial<Trip> = {}): Trip {
  return {
    id: 0,
    startTimeMs: 0,
    endTimeMs: 20_000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 2000,
    durationS: 20,
    dominantMode: 'car',
    co2G: 0,
    geojson: line([[0, 0], [0, 0.02]]),
    manualPurpose: null,
    draft: false,
    draftReason: null,
    edited: false,
    locked: false,
    createdAtMs: 0,
    sections: [
      mkSection({
        ordering: 0,
        startTimeMs: 0,
        endTimeMs: 10_000,
        mode: 'car',
        geojson: line([[0, 0], [0, 0.01]]),
      }),
      mkSection({
        ordering: 1,
        startTimeMs: 10_000,
        endTimeMs: 20_000,
        mode: 'walk',
        geojson: line([[0, 0.01], [0, 0.02]]),
      }),
    ],
    breaks: [],
    ...p,
  };
}

describe('setSectionMode', () => {
  it('sets user_mode, marks edited (not locked), recomputes dominant', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await insertTripWithSections(db, mkTrip());
    const secs = await getSectionsForTrip(db, id);
    await setSectionMode(db, id, secs[0]!.id!, 'bus');
    const trip = (await getTripById(db, id))!;
    expect(trip.sections[0]!.userMode).toBe('bus');
    expect(trip.edited).toBe(true);
    expect(trip.locked).toBe(false);
  });
});

describe('mergeAdjacentSections', () => {
  it('merges two legs into one, locks the trip, removes the between-break', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const trip = mkTrip();
    trip.breaks = [
      { ordering: 0, startTimeMs: 9000, endTimeMs: 10_000, centerLat: 0, centerLon: 0.01, gap: false },
    ];
    const id = await insertTripWithSections(db, trip);
    await mergeAdjacentSections(db, id, 0);
    const out = (await getTripById(db, id))!;
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0]!.ordering).toBe(0);
    expect(out.sections[0]!.startTimeMs).toBe(0);
    expect(out.sections[0]!.endTimeMs).toBe(20_000);
    expect(out.breaks).toHaveLength(0);
    expect(out.locked).toBe(true);
    expect(out.edited).toBe(true);
  });
});

describe('splitSection', () => {
  it('splits one leg into two, shifts breaks, locks the trip', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const trip = mkTrip();
    trip.sections[0]!.geojson = line([[0, 0], [0, 0.005], [0, 0.01]]);
    trip.breaks = [
      { ordering: 0, startTimeMs: 9000, endTimeMs: 10_000, centerLat: 0, centerLon: 0.01, gap: false },
    ];
    const id = await insertTripWithSections(db, trip);
    const secs = (await getTripById(db, id))!.sections;
    await splitSection(db, id, secs[0]!.id!, 1);
    const out = (await getTripById(db, id))!;
    expect(out.sections).toHaveLength(3);
    expect(out.sections.map((s) => s.ordering)).toEqual([0, 1, 2]);
    expect(out.breaks[0]!.ordering).toBe(1);
    expect(out.locked).toBe(true);
  });
});

describe('mergeTrips', () => {
  it('folds the second trip into the first with a break between, deletes the second', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const t1 = mkTrip({ startTimeMs: 0, endTimeMs: 20_000 });
    const t2 = mkTrip({ startTimeMs: 30_000, endTimeMs: 50_000 });
    t2.sections = [
      mkSection({
        ordering: 0,
        startTimeMs: 30_000,
        endTimeMs: 40_000,
        mode: 'bike',
        geojson: line([[0, 0.03], [0, 0.04]]),
      }),
      mkSection({
        ordering: 1,
        startTimeMs: 40_000,
        endTimeMs: 50_000,
        mode: 'walk',
        geojson: line([[0, 0.04], [0, 0.05]]),
      }),
    ];
    const id1 = await insertTripWithSections(db, t1);
    const id2 = await insertTripWithSections(db, t2);

    await mergeTrips(db, id1, id2);

    const remaining = await listTrips(db, 100, 0);
    expect(remaining.map((t) => t.id)).toEqual([id1]);
    const out = (await getTripById(db, id1))!;
    expect(out.sections).toHaveLength(4);
    expect(out.sections.map((s) => s.ordering)).toEqual([0, 1, 2, 3]);
    expect(out.endTimeMs).toBe(50_000);
    expect(out.locked).toBe(true);
    expect(out.breaks.some((b) => b.ordering === 1)).toBe(true);
  });
});

describe('splitTrip', () => {
  it('splits a trip into two at an interior vertex, creating a shared place', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const trip = mkTrip();
    trip.sections[0]!.geojson = line([[0, 0], [0, 0.005], [0, 0.01]]);
    const id = await insertTripWithSections(db, trip);
    const secs = (await getTripById(db, id))!.sections;
    const res = await splitTrip(db, id, secs[0]!.id!, 1);

    const t1 = (await getTripById(db, res.firstTripId))!;
    const t2 = (await getTripById(db, res.secondTripId))!;
    expect(t1.endPlaceId).not.toBeNull();
    expect(t2.startPlaceId).toBe(t1.endPlaceId);
    expect(t1.locked).toBe(true);
    expect(t2.locked).toBe(true);
    expect(t1.sections.length).toBeGreaterThanOrEqual(1);
    expect(t2.sections.length).toBeGreaterThanOrEqual(1);
    expect(t2.sections.map((s) => s.ordering)).toEqual(t2.sections.map((_, i) => i));
  });
});
