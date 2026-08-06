import type { Db } from '../../db/client';
import type { StructuredAddress } from '../../db/places';
import { getUserPlaces } from '../../db/places';
import {
  getSentSignatures,
  markExpenseReportDone,
  markExpenseReportFailed,
  recordSentTravel,
  type FailedExpenseReport,
} from '../../db/connectorTravels';
import { insertDiagnosticEvent } from '../../db/diagnostics';
import { nearestUserPoi } from '../../lib/poiResolve';
import { ensurePlaceAddress, reverseGeocodeStructured } from '../../pipeline/geocoding';
import { buildTravelPayload } from './mappers';
import { TiimeApiError, type TiimeClient } from './client';
import {
  buildComputeTravelDto,
  buildExpenseReportPayload,
  createExpenseReport,
  extractComputedAmount,
  postComputeTravelsAmount,
  toExpenseReportTravel,
} from './expenseReports';
import type {
  TiimeComputeTravel,
  TiimeExpenseReportTravel,
  TiimeExpenseReportVehicleRaw,
  TiimeOwner,
  TiimeTravelResponse,
} from './types';

/** Diagnostic event type for a Tiime travel send (success or failure). Logged
 *  to tracker_diagnostics so it exports with "Send data to Paul". */
const TIIME_SEND_EVENT = 'tiime_send';

/** Same rationale as TIIME_SEND_EVENT, for the expense-report leg. */
const TIIME_EXPENSE_REPORT_EVENT = 'tiime_expense_report';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local YYYY-MM-DD, distinct from `formatTiimeDate` (which includes time):
 *  the signature only needs day granularity, so trips recomputed with a
 *  slightly shifted start time (same day) still collapse to one signature. */
function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface Coord {
  lat: number;
  lon: number;
}

/** Content signature used to dedup sends independent of the (volatile)
 *  Mapozy trip id: a recompute deletes+recreates trips with new ids, but a
 *  trip's endpoint coordinates (from its geojson) don't move, so keying on
 *  day + distance + rounded endpoint coords survives it. Coordinates (NOT
 *  place ids) are used because the trip's start/end place FK columns
 *  reference auto-clustered places that are frequently evicted/dangling and
 *  don't carry the user's place categorisation — see module doc below. */
export function travelSignature(input: {
  startMs: number;
  distanceM: number;
  departure: Coord;
  arrival: Coord;
}): string {
  return (
    `${localDay(input.startMs)}|${Math.round(input.distanceM / 1000)}` +
    `|${input.departure.lat.toFixed(4)},${input.departure.lon.toFixed(4)}` +
    `|${input.arrival.lat.toFixed(4)},${input.arrival.lon.toFixed(4)}`
  );
}

export interface TiimeCandidate {
  tripId: number;
  startMs: number;
  distanceM: number;
  departure: Coord;
  arrival: Coord;
  // Name of the user place at the ARRIVAL endpoint (work place, or any user
  // place there), else null. Prefills Tiime's arrival_company_name.
  arrivalCompanyName: string | null;
}

interface TripRow {
  id: number;
  start_time_ms: number;
  distance_m: number;
  geojson: string;
}

interface GeojsonLike {
  coordinates?: unknown;
  geometry?: { coordinates?: unknown };
}

