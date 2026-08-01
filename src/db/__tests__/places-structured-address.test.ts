import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { createUserPlace, updateUserPlace, getPlaceById } from '../places';
import type { Db } from '../client';

describe('user POI structured address', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('persists structured address fields on create', async () => {
    const id = await createUserPlace(db, {
      name: 'Basic-Fit',
      category: 'sport',
      latitude: 45.75,
      longitude: 4.85,
      radiusM: 100,
      displayName: '85 Avenue Berthelot, Lyon',
      street: 'Avenue Berthelot',
      houseNumber: '85',
      postalCode: '69007',
      city: 'Lyon',
      country: 'France',
    });
    const place = await getPlaceById(db, id);
    expect(place).toMatchObject({
      street: 'Avenue Berthelot',
      houseNumber: '85',
      postalCode: '69007',
      city: 'Lyon',
      country: 'France',
    });
  });

  it('defaults structured fields to null when absent on create', async () => {
    const id = await createUserPlace(db, {
      name: 'Maison', category: 'home', latitude: 45.75, longitude: 4.85, radiusM: 100,
    });
    const place = await getPlaceById(db, id);
    expect(place).toMatchObject({
      street: null,
      houseNumber: null,
      postalCode: null,
      city: null,
      country: null,
    });
  });

  it('updates structured address fields on an existing user place', async () => {
    const id = await createUserPlace(db, {
      name: 'Maison', category: 'home', latitude: 45.75, longitude: 4.85, radiusM: 100,
    });
    await updateUserPlace(db, id, {
      name: 'Maison',
      category: 'home',
      latitude: 45.75,
      longitude: 4.85,
      radiusM: 100,
      displayName: '12 Rue de la Paix, Paris',
      street: 'Rue de la Paix',
      houseNumber: '12',
      postalCode: '75002',
      city: 'Paris',
      country: 'France',
    });
    const place = await getPlaceById(db, id);
    expect(place).toMatchObject({
      street: 'Rue de la Paix',
      houseNumber: '12',
      postalCode: '75002',
      city: 'Paris',
      country: 'France',
    });
  });

  it('clears structured fields to null on update when absent', async () => {
    const id = await createUserPlace(db, {
      name: 'Maison', category: 'home', latitude: 45.75, longitude: 4.85, radiusM: 100,
      street: 'Old street', houseNumber: '1', postalCode: '00000', city: 'Old', country: 'Old',
    });
    await updateUserPlace(db, id, {
      name: 'Maison', category: 'home', latitude: 45.75, longitude: 4.85, radiusM: 100,
    });
    const place = await getPlaceById(db, id);
    expect(place).toMatchObject({
      street: null,
      houseNumber: null,
      postalCode: null,
      city: null,
      country: null,
    });
  });
});
