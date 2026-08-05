import type { TiimeClient } from './client';
import type { TiimeOwner } from './types';

export interface TiimeCompany {
  id: number;
  name: string;
}

export interface TiimeVehicle {
  id: number;
  name: string;
}

interface UserMeResponse {
  active_company: number;
}

interface CompanyResponse {
  id: number;
  name: string;
}

interface VehiclesResponse {
  vehicles: { id: number; name: string; archived_at: string | null }[];
}

// v1: single company, auto-derived. Tiime exposes no companies-list endpoint;
// /v1/users/me carries the active company id, /v1/companies/{id} carries its name.
export async function fetchDefaultCompany(client: TiimeClient): Promise<TiimeCompany> {
  const me = await client.get<UserMeResponse>('/v1/users/me');
  const company = await client.get<CompanyResponse>(`/v1/companies/${me.active_company}`);
  return { id: company.id, name: company.name };
}

/** The same /v1/users/me call, kept whole: an expense report's `owner` block is
 *  this response verbatim (id, firstname, lastname, phone, email,
 *  active_company, roles). */
export async function fetchOwner(client: TiimeClient): Promise<TiimeOwner> {
  return client.get<TiimeOwner>('/v1/users/me');
}

// Verified endpoint; the vendor media type is REQUIRED to get the v2 shape.
export async function fetchVehicles(
  client: TiimeClient,
  companyId: number
): Promise<TiimeVehicle[]> {
  const res = await client.get<VehiclesResponse>(
    `/v1/companies/${companyId}/users/me/vehicles`,
    { accept: 'application/vnd.tiime.vehicles.v2+json' }
  );
  return res.vehicles
    .filter((v) => v.archived_at === null)
    .map((v) => ({ id: v.id, name: v.name.trim() }));
}