function isLonLat(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

/** Extract a trip's departure/arrival coordinates from its `geojson` column.
 *  The FK place coords (start_place_id/end_place_id) are unreliable/dangling
 *  (see module doc), so endpoints are always read from the trip's own trace.
 *  Handles a bare LineString, a Feature wrapping one, or any object exposing
 *  `.geometry.coordinates`. Returns null if geojson is missing, unparseable,
 *  or has no coordinates — such a trip is skipped, not a candidate. */
function extractEndpoints(geojson: string | null | undefined): { departure: Coord; arrival: Coord } | null {
  if (!geojson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const g = parsed as GeojsonLike;
  const coords = Array.isArray(g.coordinates) ? g.coordinates : g.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!isLonLat(first) || !isLonLat(last)) return null;
  return {
    departure: { lat: first[1], lon: first[0] },
    arrival: { lat: last[1], lon: last[0] },
  };
}

/**
 * Candidate car trips for export to Tiime. A trip qualifies when either
 * endpoint falls within a work-tagged user place's zone — determined by
 * geographic proximity (`nearestUserPoi`), NOT the trip's start/end place FK
 * columns. Those FKs reference auto-clustered places which are frequently
 * evicted/merged and never carry the user's place category, so joining on
 * them silently drops real work trips. Purely offline: no network calls.
 */
export async function listCandidates(db: Db): Promise<TiimeCandidate[]> {
  const userPlaces = await getUserPlaces(db);
  const workPlaces = userPlaces.filter((p) => p.category === 'work');
  if (workPlaces.length === 0) return [];

  const rows = await db.getAllAsync<TripRow>(
    `SELECT id, start_time_ms, distance_m, geojson FROM trips
      WHERE dominant_mode = 'car'
      ORDER BY start_time_ms DESC`
  );

  const sent = await getSentSignatures(db, 'tiime');
  const out: TiimeCandidate[] = [];
  for (const r of rows) {
    const endpoints = extractEndpoints(r.geojson);
    if (!endpoints) continue;
    const { departure, arrival } = endpoints;
    const touchesWork =
      nearestUserPoi(departure.lat, departure.lon, workPlaces) != null ||
      nearestUserPoi(arrival.lat, arrival.lon, workPlaces) != null;
    if (!touchesWork) continue;

    const signature = travelSignature({ startMs: r.start_time_ms, distanceM: r.distance_m, departure, arrival });
    if (sent.has(signature)) continue;

    const arrivalPoi = nearestUserPoi(arrival.lat, arrival.lon, userPlaces);
    out.push({
      tripId: r.id,
      startMs: r.start_time_ms,
      distanceM: r.distance_m,
      departure,
      arrival,
      arrivalCompanyName: arrivalPoi?.name ?? null,
    });
  }
  return out;
}

const EMPTY_ADDRESS: StructuredAddress = {
  street: null,
  houseNumber: null,
  postalCode: null,
  city: null,
  country: null,
};

/** Resolve structured addresses for a candidate's endpoints (network I/O —
 *  only called at prefill/send time, never from `listCandidates`). For each
 *  endpoint: if a user place sits there, reuse/geocode its stored address;
 *  otherwise reverse-geocode the raw coordinate. Falls back to an empty
 *  address when neither yields a result. */
export async function resolveTravelAddresses(
  db: Db,
  candidate: TiimeCandidate
): Promise<{ departure: StructuredAddress; arrival: StructuredAddress }> {
  const userPlaces = await getUserPlaces(db);

  const resolveOne = async (coord: Coord): Promise<StructuredAddress> => {
    const poi = nearestUserPoi(coord.lat, coord.lon, userPlaces);
    const addr = poi
      ? await ensurePlaceAddress(db, poi.id)
      : await reverseGeocodeStructured(coord.lat, coord.lon);
    return addr ?? EMPTY_ADDRESS;
  };

  const [departure, arrival] = await Promise.all([
    resolveOne(candidate.departure),
    resolveOne(candidate.arrival),
  ]);
  return { departure, arrival };
}

/** Everything the expense-report leg needs that the travel leg does not. Both
 *  values are per-account, not per-trip, so they are fetched once per batch. */
export interface ExpenseReportContext {
  owner: TiimeOwner;
  vehicle: TiimeExpenseReportVehicleRaw;
}

export interface SendOptions {
  vehicleId: number;
  companyId: number;
  roundTrip: boolean;
  arrivalCompanyName: string | null;
  departure: StructuredAddress;
  arrival: StructuredAddress;
  /** Omit to create the travel only — exactly the calls made before expense
   *  reports existed. */
  expenseReport?: ExpenseReportContext;
}

export interface SendResult {
  travelId: number;
  expenseReportId: number | null;
  /** Set when the travel was created but its report was not. This is NOT a
   *  failed send: the travel exists in Tiime and is deduped. */
  expenseReportError: string | null;
}

function describeError(e: unknown): string {
  if (e instanceof TiimeApiError) return `${e.message} — ${e.body}`;
  return e instanceof Error ? e.message : String(e);
}

export async function sendCandidate(
  db: Db,
  client: TiimeClient,
  candidate: TiimeCandidate,
  opts: SendOptions
): Promise<SendResult> {
  const payload = buildTravelPayload({
    startMs: candidate.startMs,
    distanceM: candidate.distanceM,
    departure: opts.departure,
    arrival: opts.arrival,
    arrivalCompanyName: opts.arrivalCompanyName,
    vehicleId: opts.vehicleId,
    roundTrip: opts.roundTrip,
  });
  const path = `/v1/companies/${opts.companyId}/users/me/travels`;
  const signature = travelSignature({
    startMs: candidate.startMs,
    distanceM: candidate.distanceM,
    departure: candidate.departure,
    arrival: candidate.arrival,
  });

  let travelId: number;
  try {
    const res = await client.post<TiimeTravelResponse>(path, payload);
    travelId = res.id;
    // Full send record (success + failure) lands in tracker_diagnostics, which
    // ships with the "Send data to Paul" export — so a failed send is
    // diagnosable after the fact (payload + status + Tiime's response body).
    await insertDiagnosticEvent(db, Date.now(), TIIME_SEND_EVENT, {
      ok: true,
      tripId: candidate.tripId,
      path,
      status: 201,
      travelId,
      payload,
    });
  } catch (e) {
    await insertDiagnosticEvent(db, Date.now(), TIIME_SEND_EVENT, {
      ok: false,
      tripId: candidate.tripId,
      path,
      status: e instanceof TiimeApiError ? e.status : null,
      body: e instanceof TiimeApiError ? e.body : null,
      error: e instanceof Error ? e.message : String(e),
      payload,
    });
    throw e;
  }

  // Dedup BEFORE the expense report. The travel exists in Tiime now; if
  // anything below fails, re-sending it would create a duplicate.
  await recordSentTravel(db, 'tiime', signature, String(travelId), Date.now(), candidate.tripId);

  if (!opts.expenseReport) {
    return { travelId, expenseReportId: null, expenseReportError: null };
  }

  // A report failure leaves the travel in place and is reported, not thrown:
  // the send succeeded, and the retry section is what resolves the rest.
  let computedTravel: TiimeExpenseReportTravel | null = null;
  try {
    const dto = buildComputeTravelDto({
      travelId,
      travel: payload,
      vehicle: opts.expenseReport.vehicle,
    });
    const amount = await computeAmountWithDiagnostics(db, client, {
      companyId: opts.companyId,
      dto,
      tripId: candidate.tripId,
    });
    computedTravel = toExpenseReportTravel(dto, amount);
    const reportId = await postExpenseReport(db, client, {
      companyId: opts.companyId,
      owner: opts.expenseReport.owner,
      travel: computedTravel,
      tripId: candidate.tripId,
    });
    await markExpenseReportDone(db, 'tiime', signature, String(reportId));
    return { travelId, expenseReportId: reportId, expenseReportError: null };
  } catch (e) {
    const message = describeError(e);
    await markExpenseReportFailed(db, 'tiime', signature, message, computedTravel);
    return { travelId, expenseReportId: null, expenseReportError: message };
  }
}

/**
 * The amount computation plus its diagnostic. Logs the response VERBATIM,
 * success or failure: this step's shape was assumed rather than captured on
 * the first attempt, and the resulting failure logged nothing at all — which
 * made it undiagnosable from an export.
 */
async function computeAmountWithDiagnostics(
  db: Db,
  client: TiimeClient,
  args: { companyId: number; dto: TiimeComputeTravel; tripId: number | null }
): Promise<number> {
  let raw: unknown;
  try {
    raw = await postComputeTravelsAmount(client, args.companyId, args.dto);
  } catch (e) {
    await insertDiagnosticEvent(db, Date.now(), TIIME_EXPENSE_REPORT_EVENT, {
      ok: false,
      step: 'compute',
      tripId: args.tripId,
      travelId: args.dto.id,
      status: e instanceof TiimeApiError ? e.status : null,
      body: e instanceof TiimeApiError ? e.body : null,
      error: e instanceof Error ? e.message : String(e),
      request: args.dto,
    });
    throw e;
  }

  const amount = extractComputedAmount(raw);
  if (amount === null) {
    await insertDiagnosticEvent(db, Date.now(), TIIME_EXPENSE_REPORT_EVENT, {
      ok: false,
      step: 'compute',
      tripId: args.tripId,
      travelId: args.dto.id,
      error: 'no amount in response',
      // The whole point of this event: whatever Tiime actually replied.
      response: raw,
      request: args.dto,
    });
    throw new Error('Tiime compute_travels_amount returned no amount');
  }

  // Logged on success too: an amount that parses but is wrong (0, or computed
  // against the wrong vehicle) is a silent failure the user would only ever
  // notice inside Tiime.
  await insertDiagnosticEvent(db, Date.now(), TIIME_EXPENSE_REPORT_EVENT, {
    ok: true,
    step: 'compute',
    tripId: args.tripId,
    travelId: args.dto.id,
    estimatedAmount: amount,
    response: raw,
  });
  return amount;
}

/** The final POST plus its diagnostic. Shared by the send path and the retry
 *  path so both log the same event with the same payload. */
async function postExpenseReport(
  db: Db,
  client: TiimeClient,
  args: {
    companyId: number;
    owner: TiimeOwner;
    travel: TiimeExpenseReportTravel;
    tripId: number | null;
  }
): Promise<number> {
  const payload = buildExpenseReportPayload({ travel: args.travel, owner: args.owner });
  try {
    const res = await createExpenseReport(client, args.companyId, payload);
    await insertDiagnosticEvent(db, Date.now(), TIIME_EXPENSE_REPORT_EVENT, {
      ok: true,
      step: 'create',
      tripId: args.tripId,
      travelId: args.travel.id,
      expenseReportId: res.id,
      estimatedAmount: args.travel.estimated_amount,
      payload,
    });
    return res.id;
  } catch (e) {
    await insertDiagnosticEvent(db, Date.now(), TIIME_EXPENSE_REPORT_EVENT, {
      ok: false,
      step: 'create',
      tripId: args.tripId,
      travelId: args.travel.id,
      status: e instanceof TiimeApiError ? e.status : null,
      body: e instanceof TiimeApiError ? e.body : null,
      error: e instanceof Error ? e.message : String(e),
      payload,
    });
    throw e;
  }
}

/** Replay a failed expense report from the stored, already-computed travel —
 *  one call, no travel recreation and no second amount computation (which
 *  could come back different and silently change what is claimed). */
export async function retryExpenseReport(
  db: Db,
  client: TiimeClient,
  row: FailedExpenseReport,
  opts: { companyId: number; owner: TiimeOwner }
): Promise<number> {
  if (!row.travel) {
    throw new Error('This travel has no computed body stored; send it again from Tiime.');
  }
  try {
    const reportId = await postExpenseReport(db, client, {
      companyId: opts.companyId,
      owner: opts.owner,
      travel: row.travel,
      tripId: null,
    });
    await markExpenseReportDone(db, 'tiime', row.signature, String(reportId));
    return reportId;
  } catch (e) {
    await markExpenseReportFailed(db, 'tiime', row.signature, describeError(e), row.travel);
    throw e;
  }
}
