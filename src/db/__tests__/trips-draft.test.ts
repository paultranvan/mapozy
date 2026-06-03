import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { insertTripWithSections, getTripById, listTrips } from '../trips';
import type { Trip } from '../../types';

function baseTrip(over: Partial<Trip>): Trip {
  return {
    startTimeMs: 0,
    endTimeMs: 1000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 100,
    durationS: 1,
    dominantMode: 'car',
    co2G: 0,
    geojson: '{"type":"LineString","coordinates":[]}',
    manualPurpose: null,
    draft: false,
    draftReason: null,
    createdAtMs: 0,
    sections: [],
    breaks: [],
    ...over,
  };
}

describe('trips DB — draft round-trip', () => {
  it('persists and reads back draft + draft_reason', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await insertTripWithSections(
      db,
      baseTrip({ draft: true, draftReason: 'rate_limited' })
    );

    const t = await getTripById(db, id);
    expect(t!.draft).toBe(true);
    expect(t!.draftReason).toBe('rate_limited');
  });

  it('defaults to non-draft', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await insertTripWithSections(db, baseTrip({}));
    const [t] = await listTrips(db, 10, 0);
    expect(t!.id).toBe(id);
    expect(t!.draft).toBe(false);
    expect(t!.draftReason).toBeNull();
  });
});
