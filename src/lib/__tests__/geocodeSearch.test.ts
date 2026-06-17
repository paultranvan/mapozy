import { searchAddress } from '../geocodeSearch';
import * as net from '../net';

jest.mock('../net', () => ({
  externalApiAllowed: jest.fn(),
  externalFetch: jest.fn(),
}));

const mockNet = net as jest.Mocked<typeof net>;

describe('searchAddress', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns [] when external calls are disabled', async () => {
    mockNet.externalApiAllowed.mockReturnValue(false);
    expect(await searchAddress('rue de la paix')).toEqual([]);
    expect(mockNet.externalFetch).not.toHaveBeenCalled();
  });

  it('maps Nominatim results to {label, lat, lon}', async () => {
    mockNet.externalApiAllowed.mockReturnValue(true);
    mockNet.externalFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ display_name: '85 Av. Berthelot, Lyon', lat: '45.74', lon: '4.85' }],
    } as any);
    const res = await searchAddress('berthelot');
    expect(res).toEqual([{ label: '85 Av. Berthelot, Lyon', lat: 45.74, lon: 4.85 }]);
  });

  it('returns [] for blank queries without calling the network', async () => {
    mockNet.externalApiAllowed.mockReturnValue(true);
    expect(await searchAddress('   ')).toEqual([]);
    expect(mockNet.externalFetch).not.toHaveBeenCalled();
  });
});
