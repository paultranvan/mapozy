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

/** A non-OK Tiime API response. Carries the HTTP status and the raw response
 *  body — the body is where Tiime puts the actual failure reason, so callers
 *  (and the diagnostics log) can surface it instead of a bare status code. */
export class TiimeApiError extends Error {
  status: number;
  body: string;
  constructor(method: string, path: string, status: number, body: string) {
    super(`Tiime API ${method} ${path} failed: ${status}`);
    this.name = 'TiimeApiError';
    this.status = status;
    this.body = body;
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

  /** Run the silent refresh and accept its result only if it is actually
   *  usable. The refresher reads the Tiime SPA's localStorage, which still
   *  holds the very token we are trying to replace until Auth0 writes the
   *  renewed one — so a refresh CAN hand back an expired token. Storing and
   *  using it guarantees a 401 the caller can do nothing about, so treat it
   *  as a failed refresh: TiimeAuthError means "the session is dead, ask the
   *  user to sign in again", which is actionable. */
  async function refreshedToken(): Promise<string> {
    const fresh = await opts.refresh();
    if (!fresh || isTokenExpired(fresh, Date.now())) throw new TiimeAuthError();
    await storeToken(fresh);
    return fresh;
  }

  async function validToken(): Promise<string> {
    const token = await getStoredToken();
    // Pre-flight: never send a request with a token we already know is
    // expired — that request can only 401. Renew first, or fail fast.
    if (token && !isTokenExpired(token, Date.now())) return token;
    return refreshedToken();
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
      // Server-side rejection of a token we believed valid (revoked, clock
      // skew, password change). One renewal attempt, then give up with
      // TiimeAuthError rather than replaying the same doomed request.
      token = await refreshedToken();
      resp = await doFetch(token);
      if (resp.status === 401) throw new TiimeAuthError();
    }
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new TiimeApiError(method, path, resp.status, errBody);
    }
    return (await resp.json()) as T;
  }

  return {
    get: <T>(path: string, opts?: { accept?: string }) =>
      request<T>('GET', path, undefined, opts?.accept),
    post: <T>(path: string, b: unknown) => request<T>('POST', path, b),
  };
}
