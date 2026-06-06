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
  resetTripToAuto,
} from '../tripEdits';
import { insertRawPoint } from '../rawPoints';
import { insertRawActivity } from '../rawActivities';
import { runPipeline } from '../../pipeline/runPipeline';
import type { Db } from '../client';
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

describe('resetTripToAuto', () => {
  it('clears locked/edited and rebuilds the trip from raw data', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const endMs = await seedOneTrip(db);
    await runPipeline(db, { upToMs: endMs + 1, nowMs: endMs });
    const trips = await listTrips(db, 100, 0);
    expect(trips.length).toBe(1);
    const tripId = trips[0]!.id!;

    // Simulate a structural edit having happened.
    await db.runAsync(`UPDATE trips SET locked = 1, edited = 1 WHERE id = ?`, tripId);

    await resetTripToAuto(db, tripId, endMs);

    const after = await listTrips(db, 100, 0);
    for (const t of after) {
      expect(t.locked).toBe(false);
      expect(t.edited).toBe(false);
    }
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
