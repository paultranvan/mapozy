export interface TiimeAddress {
  street: string;
  postal_code: string;
  city: string;
  country: string;
}

export interface TiimeTravelPayload {
  date: string; // 'YYYY-MM-DD HH:mm:ss'
  distance: number; // whole km
  departure_address: TiimeAddress;
  arrival_address: TiimeAddress;
  arrival_company_name: string | null;
  vehicle_id: number;
  round_trip: boolean;
}

// The create/list endpoints return much more; we only rely on the id.
export interface TiimeTravelResponse {
  id: number;
}
