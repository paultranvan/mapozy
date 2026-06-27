import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import {
  findOrCreatePlace,
  createUserPlace,
  updateUserPlace,
  deleteUserPlace,
  getUserPlaces,
  getUserPoiVisitStats,
  getUnnamedClusters,
  dismissSuggestion,
} from '../places';
import { insertTripWithSections } from '../trips';
import type { Db } from '../client';
import type { Trip } from '../../types';

describe('user POIs', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  // Suggestions count real trip arrivals (end_place_id), not the stored
  // visit_count column. Record `n` arrivals at the place covering (lat, lon).
  async function recordArrivals(lat: number, lon: number, n: number): Promise<number> {
    let placeId = 0;
    for (let i = 0; i < n; i++) {
      placeId = await findOrCreatePlace(db, lat, lon, 1000 + i);
      const trip: Trip = {
        id: 0,
        startTimeMs: 1000 + i,
        endTimeMs: 2000 + i,
        startPlaceId: null,
        endPlaceId: placeId,
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
        createdAtMs: 1000 + i,
        sections: [],
        breaks: [],
      };
      await insertTripWithSections(db, trip);
    }
    return placeId;
  }

  it('creates, lists, updates and deletes a user POI', async () => {
    const id = await createUserPlace(db, {
      name: 'Maison', category: 'home', latitude: 45.75, longitude: 4.85, radiusM: 120,
    });
    let pois = await getUserPlaces(db);
    expect(pois).toHaveLength(1);
    expect(pois[0]).toMatchObject({ name: 'Maison', category: 'home', kind: 'user', radiusM: 120 });

    await updateUserPlace(db, id, { name: 'Chez moi', category: 'home', latitude: 45.75, longitude: 4.85, radiusM: 80 });
    pois = await getUserPlaces(db);
    expect(pois[0]).toMatchObject({ name: 'Chez moi', radiusM: 80 });

    await deleteUserPlace(db, id);
    expect(await getUserPlaces(db)).toHaveLength(0);
  });

  it('does not list auto places as user POIs', async () => {
    await findOrCreatePlace(db, 45.75, 4.85, 1000);
    expect(await getUserPlaces(db)).toHaveLength(0);
  });

  it('visit stats sum auto-place visits within the POI radius', async () => {
    await findOrCreatePlace(db, 45.7500, 4.8500, 1000); // visit 1
    await findOrCreatePlace(db, 45.7500, 4.8500, 2000); // visit 2 (same cluster)
    await findOrCreatePlace(db, 45.7503, 4.8500, 3000); // ~33m -> same 100m radius
    await findOrCreatePlace(db, 45.8000, 4.9000, 4000); // far away
    const id = await createUserPlace(db, {
      name: 'Maison', category: 'home', latitude: 45.7500, longitude: 4.8500, radiusM: 100,
    });
    const poi = (await getUserPlaces(db)).find((p) => p.id === id)!;
    const stats = await getUserPoiVisitStats(db, poi);
    expect(stats.visitCount).toBe(3); // 2 + 1, far one excluded
    expect(stats.lastSeenMs).toBe(3000);
  });

  it('persists and updates the display_name (address) of a user POI', async () => {
    const id = await createUserPlace(db, {
      name: 'Basic-Fit', category: 'sport', latitude: 45.75, longitude: 4.85, radiusM: 100,
      displayName: '85 Av. Berthelot, Lyon',
    });
    let poi = (await getUserPlaces(db)).find((p) => p.id === id)!;
    expect(poi.displayName).toBe('85 Av. Berthelot, Lyon');

    await updateUserPlace(db, id, {
      name: 'Basic-Fit', category: 'sport', latitude: 45.75, longitude: 4.85, radiusM: 100,
      displayName: 'Avenue Jean Jaurès, Lyon',
    });
    poi = (await getUserPlaces(db)).find((p) => p.id === id)!;
    expect(poi.displayName).toBe('Avenue Jean Jaurès, Lyon');
  });

  it('lists unnamed clusters not already inside a user POI, busiest first', async () => {
    await recordArrivals(45.7500, 4.8500, 3); // cluster A: 3 arrivals (covered by POI → excluded)
    await recordArrivals(45.8000, 4.9000, 3); // cluster B: 3 arrivals (not covered → should appear)
    await createUserPlace(db, { name: 'Maison', category: 'home', latitude: 45.7500, longitude: 4.8500, radiusM: 100 });
    const clusters = await getUnnamedClusters(db, 10);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ latitude: 45.8, longitude: 4.9 });
  });

  it('only suggests clusters with at least 3 visits', async () => {
    await recordArrivals(45.7500, 4.8500, 3); // cluster A: 3 arrivals
    await recordArrivals(45.9000, 5.1000, 2); // cluster B: 2 arrivals (far apart)
    const clusters = await getUnnamedClusters(db, 10);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ latitude: 45.75, longitude: 4.85, visitCount: 3 });
  });

  it('excludes a dismissed cluster from suggestions', async () => {
    await recordArrivals(45.7500, 4.8500, 3);
    const before = await getUnnamedClusters(db, 10);
    expect(before).toHaveLength(1);
    await dismissSuggestion(db, before[0]!.id);
    expect(await getUnnamedClusters(db, 10)).toHaveLength(0);
  });

  it('stores and returns a custom category key verbatim', async () => {
    const id = await createUserPlace(db, { name: 'Climb gym', category: 'custom:7', latitude: 45.75, longitude: 4.85, radiusM: 100 });
    const poi = (await getUserPlaces(db)).find((p) => p.id === id)!;
    expect(poi.category).toBe('custom:7');
  });
});
