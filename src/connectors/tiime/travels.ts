import type { Db } from '../../db/client';
import type { StructuredAddress } from '../../db/places';
import { getUserPlaces } from '../../db/places';
import { getSentSignatures, recordSentTravel } from '../../db/connectorTravels';
import { nearestUserPoi } from '../../lib/poiResolve';
import { ensurePlaceAddress, reverseGeocodeStructured } from '../../pipeline/geocoding';
import { buildTravelPayload } from './mappers';
import type { TiimeClient } from './client';
import type { TiimeTravelResponse } from './types';

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
    typeof v[0] === 'number' &&
    typeof v[1] === 'number'
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

export interface SendOptions {
  vehicleId: number;
  companyId: number;
  roundTrip: boolean;
  arrivalCompanyName: string | null;
  departure: StructuredAddress;
  arrival: StructuredAddress;
}

export async function sendCandidate(
  db: Db,
  client: TiimeClient,
  candidate: TiimeCandidate,
  opts: SendOptions
): Promise<number> {
  const payload = buildTravelPayload({
    startMs: candidate.startMs,
    distanceM: candidate.distanceM,
    departure: opts.departure,
    arrival: opts.arrival,
    arrivalCompanyName: opts.arrivalCompanyName,
    vehicleId: opts.vehicleId,
    roundTrip: opts.roundTrip,
  });
  const res = await client.post<TiimeTravelResponse>(
    `/v1/companies/${opts.companyId}/users/me/travels`,
    payload
  );
  const signature = travelSignature({
    startMs: candidate.startMs,
    distanceM: candidate.distanceM,
    departure: candidate.departure,
    arrival: candidate.arrival,
  });
  await recordSentTravel(db, 'tiime', signature, String(res.id), Date.now(), candidate.tripId);
  return res.id;
}
