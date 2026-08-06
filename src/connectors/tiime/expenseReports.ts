import type { TiimeClient } from './client';
import type {
  TiimeAddress,
  TiimeComputeAddress,
  TiimeComputeResponse,
  TiimeComputeTravel,
  TiimeComputeVehicle,
  TiimeExpenseReportPayload,
  TiimeExpenseReportResponse,
  TiimeExpenseReportTravel,
  TiimeExpenseReportVehicle,
  TiimeExpenseReportVehicleRaw,
  TiimeExpenseReportVehiclesResponse,
  TiimeOwner,
  TiimePersonRefCamel,
  TiimePersonRefSnake,
  TiimeTravelPayload,
} from './types';

/**
 * Mileage expense reports. A travel created via `/v1/companies/.../travels` is
 * not claimable on its own — it must be attached to a "note de frais
 * kilométrique". Three endpoints, all under the /v1/accounts/companies prefix,
 * all captured from live traffic (Tiime web 4.37.2):
 *
 *   1. GET  expense_report_vehicles     -> the vehicle object the payloads need
 *   2. POST compute_travels_amount      -> the amount (server-computed)
 *   3. POST users/me/expense_reports    -> the report itself
 *
 * Step 2 is not optional and not a display call: no listing endpoint exposes a
 * travel's amount, and the French mileage scale is cumulative over the tax
 * year, so it cannot be derived client-side.
 */

// The label lives inside Tiime — a French product with its own naming
// convention — so it is deliberately NOT an i18n key: it must read the same
// whatever language the Mapozy UI is in.
const REPORT_NAME_PREFIX = 'Note de frais kilométrique du ';

function toCamelPerson(p: TiimePersonRefSnake): TiimePersonRefCamel {
  return { id: p.id, firstName: p.firstname, lastName: p.lastname };
}

function toSnakePerson(p: TiimePersonRefCamel): TiimePersonRefSnake {
  return { id: p.id, firstname: p.firstName, lastname: p.lastName };
}

function toComputeAddress(a: TiimeAddress): TiimeComputeAddress {
  return { street: a.street, postalCode: a.postal_code, city: a.city, country: a.country };
}

function toSnakeAddress(a: TiimeComputeAddress): TiimeAddress {
  return { street: a.street, postal_code: a.postalCode, city: a.city, country: a.country };
}

/** expense_report_vehicles gives a vehicle with two fields the payloads never
 *  carry (external_already_paid_amount / external_previous_distance) and
 *  without `archived_at` — a vehicle offered for an expense report is active by
 *  definition, so it is emitted as null. */
export function toComputeVehicle(raw: TiimeExpenseReportVehicleRaw): TiimeComputeVehicle {
  return {
    id: raw.id,
    createdAt: raw.created_at,
    owner: toCamelPerson(raw.owner),
    name: raw.name,
    archivedAt: null,
    isMileageUpdatable: raw.is_mileage_updatable,
  };
}

export function toExpenseReportVehicle(v: TiimeComputeVehicle): TiimeExpenseReportVehicle {
  return {
    id: v.id,
    created_at: v.createdAt,
    owner: toSnakePerson(v.owner),
    // Present in the snake payload only, and redundant with owner.id — Tiime
    // sends both, so we do too.
    owner_id: v.owner.id,
    name: v.name,
    archived_at: v.archivedAt,
    is_mileage_updatable: v.isMileageUpdatable,
  };
}

export interface BuildComputeTravelInput {
  /** Id returned by the travel creation call — the only thing that response is
   *  used for. */
  travelId: number;
  /** The payload we just POSTed to create the travel. Reusing it (rather than
   *  the creation response) keeps this independent of fields Tiime may or may
   *  not echo back. */
  travel: TiimeTravelPayload;
  vehicle: TiimeExpenseReportVehicleRaw;
}

export function buildComputeTravelDto(input: BuildComputeTravelInput): TiimeComputeTravel {
  const vehicle = toComputeVehicle(input.vehicle);
  return {
    id: input.travelId,
    date: input.travel.date,
    locked: false,
    distance: input.travel.distance,
    // Sent as 0 on purpose: this is the call that fills it in. The web app
    // sends a non-zero value only because it already computed it once to
    // render the travel picker.
    estimatedAmount: 0,
    comment: input.travel.comment,
    vehicle,
    tags: [],
    vehicleOwner: vehicle.owner,
    departureAddress: toComputeAddress(input.travel.departure_address),
    arrivalCompanyName: input.travel.arrival_company_name,
    arrivalAddress: toComputeAddress(input.travel.arrival_address),
    roundTrip: input.travel.round_trip,
    isUsedByExpenseReport: false,
  };
}

/**
 * camelCase (compute request) -> snake_case (expense report). Written field by
 * field rather than with a generic converter because the two shapes genuinely
 * differ: `vehicleOwner` exists only in camel, `vehicle_id` and
 * `vehicle.owner_id` only in snake, and `firstName` becomes `firstname` (not
 * `first_name`).
 *
 * The source is the DTO we SENT, not something Tiime returned — the compute
 * response carries an amount and nothing else — so the amount is passed in
 * separately rather than read off `c.estimatedAmount` (which is the 0 we sent).
 */
