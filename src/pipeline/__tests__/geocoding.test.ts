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

  it('returns null on a non-ok response', async () => {
    mockNet.externalApiAllowed.mockReturnValue(true);
    mockNet.externalFetch.mockResolvedValue({ ok: false } as any);
    expect(await reverseGeocode(45.75, 4.85)).toBeNull();
  });
});
