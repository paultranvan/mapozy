import { externalFetch } from './net';

export const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'mapozy/0.1.0 (personal use)';
const MIN_INTERVAL_MS = 1100;

let lastFetchMs = 0;

// Single shared rate gate so reverse + forward geocoding don't both hammer
// Nominatim (policy: max 1 req/s).
export async function nominatimFetch(path: string): Promise<Response> {
  const wait = lastFetchMs + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchMs = Date.now();
  return externalFetch(`${NOMINATIM_BASE}${path}`, { headers: { 'User-Agent': USER_AGENT } });
}
