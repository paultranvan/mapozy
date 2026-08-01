import { createTiimeClient, TiimeAuthError, TiimeApiError } from '../client';

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

  // The refresher reads the Tiime SPA's localStorage, which still holds the
  // very token we are replacing until Auth0 writes the renewed one. Accepting
  // it produced an unbreakable 401 loop: refresh -> stale token -> 401 ->
  // refresh -> same stale token.
  it('treats a refresh that returns an expired token as a failed refresh', async () => {
    auth.__setStored('EXPIRED');
    // Stubbed (not passed through) so a regression fails on the assertion
    // below instead of reaching the network.
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      status: 401, ok: false, json: async () => ({}),
    } as any);
    const client = createTiimeClient({ refresh: async () => 'EXPIRED' });
    let caught: unknown;
    try {
      await client.get('/v1/x');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TiimeAuthError);
    // Never fired a request we already knew would 401.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry forever when the refreshed token is also rejected', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any)
      .mockResolvedValue({ status: 401, ok: false, json: async () => ({}) } as any);
    const refresh = jest.fn(async () => 'FRESH');
    const client = createTiimeClient({ refresh });
    let caught: unknown;
    try {
      await client.post('/v1/x', { a: 1 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TiimeAuthError);
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

  it('throws TiimeApiError carrying the status and response body on non-OK', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      status: 500,
      ok: false,
      text: async () => '{"message":"boom"}',
    } as any);
    const client = createTiimeClient({ refresh: async () => 'GOOD' });
    let caught: unknown;
    try {
      await client.post('/v1/x', { a: 1 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TiimeApiError);
    expect((caught as TiimeApiError).status).toBe(500);
    expect((caught as TiimeApiError).body).toBe('{"message":"boom"}');
  });

  it('sends a custom accept header when provided', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      status: 200, ok: true, json: async () => ({ vehicles: [] }),
    } as any);
    const client = createTiimeClient({ refresh: async () => 'GOOD' });
    await client.get('/v1/x', { accept: 'application/vnd.tiime.vehicles.v2+json' });
    const call = fetchMock.mock.calls[0]!;
    const init = call[1] as any;
    expect(init.headers.accept).toBe('application/vnd.tiime.vehicles.v2+json');
  });
});
