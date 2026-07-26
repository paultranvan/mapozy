import { createTiimeClient, TiimeAuthError } from '../client';

jest.mock('../auth', () => {
  let stored: string | null = null;
  return {
    __setStored: (t: string | null) => { stored = t; },
    getStoredToken: jest.fn(async () => stored),
    storeToken: jest.fn(async (t: string) => { stored = t; }),
    // Treat the literal 'EXPIRED' token as expired, anything else as valid.
    isTokenExpired: (t: string) => t === 'EXPIRED',
  };
});

const auth = jest.requireMock('../auth');

describe('TiimeClient', () => {
  beforeEach(() => { jest.restoreAllMocks(); auth.__setStored('GOOD'); });

  it('GETs with a bearer token and returns parsed json', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      status: 200, ok: true, json: async () => ({ hello: 'world' }),
    } as any);
    const client = createTiimeClient({ refresh: async () => 'GOOD' });
    const res = await client.get<{ hello: string }>('/v1/x');
    expect(res).toEqual({ hello: 'world' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as any).headers.authorization).toBe('Bearer GOOD');
    expect((init as any).headers['tiime-app']).toBe('tiime');
  });

  it('refreshes once on 401 and retries', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({ status: 401, ok: false, json: async () => ({}) } as any)
      .mockResolvedValueOnce({ status: 201, ok: true, json: async () => ({ id: 1 }) } as any);
    const refresh = jest.fn(async () => 'FRESH');
    const client = createTiimeClient({ refresh });
    const res = await client.post<{ id: number }>('/v1/x', { a: 1 });
    expect(res).toEqual({ id: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws TiimeAuthError when refresh yields no token', async () => {
    auth.__setStored('EXPIRED');
    const client = createTiimeClient({ refresh: async () => null });
    let caughtError: unknown;
    try {
      await client.get('/v1/x');
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).toBeInstanceOf(TiimeAuthError);
  });
});
