import { buildTravelPayload, toTiimeAddress, formatTiimeDate, metersToKm } from '../mappers';

const addr = {
  street: 'Rue Pierre Poli',
  houseNumber: '37',
  postalCode: '92130',
  city: 'Issy-les-Moulineaux',
  country: 'France',
};

describe('tiime mappers', () => {
  it('joins house number + street into the Tiime street field', () => {
    expect(toTiimeAddress(addr)).toEqual({
      street: '37 Rue Pierre Poli',
      postal_code: '92130',
      city: 'Issy-les-Moulineaux',
      country: 'France',
    });
  });

  it('rounds metres to whole km', () => {
    expect(metersToKm(32450)).toBe(32);
    expect(metersToKm(32500)).toBe(33);
  });

  it('formats a timestamp as YYYY-MM-DD HH:mm:ss', () => {
    // 2026-07-26 10:05:18 local
    const ms = new Date(2026, 6, 26, 10, 5, 18).getTime();
    expect(formatTiimeDate(ms)).toBe('2026-07-26 10:05:18');
  });

  it('builds a full payload without estimated_amount', () => {
    const ms = new Date(2026, 6, 26, 10, 5, 18).getTime();
    const payload = buildTravelPayload({
      startMs: ms,
      distanceM: 32000,
      departure: { street: '9 Voie Wagner', houseNumber: null, postalCode: '94400', city: 'Vitry-sur-Seine', country: 'FR' },
      arrival: addr,
      arrivalCompanyName: 'LINAGORA',
      vehicleId: 58697,
      roundTrip: false,
    });
    expect(payload).toEqual({
      date: '2026-07-26 10:05:18',
      distance: 32,
      departure_address: { street: '9 Voie Wagner', postal_code: '94400', city: 'Vitry-sur-Seine', country: 'FR' },
      arrival_address: { street: '37 Rue Pierre Poli', postal_code: '92130', city: 'Issy-les-Moulineaux', country: 'France' },
      arrival_company_name: 'LINAGORA',
      vehicle_id: 58697,
      round_trip: false,
    });
    expect('estimated_amount' in payload).toBe(false);
  });
});
