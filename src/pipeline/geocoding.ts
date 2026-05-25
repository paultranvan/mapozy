import type { Db } from '../db/client';
import { getPlaceById, setPlaceDisplayName } from '../db/places';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'mapozy/0.1.0 (personal use)';
const MIN_INTERVAL_MS = 1100;

let lastFetchMs = 0;

async function rateLimit(): Promise<void> {
  const wait = lastFetchMs + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchMs = Date.now();
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  city?: string;
  town?: string;
  village?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
  display_name?: string;
}

function formatDisplayName(data: NominatimResponse): string | null {
  if (!data.address) return data.display_name ?? null;
  const a = data.address;
  const housenumber = a.house_number ?? '';
  const street = a.road ?? a.pedestrian ?? a.footway ?? '';
  const city = a.city ?? a.town ?? a.village ?? '';
  const lhs = [housenumber, street].filter(Boolean).join(' ');
  const parts = [lhs, city].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : data.display_name ?? null;
}

export async function geocodePlaceLazy(db: Db, placeId: number): Promise<string | null> {
  const p = await getPlaceById(db, placeId);
  if (!p) return null;
  if (p.displayName) return p.displayName;

  await rateLimit();
  const url = `${NOMINATIM_URL}?lat=${p.latitude}&lon=${p.longitude}&format=json&zoom=18&addressdetails=1`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!resp.ok) return null;
    const data = (await resp.json()) as NominatimResponse;
    const name = formatDisplayName(data);
    if (name) await setPlaceDisplayName(db, placeId, name);
    return name;
  } catch {
    return null;
  }
}

export function fallbackPlaceLabel(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}
