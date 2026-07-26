import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { findOrCreatePlace, getPlaceById } from '../../db/places';
import { ensurePlaceAddress } from '../geocoding';
import { setExternalApiAllowedCache } from '../../lib/net';

jest.mock('../../lib/nominatim', () => ({
  nominatimFetch: jest.fn(async () => ({
    ok: true,
    json: async () => ({
      display_name: '37 Rue Pierre Poli, Issy-les-Moulineaux',
      address: {
        house_number: '37',
        road: 'Rue Pierre Poli',
        postcode: '92130',
        city: 'Issy-les-Moulineaux',
        country: 'France',
      },
    }),
  })),
}));

describe('ensurePlaceAddress', () => {
  beforeEach(() => setExternalApiAllowedCache(true));

  it('re-geocodes and persists structured components on the place', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const placeId = await findOrCreatePlace(db, 48.82, 2.27, 1_700_000_000_000);

    const addr = await ensurePlaceAddress(db, placeId);
    expect(addr).toEqual({
      street: 'Rue Pierre Poli',
      houseNumber: '37',
      postalCode: '92130',
      city: 'Issy-les-Moulineaux',
      country: 'France',
    });

    const place = await getPlaceById(db, placeId);
    expect(place?.postalCode).toBe('92130');
    expect(place?.city).toBe('Issy-les-Moulineaux');
  });
});
