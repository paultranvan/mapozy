import { externalApiAllowed } from './net';
import { nominatimFetch } from './nominatim';
import { extractStructuredAddress } from '../pipeline/geocoding';
import type { StructuredAddress } from '../db/places';

export interface AddressHit {
  label: string;
  lat: number;
  lon: number;
  structured: StructuredAddress;
}

interface NominatimSearchAddress {
  road?: string;
  house_number?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  country?: string;
}

interface NominatimSearchRow {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: NominatimSearchAddress;
}

export async function searchAddress(query: string): Promise<AddressHit[]> {
  const q = query.trim();
  if (!q) return [];
  if (!externalApiAllowed()) return [];

  try {
    const resp = await nominatimFetch(`/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5`);
    if (!resp.ok) return [];
    const rows = (await resp.json()) as NominatimSearchRow[];
    return rows
      .filter((r) => r.display_name && r.lat && r.lon)
      .map((r) => ({
        label: r.display_name!,
        lat: parseFloat(r.lat!),
        lon: parseFloat(r.lon!),
        structured: extractStructuredAddress({ address: r.address, display_name: r.display_name }),
      }));
  } catch {
    return [];
  }
}
