import type { Db } from './client';
import type { Trip, DominantMode } from '../types';
import { insertSection, getSectionsForTrip } from './sections';
import { insertBreak, getBreaksForTrip } from './breaks';

interface Row {
  id: number;
  start_time_ms: number;
  end_time_ms: number;
  start_place_id: number | null;
  end_place_id: number | null;
  distance_m: number;
  duration_s: number;
  dominant_mode: string;
  co2_g: number;
  geojson: string;
  manual_purpose: string | null;
  created_at_ms: number;
}

function rowToTrip(r: Row): Trip {
  return {
    id: r.id,
    startTimeMs: r.start_time_ms,
    endTimeMs: r.end_time_ms,
    startPlaceId: r.start_place_id,
    endPlaceId: r.end_place_id,
    distanceM: r.distance_m,
    durationS: r.duration_s,
    dominantMode: r.dominant_mode as DominantMode,
    co2G: r.co2_g,
    geojson: r.geojson,
    manualPurpose: r.manual_purpose,
    draft: false,
    draftReason: null,
    createdAtMs: r.created_at_ms,
    sections: [],
    breaks: [],
  };
}

export async function insertTripWithSections(db: Db, trip: Trip): Promise<number> {
  let tripId = 0;
  await db.withTransactionAsync(async () => {
    const r = await db.runAsync(
      `INSERT INTO trips
         (start_time_ms, end_time_ms, start_place_id, end_place_id,
          distance_m, duration_s, dominant_mode, co2_g, geojson, manual_purpose, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      trip.startTimeMs,
      trip.endTimeMs,
      trip.startPlaceId,
      trip.endPlaceId,
      trip.distanceM,
      trip.durationS,
      trip.dominantMode,
      trip.co2G,
      trip.geojson,
      trip.manualPurpose,
      trip.createdAtMs
    );
    tripId = r.lastInsertRowId;
    for (const s of trip.sections) {
      await insertSection(db, tripId, s);
    }
    for (const b of trip.breaks) {
      await insertBreak(db, tripId, b);
    }
  });
  return tripId;
}

export async function getTripById(db: Db, id: number): Promise<Trip | null> {
  const row = await db.getFirstAsync<Row>(`SELECT * FROM trips WHERE id = ?`, id);
  if (!row) return null;
  const trip = rowToTrip(row);
  trip.sections = await getSectionsForTrip(db, id);
  trip.breaks = await getBreaksForTrip(db, id);
  return trip;
}

export async function listTrips(
  db: Db,
  limit: number,
  offset: number
): Promise<Trip[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM trips ORDER BY start_time_ms DESC LIMIT ? OFFSET ?`,
    limit,
    offset
  );
  return rows.map(rowToTrip);
}

export async function countTrips(db: Db): Promise<number> {
  const r = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM trips`
  );
  return r?.c ?? 0;
}

export async function deleteTrip(db: Db, id: number): Promise<void> {
  await db.runAsync(`DELETE FROM trips WHERE id = ?`, id);
}

export async function deleteAllTrips(db: Db): Promise<void> {
  await db.runAsync(`DELETE FROM trips`);
}

export async function getTripsInRange(
  db: Db,
  startMs: number,
  endMs: number
): Promise<Trip[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM trips WHERE start_time_ms BETWEEN ? AND ? ORDER BY start_time_ms ASC`,
    startMs,
    endMs
  );
  return rows.map(rowToTrip);
}
