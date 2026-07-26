import type { StructuredAddress } from '../../db/places';
import type { TiimeAddress, TiimeTravelPayload } from './types';

export function toTiimeAddress(addr: StructuredAddress): TiimeAddress {
  const street = [addr.houseNumber, addr.street].filter(Boolean).join(' ');
  return {
    street,
    postal_code: addr.postalCode ?? '',
    city: addr.city ?? '',
    country: addr.country ?? '',
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatTiimeDate(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function metersToKm(m: number): number {
  return Math.round(m / 1000);
}

export interface BuildTravelInput {
  startMs: number;
  distanceM: number;
  departure: StructuredAddress;
  arrival: StructuredAddress;
  arrivalCompanyName: string | null;
  vehicleId: number;
  roundTrip: boolean;
}

export function buildTravelPayload(input: BuildTravelInput): TiimeTravelPayload {
  return {
    date: formatTiimeDate(input.startMs),
    distance: metersToKm(input.distanceM),
    departure_address: toTiimeAddress(input.departure),
    arrival_address: toTiimeAddress(input.arrival),
    arrival_company_name: input.arrivalCompanyName,
    vehicle_id: input.vehicleId,
    round_trip: input.roundTrip,
  };
}
