import { reverseGeocode } from '../geocoding';
import * as net from '../../lib/net';

jest.mock('../../lib/net', () => ({
  externalApiAllowed: jest.fn(),
  externalFetch: jest.fn(),
}));

const mockNet = net as jest.Mocked<typeof net>;

describe('reverseGeocode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when external calls are disabled', async () => {
    mockNet.externalApiAllowed.mockReturnValue(false);
    expect(await reverseGeocode(45.75, 4.85)).toBeNull();
    expect(mockNet.externalFetch).not.toHaveBeenCalled();
  });

  it('formats street + city from a Nominatim reverse response', async () => {
    mockNet.externalApiAllowed.mockReturnValue(true);
    mockNet.externalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ address: { house_number: '85', road: 'Avenue Berthelot', city: 'Lyon' } }),
    } as any);
    expect(await reverseGeocode(45.75, 4.85)).toBe('85 Avenue Berthelot, Lyon');
  });

  it('falls back to the quarter when the nearest way is unnamed (tester: "Boulogne-Billancourt")', async () => {
    // Real payload shape seen at 48.82574,2.23407: an unnamed pedestrian way →
    // no road/pedestrian/footway key, only quarter/suburb/city. The label must
    // not collapse to just the city.
    mockNet.externalApiAllowed.mockReturnValue(true);
    mockNet.externalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        address: {
          quarter: 'Billancourt - Rives de Seine',
          suburb: 'Rives de Seine',
          city: 'Boulogne-Billancourt',
          municipality: 'Boulogne-Billancourt',
        },
      }),
    } as any);
    expect(await reverseGeocode(48.8257, 2.2341)).toBe(
      'Billancourt - Rives de Seine, Boulogne-Billancourt'
    );
  });

  it('prefers a POI name over the street when present', async () => {
    mockNet.externalApiAllowed.mockReturnValue(true);
    mockNet.externalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        address: { amenity: 'Pathé Parnasse', road: "Rue d'Odessa", city: 'Paris' },
      }),
    } as any);
    expect(await reverseGeocode(48.84, 2.32)).toBe("Pathé Parnasse, Rue d'Odessa, Paris");
  });

  it('uses wider street types (path, square) before falling back to the area', async () => {
    mockNet.externalApiAllowed.mockReturnValue(true);
    mockNet.externalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        address: { square: 'Place de la Bourse', city: 'Bruxelles' },
      }),
    } as any);
    expect(await reverseGeocode(50.84, 4.35)).toBe('Place de la Bourse, Bruxelles');
  });

  it('returns null on a non-ok response', async () => {
    mockNet.externalApiAllowed.mockReturnValue(true);
    mockNet.externalFetch.mockResolvedValue({ ok: false } as any);
    expect(await reverseGeocode(45.75, 4.85)).toBeNull();
  });
});
