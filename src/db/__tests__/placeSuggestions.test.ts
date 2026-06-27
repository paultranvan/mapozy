import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import {
  findOrCreatePlace,
  getUnnamedClusters,
  createUserPlace,
} from '../places';
import { insertTripWithSections } from '../trips';
import type { Db } from '../client';
import type { Trip } from '../../types';

// A bare trip ending at `endPlaceId`. Only the fields the insert reads matter.
function tripEndingAt(endPlaceId: number, startMs: number): Trip {
  return {
    id: 0,
    startTimeMs: startMs,
    endTimeMs: startMs + 600_000,
    startPlaceId: null,
    endPlaceId,
    distanceM: 1000,
    durationS: 600,
    dominantMode: 'walk',
    co2G: 0,
    geojson: '{"type":"LineString","coordinates":[[2,48],[2.01,48.01]]}',
    manualPurpose: null,
    draft: false,
    draftReason: null,
    edited: false,
    locked: false,
    createdAtMs: startMs,
    sections: [],
    breaks: [],
  };
}

describe('getUnnamedClusters — visit count from trips, not stored visit_count', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('does NOT suggest a place with an inflated visit_count but only one arrival', async () => {
    const placeId = await findOrCreatePlace(db, 48.9, 2.4, 1_000);
    // Simulate the over-counting bug: bump visit_count far past the threshold
    // without any matching trips (mimics repeated recompute double-counting).
    await db.runAsync(`UPDATE places SET visit_count = 6 WHERE id = ?`, placeId);
    // Exactly one real arrival.
    await insertTripWithSections(db, tripEndingAt(placeId, 2_000));

    const clusters = await getUnnamedClusters(db, 20);
    expect(clusters.find((c) => c.id === placeId)).toBeUndefined();
  });

  it('suggests a place with >= 3 real arrivals and reports the true count', async () => {
    const placeId = await findOrCreatePlace(db, 48.5, 2.5, 1_000);
    await db.runAsync(`UPDATE places SET visit_count = 0 WHERE id = ?`, placeId);
    for (let i = 0; i < 3; i++) {
      await insertTripWithSections(db, tripEndingAt(placeId, 10_000 + i * 1000));
    }

    const clusters = await getUnnamedClusters(db, 20);
    const hit = clusters.find((c) => c.id === placeId);
    expect(hit).toBeDefined();
    expect(hit!.visitCount).toBe(3); // derived from arrivals, not the column
  });

  it('excludes frequent stops already owned by a user POI', async () => {
    const placeId = await findOrCreatePlace(db, 48.5, 2.5, 1_000);
    for (let i = 0; i < 4; i++) {
      await insertTripWithSections(db, tripEndingAt(placeId, 10_000 + i * 1000));
    }
    await createUserPlace(db, {
      name: 'Home',
      category: 'home',
      latitude: 48.5,
      longitude: 2.5,
      radiusM: 100,
    });

    const clusters = await getUnnamedClusters(db, 20);
    expect(clusters.find((c) => c.id === placeId)).toBeUndefined();
  });
});
