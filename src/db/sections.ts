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
  mode_source: string | null;
  mode_confidence: number | null;
  user_mode: string | null;
}

function rowToSection(r: Row): Section {
  const s: Section = {
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
  if (r.mode_source != null) s.modeSource = r.mode_source as Section['modeSource'];
  if (r.mode_confidence != null) s.modeConfidence = r.mode_confidence;
  if (r.user_mode != null) s.userMode = r.user_mode as Mode;
  return s;
}

export async function insertSection(db: Db, tripId: number, s: Section): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO sections
       (trip_id, ordering, start_time_ms, end_time_ms, mode, distance_m, duration_s,
        avg_speed_mps, max_speed_mps, co2_g, geojson, mode_source, mode_confidence, user_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    s.geojson,
    s.modeSource ?? null,
    s.modeConfidence ?? null,
    s.userMode ?? null
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

export async function setSectionUserMode(
  db: Db,
  sectionId: number,
  userMode: Mode | null,
  co2G: number
): Promise<void> {
  await db.runAsync(
    `UPDATE sections SET user_mode = ?, mode_source = ?, co2_g = ? WHERE id = ?`,
    userMode,
    userMode ? 'manual' : null,
    co2G,
    sectionId
  );
}

export async function updateSectionClassification(
  db: Db,
  sectionId: number,
  mode: Mode,
  modeSource: Section['modeSource'],
  modeConfidence: number,
  co2G: number
): Promise<void> {
  await db.runAsync(
    `UPDATE sections
       SET mode = ?, mode_source = ?, mode_confidence = ?, co2_g = ?
     WHERE id = ?`,
    mode,
    modeSource ?? null,
    modeConfidence,
    co2G,
    sectionId
  );
}
