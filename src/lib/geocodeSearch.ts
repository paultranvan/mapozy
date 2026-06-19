import { externalApiAllowed } from './net';
import { nominatimFetch } from './nominatim';

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

  try {
    const resp = await nominatimFetch(`/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5`);
    if (!resp.ok) return [];
    const rows = (await resp.json()) as NominatimSearchRow[];
    return rows
      .filter((r) => r.display_name && r.lat && r.lon)
      .map((r) => ({ label: r.display_name!, lat: parseFloat(r.lat!), lon: parseFloat(r.lon!) }));
  } catch {
    return [];
  }
}
