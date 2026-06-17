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
 * Drop-in replacement for `fetch` that every external service must use. Throws
 * `ExternalApiDisabledError` when the toggle is off — callers that treat that as
 * "offline" degrade gracefully (Overpass drafts, geocoding returns null,
 * Valhalla keeps the raw trace).
 */
export function externalFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (!allowed) return Promise.reject(new ExternalApiDisabledError());
  return fetch(input, init);
}
