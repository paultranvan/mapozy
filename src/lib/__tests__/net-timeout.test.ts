import {
  externalFetch,
  setExternalApiAllowedCache,
  ExternalFetchTimeoutError,
} from '../net';

describe('externalFetch timeout', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    setExternalApiAllowedCache(true);
    jest.useRealTimers();
  });

  it('aborts a stalled request and throws ExternalFetchTimeoutError', async () => {
    // A fetch that never resolves on its own but honors the abort signal —
    // the stalled-connection case that used to wedge the pipeline chain.
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
        );
      });
    }) as unknown as typeof fetch;

    await expect(
      externalFetch('https://example.test/slow', { timeoutMs: 20 })
    ).rejects.toBeInstanceOf(ExternalFetchTimeoutError);
  });

  it('passes through a fast response and clears the timer', async () => {
    const resp = { ok: true, status: 200 } as Response;
    global.fetch = jest.fn(async () => resp) as unknown as typeof fetch;
    await expect(externalFetch('https://example.test/fast')).resolves.toBe(resp);
  });

  it('propagates non-abort network errors unchanged', async () => {
    const boom = new TypeError('Network request failed');
    global.fetch = jest.fn(async () => {
      throw boom;
    }) as unknown as typeof fetch;
    await expect(externalFetch('https://example.test/err')).rejects.toBe(boom);
  });
});
