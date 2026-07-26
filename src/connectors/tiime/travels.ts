import type { Db } from '../../db/client';
import type { StructuredAddress } from '../../db/places';
import { getSentTripIds, recordSentTravel } from '../../db/connectorTravels';
import { buildTravelPayload } from './mappers';
import type { TiimeClient } from './client';
import type { TiimeTravelResponse } from './types';

export interface TiimeCandidate {
  tripId: number;
  startMs: number;
  distanceM: number;
  departurePlaceId: number | null;
  arrivalPlaceId: number | null;
  arrivalPlaceName: string | null;
}

interface CandidateRow {
  id: number;
  start_time_ms: number;
  distance_m: number;
  start_place_id: number | null;
  end_place_id: number | null;
  arrival_place_name: string | null;
}

export async function listCandidates(db: Db): Promise<TiimeCandidate[]> {
  const rows = await db.getAllAsync<CandidateRow>(
    `SELECT t.id, t.start_time_ms, t.distance_m, t.start_place_id, t.end_place_id,
            ep.name AS arrival_place_name
       FROM trips t
       LEFT JOIN places sp ON sp.id = t.start_place_id
       LEFT JOIN places ep ON ep.id = t.end_place_id
      WHERE t.dominant_mode = 'car'
        AND (sp.category = 'work' OR ep.category = 'work')
      ORDER BY t.start_time_ms DESC`
  );
  const sent = await getSentTripIds(db, 'tiime');
  return rows
    .filter((r) => !sent.has(r.id))
    .map((r) => ({
      tripId: r.id,
      startMs: r.start_time_ms,
      distanceM: r.distance_m,
      departurePlaceId: r.start_place_id,
      arrivalPlaceId: r.end_place_id,
      arrivalPlaceName: r.arrival_place_name,
    }));
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
  await recordSentTravel(db, 'tiime', candidate.tripId, String(res.id), Date.now());
  return res.id;
}
