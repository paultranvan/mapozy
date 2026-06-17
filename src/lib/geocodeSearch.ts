import { externalApiAllowed, externalFetch } from './net';

const SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'mapozy/0.1.0 (personal use)';
const MIN_INTERVAL_MS = 1100;

let lastFetchMs = 0;

export interface AddressHit {
  label: string;
  lat: number;
  lon: number;
}

interface NominatimSearchRow {
  display_name?: string;
  lat?: string;
  lon?: string;
}

export async function searchAddress(query: string): Promise<AddressHit[]> {
  const q = query.trim();
  if (!q) return [];
  if (!externalApiAllowed()) return [];

  const wait = lastFetchMs + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchMs = Date.now();

  const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5`;
  try {
    const resp = await externalFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!resp.ok) return [];
    const rows = (await resp.json()) as NominatimSearchRow[];
    return rows
      .filter((r) => r.display_name && r.lat && r.lon)
      .map((r) => ({ label: r.display_name!, lat: parseFloat(r.lat!), lon: parseFloat(r.lon!) }));
  } catch {
    return [];
  }
}
