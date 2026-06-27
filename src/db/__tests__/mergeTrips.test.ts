import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { insertTripWithSections, getTripById } from '../trips';
import { mergeTrips } from '../tripEdits';
import type { Db } from '../client';
import type { Trip, Section } from '../../types';

function section(ordering: number, coords: [number, number][], startMs: number): Section {
  return {
    id: 0,
    tripId: 0,
    ordering,
    startTimeMs: startMs,
    endTimeMs: startMs + 300_000,
    mode: 'walk',
    distanceM: 500,
    durationS: 300,
    avgSpeedMps: 1.4,
    maxSpeedMps: 2,
    co2G: 0,
    geojson: JSON.stringify({ type: 'LineString', coordinates: coords }),
  };
}

function trip(startMs: number, sections: Section[]): Trip {
  const last = sections[sections.length - 1]!;
  return {
    id: 0,
    startTimeMs: startMs,
    endTimeMs: last.endTimeMs,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 500 * sections.length,
    durationS: 300 * sections.length,
    dominantMode: 'walk',
    co2G: 0,
    geojson: '{"type":"LineString","coordinates":[[2,48],[2.01,48.01]]}',
    manualPurpose: null,
    draft: false,
    draftReason: null,
    edited: false,
    locked: false,
    createdAtMs: startMs,
    sections,
    breaks: [],
  };
}

describe('mergeTrips — boundary gap detection', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('flags the boundary as a gap when the two trips do not join up', async () => {
    // First ends at [2.36, 48.79]; second starts ~4 km away at [2.40, 48.82].
    const firstId = await insertTripWithSections(
      db,
      trip(1_000, [section(0, [[2.35, 48.78], [2.36, 48.79]], 1_000)])
    );
    const secondId = await insertTripWithSections(
      db,
      trip(2_000_000, [section(0, [[2.40, 48.82], [2.41, 48.83]], 2_000_000)])
    );

    await mergeTrips(db, firstId, secondId);

    const merged = await getTripById(db, firstId);
    const boundary = merged!.breaks.find((b) => b.ordering === 0);
    expect(boundary).toBeDefined();
    expect(boundary!.gap).toBe(true);
  });

  it('does not flag a gap when the trips join up (same stay)', async () => {
    const firstId = await insertTripWithSections(
      db,
      trip(1_000, [section(0, [[2.35, 48.78], [2.36, 48.79]], 1_000)])
    );
    // Second starts ~15 m from where the first ended.
    const secondId = await insertTripWithSections(
      db,
      trip(2_000_000, [section(0, [[2.3601, 48.7901], [2.37, 48.80]], 2_000_000)])
    );

    await mergeTrips(db, firstId, secondId);

    const merged = await getTripById(db, firstId);
    const boundary = merged!.breaks.find((b) => b.ordering === 0);
    expect(boundary!.gap).toBe(false);
  });
});
