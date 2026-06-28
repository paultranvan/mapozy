import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { findOrCreatePlace, createUserPlace } from '../../db/places';
import { insertTripWithSections } from '../../db/trips';
import { suggestHome } from '../homeDetection';
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

describe('suggestHome', () => {
  let db: Db;
  beforeEach(async () => { db = createMockDb(); await runMigrations(db); });

  it('does not mutate places (no labels written)', async () => {
    const pid = await findOrCreatePlace(db, 45.75, 4.85, Date.now());
    await suggestHome(db);
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
    const s = await suggestHome(db);
    expect(s).not.toBeNull();
    expect(s!.category).toBe('home');
  });

  it('still suggests home even if a home POI exists ELSEWHERE (multiple homes)', async () => {
    await seedHomeCandidate(db);
    await createUserPlace(db, { name: 'Maison de famille', category: 'home', latitude: 46.10, longitude: 5.20, radiusM: 100 });
    const s = await suggestHome(db);
    expect(s).not.toBeNull(); // the candidate cluster is still unnamed
  });

  it('suppresses the suggestion once a user POI covers the candidate cluster', async () => {
    await seedHomeCandidate(db);
    await createUserPlace(db, { name: 'Maison', category: 'home', latitude: 45.75, longitude: 4.85, radiusM: 100 });
    const s = await suggestHome(db);
    expect(s).toBeNull();
  });

  // Regression: real home is where you SLEEP — you arrive in the evening (before
  // 21:00) and leave in the morning (after 08:00), so every trip endpoint lands
  // in the daytime window even though the place is overwhelmingly home.
  // Detection must measure overnight DWELL (a stay spanning the night), not the
  // hour of the transition instants.
  it('detects home from overnight dwell even when all endpoints are daytime', async () => {
    const home = await findOrCreatePlace(db, 45.75, 4.85, Date.now());
    const elsewhere = await findOrCreatePlace(db, 45.80, 4.90, Date.now());
    // 6 days: arrive home ~18:00, depart home ~08:30 next morning.
    for (let day = 1; day <= 6; day++) {
      const base = new Date(Date.now() - day * 86_400_000);
      const evening = new Date(base); evening.setHours(18, 0, 0, 0);
      const morning = new Date(base); morning.setHours(8, 30, 0, 0); // same calendar day, before the evening arrival
      // trip arriving home in the evening (elsewhere -> home)
      await insertTripWithSections(db, {
        startTimeMs: evening.getTime() - 600_000, endTimeMs: evening.getTime(),
        startPlaceId: elsewhere, endPlaceId: home,
        distanceM: 1000, durationS: 600, dominantMode: 'car', co2G: 0,
        geojson: '{}', manualPurpose: null, draft: false, draftReason: null,
        edited: false, locked: false, createdAtMs: evening.getTime(), sections: [], breaks: [],
      } as any);
      // trip departing home in the morning (home -> elsewhere)
      await insertTripWithSections(db, {
        startTimeMs: morning.getTime(), endTimeMs: morning.getTime() + 600_000,
        startPlaceId: home, endPlaceId: elsewhere,
        distanceM: 1000, durationS: 600, dominantMode: 'car', co2G: 0,
        geojson: '{}', manualPurpose: null, draft: false, draftReason: null,
        edited: false, locked: false, createdAtMs: morning.getTime(), sections: [], breaks: [],
      } as any);
    }
    const s = await suggestHome(db);
    expect(s).not.toBeNull();
    expect(Math.abs(s!.latitude - 45.75)).toBeLessThan(0.01);
  });
});