export function toExpenseReportTravel(
  c: TiimeComputeTravel,
  estimatedAmount: number
): TiimeExpenseReportTravel {
  return {
    id: c.id,
    date: c.date,
    locked: c.locked,
    distance: c.distance,
    estimated_amount: estimatedAmount,
    comment: c.comment,
    vehicle: toExpenseReportVehicle(c.vehicle),
    vehicle_id: c.vehicle.id,
    tags: [],
    departure_address: toSnakeAddress(c.departureAddress),
    arrival_company_name: c.arrivalCompanyName,
    arrival_address: toSnakeAddress(c.arrivalAddress),
    round_trip: c.roundTrip,
    is_used_by_expense_report: c.isUsedByExpenseReport,
  };
}

/** 'YYYY-MM-DD HH:mm:ss' -> 'YYYY-MM-DD'. Deliberately string slicing, not
 *  Date parsing: the travel date is already the local wall-clock time Tiime
 *  stores, and round-tripping it through a Date would reintroduce a timezone
 *  shift the rest of the connector has none of. */
function travelDay(travelDate: string): string {
  return travelDate.slice(0, 10);
}

function frenchDay(isoDay: string): string {
  const [y, m, d] = isoDay.split('-');
  return `${d}/${m}/${y}`;
}

export function buildExpenseReportPayload(input: {
  travel: TiimeExpenseReportTravel;
  owner: TiimeOwner;
}): TiimeExpenseReportPayload {
  // Dated by the TRAVEL, not by today: with one report per travel, that is what
  // makes reports distinguishable in Tiime.
  const day = travelDay(input.travel.date);
  return {
    id: null,
    name: `${REPORT_NAME_PREFIX}${frenchDay(day)}`,
    date: day,
    owner: input.owner,
    advanced_expenses: [],
    comment: '',
    tags: [],
    payment_status: null,
    expense_type: 'travel',
    travels: [input.travel],
    lifecycle_status: 'saved',
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The vehicle object required by both payloads. `date=<=today` bounds the
 *  travels Tiime attaches to each vehicle in the response; we only read the
 *  vehicle itself, but the parameter is not optional. */
export async function fetchExpenseReportVehicle(
  client: TiimeClient,
  opts: { companyId: number; ownerId: number; vehicleId: number; nowMs: number }
): Promise<TiimeExpenseReportVehicleRaw> {
  const d = new Date(opts.nowMs);
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const path =
    `/v1/accounts/companies/${opts.companyId}/expense_report_vehicles` +
    // `<` encoded, `=` left literal — byte-identical to the captured request.
    // A stricter encoding is probably fine, but "probably" is not a reason to
    // deviate from traffic we have actually seen work.
    `?owners=${opts.ownerId}&date=%3C=${today}`;
  const res = await client.get<TiimeExpenseReportVehiclesResponse>(path);
  const found = res.vehicles?.find((v) => v.id === opts.vehicleId);
  if (!found) {
    throw new Error(`Tiime vehicle ${opts.vehicleId} is not available for expense reports`);
  }
  return found;
}

/** The raw call, response unparsed. Split out from `computeTravelAmount` so the
 *  caller can log exactly what came back when extraction fails — the shape of
 *  this response is the one thing about the chain we have never captured. */
export async function postComputeTravelsAmount(
  client: TiimeClient,
  companyId: number,
  travel: TiimeComputeTravel
): Promise<unknown> {
  return client.post<unknown>(`/v1/accounts/companies/${companyId}/compute_travels_amount`, {
    travels: [travel],
    expense_report_id: null,
  });
}

/**
 * Read the amount out of a compute response. The response echoes no travel at
 * all — it reports `amount` (total for the request) plus a per-vehicle
 * breakdown — so with one travel per call, `amount` is that travel's amount.
 * Falls back to the single vehicle line when the top-level total is missing.
 * Returns null rather than throwing, so the caller can log the body it could
 * not read.
 */
export function extractComputedAmount(res: unknown): number | null {
  if (typeof res !== 'object' || res === null) return null;
  const r = res as Partial<TiimeComputeResponse>;
  if (typeof r.amount === 'number') return r.amount;
  const lines = r.compute_vehicle_responses;
  if (Array.isArray(lines) && lines.length === 1 && typeof lines[0]?.total === 'number') {
    return lines[0].total;
  }
  return null;
}

export async function computeTravelAmount(
  client: TiimeClient,
  companyId: number,
  travel: TiimeComputeTravel
): Promise<number> {
  const amount = extractComputedAmount(await postComputeTravelsAmount(client, companyId, travel));
  if (amount === null) throw new Error('Tiime compute_travels_amount returned no amount');
  return amount;
}

/** The report's own total, as Tiime computed it — `metadata` entry keyed
 *  `amount`, whose value is `{ value, currency }`. Null when absent or shaped
 *  otherwise; this is for reporting, never for deciding success. */
export function extractReportAmount(res: TiimeExpenseReportResponse): number | null {
  const entry = res.metadata?.find((m) => m.key === 'amount');
  const value = (entry?.value as { value?: unknown } | undefined)?.value;
  return typeof value === 'number' ? value : null;
}

export async function createExpenseReport(
  client: TiimeClient,
  companyId: number,
  payload: TiimeExpenseReportPayload
): Promise<TiimeExpenseReportResponse> {
  const res = await client.post<TiimeExpenseReportResponse>(
    `/v1/accounts/companies/${companyId}/users/me/expense_reports?expand=preview_available`,
    payload
  );
  // Without this check a response shaped differently would sail through: the
  // report would exist in Tiime, the row would record the id "undefined", and
  // the UI would report success. An explicit failure is recoverable — the
  // retry section exists for exactly that — a silent one is not.
  if (typeof res?.id !== 'number') {
    throw new Error('Tiime expense_reports returned no report id');
  }
  return res;
}
