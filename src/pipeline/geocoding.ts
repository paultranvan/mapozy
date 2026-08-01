import type { Db } from '../db/client';
import { getPlaceById, setPlaceDisplayName, setPlaceStructuredAddress, type StructuredAddress } from '../db/places';
import { externalApiAllowed } from '../lib/net';
import { nominatimFetch } from '../lib/nominatim';

interface NominatimAddress {
  house_number?: string;
  // POI names — the most specific thing a stay can sit on.
  amenity?: string;
  building?: string;
  leisure?: string;
  shop?: string;
  tourism?: string;
  office?: string;
  // Street-like ways.
  road?: string;
  pedestrian?: string;
  footway?: string;
  cycleway?: string;
  path?: string;
  square?: string;
  // Area fallbacks — the nearest way can be unnamed (e.g. a pedestrian path in
  // a redeveloped block), in which case Nominatim only returns these.
  neighbourhood?: string;
  quarter?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
  display_name?: string;
}

function formatDisplayName(data: NominatimResponse): string | null {
  if (!data.address) return data.display_name ?? null;
  const a = data.address;
  const poi = a.amenity ?? a.building ?? a.leisure ?? a.shop ?? a.tourism ?? a.office ?? '';
  const housenumber = a.house_number ?? '';
  const street = a.road ?? a.pedestrian ?? a.footway ?? a.cycleway ?? a.path ?? a.square ?? '';
  // Without a named street, fall back to the neighbourhood so the label stays
  // more specific than the bare city (tester saw just "Boulogne-Billancourt").
  const area = street ? '' : (a.neighbourhood ?? a.quarter ?? a.suburb ?? '');
  const city = a.city ?? a.town ?? a.village ?? '';
  const lhs = [housenumber, street].filter(Boolean).join(' ');
  const parts = [poi, lhs, area, city].filter(Boolean);
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

// A cached label with no comma is a bare locality ("Boulogne-Billancourt") —
// the legacy formatter produced these when the nearest way was unnamed. Worth
// one retry with the wider formatter, which adds POI/quarter fallbacks.
function isBareLocality(label: string): boolean {
  return !label.includes(',');
}

export async function geocodePlaceLazy(db: Db, placeId: number): Promise<string | null> {
  const p = await getPlaceById(db, placeId);
  if (!p) return null;
  if (p.displayName && !isBareLocality(p.displayName)) return p.displayName;
  // External API disabled: skip the network call, caller falls back to coords.
  if (!externalApiAllowed()) return p.displayName ?? null;

  const name = await reverseGeocode(p.latitude, p.longitude);
  if (name && name !== p.displayName) await setPlaceDisplayName(db, placeId, name);
  return name ?? p.displayName ?? null;
}

export function fallbackPlaceLabel(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

export function extractStructuredAddress(data: NominatimResponse): StructuredAddress {
  const a = data.address ?? {};
  const street =
    a.road ?? a.pedestrian ?? a.footway ?? a.cycleway ?? a.path ?? a.square ?? null;
  const city = a.city ?? a.town ?? a.village ?? null;
  return {
    street,
    houseNumber: a.house_number ?? null,
    postalCode: a.postcode ?? null,
    city,
    country: a.country ?? null,
  };
}

export async function reverseGeocodeStructured(
  lat: number,
  lon: number
): Promise<StructuredAddress | null> {
  if (!externalApiAllowed()) return null;
  try {
    const resp = await nominatimFetch(
      `/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18&addressdetails=1`
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as NominatimResponse;
    return extractStructuredAddress(data);
  } catch {
    return null;
  }
}

/** Return the place's structured address, geocoding + persisting it on first
 *  need. Returns null if unavailable (e.g. external API disabled + never seen). */
export async function ensurePlaceAddress(
  db: Db,
  placeId: number
): Promise<StructuredAddress | null> {
  const p = await getPlaceById(db, placeId);
  if (!p) return null;
  const existing: StructuredAddress = {
    street: p.street,
    houseNumber: p.houseNumber,
    postalCode: p.postalCode,
    city: p.city,
    country: p.country,
  };
  if (existing.city || existing.street) return existing;
  const fresh = await reverseGeocodeStructured(p.latitude, p.longitude);
  if (fresh) await setPlaceStructuredAddress(db, placeId, fresh);
  return fresh;
}
