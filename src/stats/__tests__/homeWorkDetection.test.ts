import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { findOrCreatePlace, createUserPlace } from '../../db/places';
import { insertTripWithSections } from '../../db/trips';
import { suggestHomeWork } from '../homeWorkDetection';
import type { Db } from '../../db/client';

// N distinct recent days, each at 23:00 LOCAL (overnight → counts as "home presence")
function overnightTimes(n: number): number[] {
  const out: number[] = [];
  for (let day = 1; day <= n; day++) {
    const d = new Date(Date.now() - day * 86_400_000);
    d.setHours(23, 0, 0, 0);
    out.push(d.getTime());
  }
  return out;
}

async function homeTripAt(db: Db, endMs: number, placeId: number) {
  await insertTripWithSections(db, {
    startTimeMs: endMs - 600_000, endTimeMs: endMs,
    startPlaceId: placeId, endPlaceId: placeId,
    distanceM: 1000, durationS: 600, dominantMode: 'car', co2G: 0,
    geojson: '{}', manualPurpose: null, draft: false, draftReason: null,
    edited: false, locked: false, createdAtMs: endMs, sections: [], breaks: [],
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

  async function seedHomeCandidate(db: Db) {
    const pid = await findOrCreatePlace(db, 45.75, 4.85, Date.now());
    for (const t of overnightTimes(6)) await homeTripAt(db, t, pid);
    return pid;
  }

  it('suggests a home for an uncovered overnight cluster', async () => {
    await seedHomeCandidate(db);
    const s = await suggestHomeWork(db);
    expect(s.home).not.toBeNull();
    expect(s.home!.category).toBe('home');
  });

  it('still suggests home even if a home POI exists ELSEWHERE (multiple homes)', async () => {
    await seedHomeCandidate(db);
    await createUserPlace(db, { name: 'Maison de famille', category: 'home', latitude: 46.10, longitude: 5.20, radiusM: 100 });
    const s = await suggestHomeWork(db);
    expect(s.home).not.toBeNull(); // the candidate cluster is still unnamed
  });

  it('suppresses the suggestion once a user POI covers the candidate cluster', async () => {
    await seedHomeCandidate(db);
    await createUserPlace(db, { name: 'Maison', category: 'home', latitude: 45.75, longitude: 4.85, radiusM: 100 });
    const s = await suggestHomeWork(db);
    expect(s.home).toBeNull();
  });
});
