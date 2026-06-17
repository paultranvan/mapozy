import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { findOrCreatePlace, createUserPlace } from '../../db/places';
import { insertTripWithSections } from '../../db/trips';
import { suggestHomeWork } from '../homeWorkDetection';
import type { Db } from '../../db/client';

async function tripAt(db: Db, startMs: number, placeId: number) {
  await insertTripWithSections(db, {
    startTimeMs: startMs, endTimeMs: startMs + 600_000,
    startPlaceId: placeId, endPlaceId: placeId,
    distanceM: 1000, durationS: 600, dominantMode: 'car', co2G: 0,
    geojson: '{}', manualPurpose: null, draft: false, draftReason: null,
    edited: false, locked: false, createdAtMs: startMs, sections: [], breaks: [],
  } as any);
}

describe('suggestHomeWork', () => {
  let db: Db;
  beforeEach(async () => { db = createMockDb(); await runMigrations(db); });

  it('does not mutate places (no labels written)', async () => {
    const pid = await findOrCreatePlace(db, 45.75, 4.85, Date.now());
    await suggestHomeWork(db);
    const row = await db.getFirstAsync<{ label: string | null }>(`SELECT label FROM places WHERE id = ?`, pid);
    expect(row?.label ?? null).toBeNull();
  });

  it('suppresses the home suggestion when a user home POI already exists', async () => {
    await createUserPlace(db, { name: 'Maison', category: 'home', latitude: 45.75, longitude: 4.85, radiusM: 100 });
    const s = await suggestHomeWork(db);
    expect(s.home).toBeNull();
  });
});
