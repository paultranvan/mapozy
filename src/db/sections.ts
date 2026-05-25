import type { Db } from './client';
import type { Section, Mode } from '../types';

interface Row {
  id: number;
  trip_id: number;
  ordering: number;
  start_time_ms: number;
  end_time_ms: number;
  mode: string;
  distance_m: number;
  duration_s: number;
  avg_speed_mps: number;
  max_speed_mps: number;
  co2_g: number;
  geojson: string;
}

function rowToSection(r: Row): Section {
  return {
    id: r.id,
    tripId: r.trip_id,
    ordering: r.ordering,
    startTimeMs: r.start_time_ms,
    endTimeMs: r.end_time_ms,
    mode: r.mode as Mode,
    distanceM: r.distance_m,
    durationS: r.duration_s,
    avgSpeedMps: r.avg_speed_mps,
    maxSpeedMps: r.max_speed_mps,
    co2G: r.co2_g,
    geojson: r.geojson,
  };
}

export async function insertSection(db: Db, tripId: number, s: Section): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO sections
       (trip_id, ordering, start_time_ms, end_time_ms, mode, distance_m, duration_s,
        avg_speed_mps, max_speed_mps, co2_g, geojson)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    tripId,
    s.ordering,
    s.startTimeMs,
    s.endTimeMs,
    s.mode,
    s.distanceM,
    s.durationS,
    s.avgSpeedMps,
    s.maxSpeedMps,
    s.co2G,
    s.geojson
  );
  return r.lastInsertRowId;
}

export async function getSectionsForTrip(db: Db, tripId: number): Promise<Section[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM sections WHERE trip_id = ? ORDER BY ordering ASC`,
    tripId
  );
  return rows.map(rowToSection);
}
