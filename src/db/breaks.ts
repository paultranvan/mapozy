import type { Db } from './client';
import type { TripBreak } from '../types';

interface Row {
  id: number;
  trip_id: number;
  ordering: number;
  start_time_ms: number;
  end_time_ms: number;
  center_lat: number;
  center_lon: number;
}

function rowToBreak(r: Row): TripBreak {
  return {
    id: r.id,
    tripId: r.trip_id,
    ordering: r.ordering,
    startTimeMs: r.start_time_ms,
    endTimeMs: r.end_time_ms,
    centerLat: r.center_lat,
    centerLon: r.center_lon,
  };
}

export async function insertBreak(
  db: Db,
  tripId: number,
  b: TripBreak
): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO trip_breaks
       (trip_id, ordering, start_time_ms, end_time_ms, center_lat, center_lon)
     VALUES (?, ?, ?, ?, ?, ?)`,
    tripId,
    b.ordering,
    b.startTimeMs,
    b.endTimeMs,
    b.centerLat,
    b.centerLon
  );
  return r.lastInsertRowId;
}

export async function getBreaksForTrip(
  db: Db,
  tripId: number
): Promise<TripBreak[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM trip_breaks WHERE trip_id = ? ORDER BY ordering ASC`,
    tripId
  );
  return rows.map(rowToBreak);
}
