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
import type { Db } from '../client';

describe('user POIs', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

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
    // cluster A: 3 visits (covered by user POI → excluded)
    await findOrCreatePlace(db, 45.7500, 4.8500, 1000);
    await findOrCreatePlace(db, 45.7500, 4.8500, 2000);
    await findOrCreatePlace(db, 45.7500, 4.8500, 2500); // cluster A: 3 visits
    // cluster B: 3 visits (not covered → should appear)
    await findOrCreatePlace(db, 45.8000, 4.9000, 3000);
    await findOrCreatePlace(db, 45.8000, 4.9000, 4000);
    await findOrCreatePlace(db, 45.8000, 4.9000, 5000); // cluster B: 3 visits
    await createUserPlace(db, { name: 'Maison', category: 'home', latitude: 45.7500, longitude: 4.8500, radiusM: 100 });
    const clusters = await getUnnamedClusters(db, 10);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ latitude: 45.8, longitude: 4.9 });
  });

  it('only suggests clusters with at least 3 visits', async () => {
    // cluster A: 3 visits; cluster B: 2 visits (far apart)
    for (const t of [1, 2, 3]) await findOrCreatePlace(db, 45.7500, 4.8500, t);
    for (const t of [4, 5]) await findOrCreatePlace(db, 45.9000, 5.1000, t);
    const clusters = await getUnnamedClusters(db, 10);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ latitude: 45.75, longitude: 4.85, visitCount: 3 });
  });

  it('excludes a dismissed cluster from suggestions', async () => {
    for (const t of [1, 2, 3]) await findOrCreatePlace(db, 45.7500, 4.8500, t);
    const before = await getUnnamedClusters(db, 10);
    expect(before).toHaveLength(1);
    await dismissSuggestion(db, before[0]!.id);
    expect(await getUnnamedClusters(db, 10)).toHaveLength(0);
  });
});
