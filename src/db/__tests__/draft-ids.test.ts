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

  it('excludes locked trips even if they are draft', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await insertTripWithSections(db, trip(true, 1000));
    await db.runAsync(`UPDATE trips SET locked = 1 WHERE id = ?`, id);
    expect(await listDraftTripIds(db)).not.toContain(id);
  });

  it('orders cheap trips before expensive ones (pending car-section distance)', async () => {
    // Enrichment cost is driven by the car sections still needing Overpass
    // (walk/train sections and user-overridden ones cost nothing). Cheap
    // trips must drain first so one long-distance ride cannot starve the
    // queue (2026-07-14 export: a 641 km trip blocked 17 older drafts).
    const db = createMockDb();
    await runMigrations(db);
    const section = (mode: string, distanceM: number, userMode?: string) => ({
      ordering: 0,
      startTimeMs: 0,
      endTimeMs: 1000,
      mode: mode as 'car',
      distanceM,
      durationS: 1,
      avgSpeedMps: 1,
      maxSpeedMps: 1,
      co2G: 0,
      geojson: '{"type":"LineString","coordinates":[]}',
      userMode: userMode as 'train' | undefined,
    });
    const bigCar = await insertTripWithSections(db, {
      ...trip(true, 3000),
      sections: [section('car', 300_000)],
    });
    const smallCar = await insertTripWithSections(db, {
      ...trip(true, 2000),
      sections: [section('car', 5_000)],
    });
    const walkOnly = await insertTripWithSections(db, {
      ...trip(true, 1000),
      sections: [section('walk', 2_000)],
    });
    const overridden = await insertTripWithSections(db, {
      ...trip(true, 4000),
      sections: [section('car', 500_000, 'train')],
    });

    // Zero-cost trips first (newest first among them), then by rising cost.
    expect(await listDraftTripIds(db)).toEqual([overridden, walkOnly, smallCar, bigCar]);
  });
});
