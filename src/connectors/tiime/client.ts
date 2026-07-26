import { getStoredToken, storeToken, isTokenExpired } from './auth';

const DEFAULT_BASE = 'https://chronos-api.tiime-apps.com';

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  accept: 'application/json, text/plain, */*',
  'tiime-app': 'tiime',
  'tiime-app-version': '4.36.3',
  'tiime-app-platform': 'web',
};

export type RefreshFn = () => Promise<string | null>;

export class TiimeAuthError extends Error {
  constructor(message = 'Tiime authentication required') {
    super(message);
    this.name = 'TiimeAuthError';
  }
}

export interface TiimeClient {
  get<T>(path: string, opts?: { accept?: string }): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export function createTiimeClient(opts: {
  refresh: RefreshFn;
  baseUrl?: string;
}): TiimeClient {
  const base = opts.baseUrl ?? DEFAULT_BASE;

  async function validToken(): Promise<string> {
    let token = await getStoredToken();
    if (!token || isTokenExpired(token, Date.now())) {
      token = await opts.refresh();
      if (token) await storeToken(token);
    }
    if (!token) throw new TiimeAuthError();
    return token;
  }

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    accept?: string
  ): Promise<T> {
    let token = await validToken();
    const doFetch = (t: string) =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          ...BASE_HEADERS,
          ...(accept ? { accept } : {}),
          authorization: `Bearer ${t}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    let resp = await doFetch(token);
    if (resp.status === 401) {
      const fresh = await opts.refresh();
      if (!fresh) throw new TiimeAuthError();
      await storeToken(fresh);
      token = fresh;
      resp = await doFetch(token);
    }
    if (!resp.ok) {
      throw new Error(`Tiime API ${method} ${path} failed: ${resp.status}`);
    }
    return (await resp.json()) as T;
  }

  return {
    get: <T>(path: string, opts?: { accept?: string }) =>
      request<T>('GET', path, undefined, opts?.accept),
    post: <T>(path: string, b: unknown) => request<T>('POST', path, b),
  };
}
