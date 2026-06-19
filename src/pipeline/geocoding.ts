import type { Db } from '../db/client';
import { getPlaceById, setPlaceDisplayName } from '../db/places';
import { externalApiAllowed } from '../lib/net';
import { nominatimFetch } from '../lib/nominatim';

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

export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  if (!externalApiAllowed()) return null;
  try {
    const resp = await nominatimFetch(`/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18&addressdetails=1`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as NominatimResponse;
    return formatDisplayName(data);
  } catch {
    return null;
  }
}

export async function geocodePlaceLazy(db: Db, placeId: number): Promise<string | null> {
  const p = await getPlaceById(db, placeId);
  if (!p) return null;
  if (p.displayName) return p.displayName;
  // External API disabled: skip the network call, caller falls back to coords.
  if (!externalApiAllowed()) return null;

  const name = await reverseGeocode(p.latitude, p.longitude);
  if (name) await setPlaceDisplayName(db, placeId, name);
  return name;
}

export function fallbackPlaceLabel(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}
