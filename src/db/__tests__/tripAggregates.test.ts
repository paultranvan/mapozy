import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { insertTripWithSections, getTripById } from '../trips';
import { recomputeAndPersistTripAggregates } from '../tripAggregates';
import type { Trip } from '../../types';

function line(coords: Array<[number, number]>): string {
  return JSON.stringify({ type: 'LineString', coordinates: coords });
}

function mkTrip(): Trip {
  return {
    id: 0,
    startTimeMs: 0,
    endTimeMs: 20_000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 0,
    durationS: 20,
    dominantMode: 'car',
    co2G: 0,
    geojson: line([[0, 0]]),
    manualPurpose: null,
    draft: false,
    draftReason: null,
    edited: false,
    locked: false,
    createdAtMs: 0,
    sections: [
      {
        ordering: 0,
        startTimeMs: 0,
        endTimeMs: 10_000,
        mode: 'car',
        distanceM: 9000,
        durationS: 10,
        avgSpeedMps: 900,
        maxSpeedMps: 900,
        co2G: 0,
        geojson: line([[0, 0], [0, 0.08]]),
        userMode: 'train',
      },
      {
        ordering: 1,
        startTimeMs: 10_000,
        endTimeMs: 20_000,
        mode: 'walk',
        distanceM: 1000,
        durationS: 10,
        avgSpeedMps: 100,
        maxSpeedMps: 100,
        co2G: 0,
        geojson: line([[0, 0.08], [0, 0.09]]),
      },
    ],
    breaks: [],
  };
}

describe('recomputeAndPersistTripAggregates', () => {
  it('updates dominant/co2/geojson from effective modes', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await insertTripWithSections(db, mkTrip());
    await recomputeAndPersistTripAggregates(db, id);
    const trip = (await getTripById(db, id))!;
    expect(trip.dominantMode).toBe('train');
    const g = JSON.parse(trip.geojson);
    expect(g.coordinates[0]).toEqual([0, 0]);
    expect(g.coordinates[g.coordinates.length - 1]).toEqual([0, 0.09]);
  });
});
