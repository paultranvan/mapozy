import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { insertTripWithSections, listDraftTripIds } from '../trips';
import type { Trip } from '../../types';

function trip(draft: boolean, start: number): Trip {
  return {
    startTimeMs: start,
    endTimeMs: start + 1000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 100,
    durationS: 1,
    dominantMode: 'car',
    co2G: 0,
    geojson: '{"type":"LineString","coordinates":[]}',
    manualPurpose: null,
    draft,
    draftReason: draft ? 'offline' : null,
    edited: false,
    locked: false,
    createdAtMs: 0,
    sections: [],
    breaks: [],
  };
}

describe('listDraftTripIds', () => {
  it('returns only draft trip ids, newest first', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const a = await insertTripWithSections(db, trip(true, 1000));
    await insertTripWithSections(db, trip(false, 2000));
    const c = await insertTripWithSections(db, trip(true, 3000));

    const ids = await listDraftTripIds(db);
    expect(ids).toEqual([c, a]); // start 3000 before 1000
  });

  it('returns [] when no drafts', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertTripWithSections(db, trip(false, 1000));
    expect(await listDraftTripIds(db)).toEqual([]);
  });
});
