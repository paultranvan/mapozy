import type { Db } from '../db/client';
import { getSetting, setSetting, SETTING_KEYS } from '../db/settings';

// Single choke-point for ALL outbound HTTP. Every external service (Overpass,
// Nominatim, Valhalla) routes through `externalFetch`, so the user's "Allow
// external API" toggle is enforced in exactly one place and nothing can leak.
//
// The flag is held in a module-level cache so call sites can consult it
// synchronously (the source of truth is the SQLite `settings` table). External
// calls are ALLOWED by default. Load the persisted value once at startup via
// `loadExternalApiSetting`, and keep it in sync from the settings screen via
// `setExternalApiAllowed`.

let allowed = true;

/** Thrown by `externalFetch` when the user has disabled external API calls. */
export class ExternalApiDisabledError extends Error {
  constructor() {
    super('External API calls are disabled by the user');
    this.name = 'ExternalApiDisabledError';
  }
}

/** Synchronous read of the cached flag — safe to call from any code path. */
export function externalApiAllowed(): boolean {
  return allowed;
}

/** Update the in-memory cache (call after persisting the setting). */
export function setExternalApiAllowedCache(value: boolean): void {
  allowed = value;
}

/**
 * Load the persisted setting into the cache. Call once after migrations.
 * Defaults to allowed when the setting was never written.
 */
export async function loadExternalApiSetting(db: Db): Promise<void> {
  const v = await getSetting(db, SETTING_KEYS.ALLOW_EXTERNAL_API);
  allowed = v === null ? true : v === '1';
}

/** Persist the setting AND update the cache in one step (for the UI). */
export async function setExternalApiAllowed(
  db: Db,
  value: boolean
): Promise<void> {
  await setSetting(db, SETTING_KEYS.ALLOW_EXTERNAL_API, value ? '1' : '0');
  allowed = value;
}

/**
 * Thrown when an external request exceeds EXTERNAL_FETCH_TIMEOUT_MS. Callers
 * already treat any fetch rejection as "offline"/best-effort, so this mostly
 * matters for logs — but the class makes timeouts distinguishable there.
 */
export class ExternalFetchTimeoutError extends Error {
  constructor(ms: number) {
    super(`External request timed out after ${ms} ms`);
    this.name = 'ExternalFetchTimeoutError';
  }
}

// Public Overpass instances legitimately take 30-60 s on heavy rail-geometry
// queries (their server-side [timeout:] is 60 s), so the client bound sits just
// above that. What it exists to kill is the *stalled* connection: React
// Native's fetch has no read timeout, and one hung request used to wedge the
// serialized pipeline chain forever (tester: "Calcul en cours…" for hours,
// Force pipeline queued behind it doing nothing).
export const EXTERNAL_FETCH_TIMEOUT_MS = 75_000;

/**
 * Drop-in replacement for `fetch` that every external service must use. Throws
 * `ExternalApiDisabledError` when the toggle is off — callers that treat that as
 * "offline" degrade gracefully (Overpass drafts, geocoding returns null,
 * Valhalla keeps the raw trace). Every request carries a hard timeout so no
 * stalled connection can hang a caller indefinitely.
 */
export async function externalFetch(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  if (!allowed) throw new ExternalApiDisabledError();
  const timeoutMs = init?.timeoutMs ?? EXTERNAL_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new ExternalFetchTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
