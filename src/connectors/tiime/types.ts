export interface TiimeAddress {
  street: string;
  postal_code: string;
  city: string;
  country: string;
}

export interface TiimeTravelPayload {
  // Tiime 500s (generic "Une erreur est survenue") if id/locked/comment/tags
  // are absent — verified against the live API. estimated_amount and the full
  // vehicle object are NOT required (the server computes the amount).
  id: null;
  locked: null;
  comment: string;
  tags: never[];
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

// ---------------------------------------------------------------------------
// Mileage expense reports ("notes de frais kilométriques")
//
// These endpoints live under a DIFFERENT path prefix than travel creation:
// /v1/accounts/companies/... vs /v1/companies/.... Same host and auth.
//
// They also speak two different conventions — compute_travels_amount is
// camelCase, expense_reports is snake_case — and the difference is NOT a
// naming transform: fields appear and disappear between the two (see
// `toExpenseReportTravel`). Note in particular that a person's name is
// `firstName` in camel payloads but `firstname` (all lowercase) in snake ones,
// which a generic converter would turn into `first_name` and silently break.
// ---------------------------------------------------------------------------

export interface TiimePersonRefSnake {
  id: number;
  firstname: string;
  lastname: string;
}

export interface TiimePersonRefCamel {
  id: number;
  firstName: string;
  lastName: string;
}

/** GET /v1/users/me — passed through verbatim as the expense report's `owner`. */
export interface TiimeOwner extends TiimePersonRefSnake {
  phone: string | null;
  email: string;
  active_company: number;
  roles: string[];
}

/** A vehicle as returned by GET expense_report_vehicles. Carries two fields the
 *  expense-report payload does not want (external_already_paid_amount,
 *  external_previous_distance) and omits `archived_at` — hence the projection
 *  in `toComputeVehicle` rather than a passthrough. */
export interface TiimeExpenseReportVehicleRaw {
  id: number;
  name: string;
  created_at: string;
  is_mileage_updatable: boolean;
  owner: TiimePersonRefSnake;
}

export interface TiimeExpenseReportVehiclesResponse {
  vehicles: TiimeExpenseReportVehicleRaw[];
}

export interface TiimeComputeVehicle {
  id: number;
  createdAt: string;
  owner: TiimePersonRefCamel;
  name: string;
  archivedAt: string | null;
  isMileageUpdatable: boolean;
}

export interface TiimeComputeAddress {
  street: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface TiimeComputeTravel {
  id: number;
  date: string; // 'YYYY-MM-DD HH:mm:ss'
  locked: boolean;
  distance: number;
  /** Server-computed. We send 0 and read the response value back: the French
   *  mileage scale is cumulative over the tax year, so it cannot be derived
   *  client-side, and no listing endpoint exposes it. */
  estimatedAmount: number;
  comment: string;
  vehicle: TiimeComputeVehicle;
  tags: never[];
  vehicleOwner: TiimePersonRefCamel;
  departureAddress: TiimeComputeAddress;
  arrivalCompanyName: string | null;
  arrivalAddress: TiimeComputeAddress;
  roundTrip: boolean;
  isUsedByExpenseReport: boolean;
}

export interface TiimeComputeRequest {
  travels: TiimeComputeTravel[];
  // Snake-cased even in this camelCase payload — Tiime's own inconsistency.
  expense_report_id: number | null;
}

/** Per-vehicle breakdown. `compensation_rate` is a display string with a French
 *  decimal comma and a euro sign ("0,636€") — never parse it, the amount is
 *  already computed. */
export interface TiimeComputeVehicleResponse {
  vehicle_id: number;
  is_electric: boolean;
  travels_distance: number;
  sub_total_distance: number;
  distance: number;
  compensation_rate: string;
  compensation_rate_legend: string;
  already_paid: number;
  external_already_paid: number;
  total: number;
}

/**
 * The response is an AGGREGATE, not an echo of the travels: `amount` is the
 * total for everything in the request, broken down per vehicle. The request is
 * camelCase but this response is snake_case — one more place where the two
 * conventions meet.
 *
 * Because Mapozy creates one expense report per travel, each compute call
 * carries exactly one travel, so `amount` IS that travel's amount and there is
 * no aggregate to split. Sending several travels at once would break that
 * equivalence.
 */
export interface TiimeComputeResponse {
  amount: number;
  compute_vehicle_responses: TiimeComputeVehicleResponse[];
}

export interface TiimeExpenseReportVehicle {
  id: number;
  created_at: string;
  owner: TiimePersonRefSnake;
  owner_id: number;
  name: string;
  archived_at: string | null;
  is_mileage_updatable: boolean;
}

export interface TiimeExpenseReportTravel {
  id: number;
  date: string;
  locked: boolean;
  distance: number;
  estimated_amount: number;
  comment: string;
  vehicle: TiimeExpenseReportVehicle;
  vehicle_id: number;
  tags: never[];
  departure_address: TiimeAddress;
  arrival_company_name: string | null;
  arrival_address: TiimeAddress;
  round_trip: boolean;
  is_used_by_expense_report: boolean;
}

export interface TiimeExpenseReportPayload {
  id: null;
  name: string;
  date: string; // 'YYYY-MM-DD'
  owner: TiimeOwner;
  advanced_expenses: never[];
  comment: string;
  tags: never[];
  payment_status: null;
  expense_type: 'travel';
  travels: TiimeExpenseReportTravel[];
  lifecycle_status: 'saved';
}

export interface TiimeExpenseReportResponse {
  id: number;
}
