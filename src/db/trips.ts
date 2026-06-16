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
  draft: number;
  draft_reason: string | null;
  edited: number;
  locked: number;
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
    draft: r.draft === 1,
    draftReason: (r.draft_reason as Trip['draftReason']) ?? null,
    edited: r.edited === 1,
    locked: r.locked === 1,
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
          distance_m, duration_s, dominant_mode, co2_g, geojson, manual_purpose,
          draft, draft_reason, edited, locked, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      trip.draft ? 1 : 0,
      trip.draftReason,
      trip.edited ? 1 : 0,
      trip.locked ? 1 : 0,
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

const SQLITE_MAX_VARIABLES = 900;

export async function deleteTrips(db: Db, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < ids.length; i += SQLITE_MAX_VARIABLES) {
      const chunk = ids.slice(i, i + SQLITE_MAX_VARIABLES);
      const placeholders = chunk.map(() => '?').join(',');
      await db.runAsync(`DELETE FROM trips WHERE id IN (${placeholders})`, ...chunk);
    }
  });
}

export async function getTripsByIds(db: Db, ids: number[]): Promise<Trip[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM trips WHERE id IN (${placeholders}) ORDER BY start_time_ms ASC`,
    ...ids
  );
  return rows.map(rowToTrip);
}

// Half-open span [startMs, endMs): a trip overlaps when it starts before endMs
// and ends after startMs.
export async function getTripsOverlapping(
  db: Db,
  startMs: number,
  endMs: number
): Promise<Trip[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM trips
     WHERE start_time_ms < ? AND end_time_ms > ?
     ORDER BY start_time_ms ASC`,
    endMs,
    startMs
  );
  return rows.map(rowToTrip);
}

export async function getLockedTripsOverlapping(
  db: Db,
  startMs: number,
  endMs: number
): Promise<Trip[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM trips
     WHERE locked = 1 AND start_time_ms < ? AND end_time_ms > ?
     ORDER BY start_time_ms ASC`,
    endMs,
    startMs
  );
  return rows.map(rowToTrip);
}

export async function getTripBefore(db: Db, ms: number): Promise<Trip | null> {
  const row = await db.getFirstAsync<Row>(
    `SELECT * FROM trips WHERE start_time_ms < ? ORDER BY start_time_ms DESC LIMIT 1`,
    ms
  );
  return row ? rowToTrip(row) : null;
}

export async function getTripAfter(db: Db, ms: number): Promise<Trip | null> {
  const row = await db.getFirstAsync<Row>(
    `SELECT * FROM trips WHERE start_time_ms >= ? ORDER BY start_time_ms ASC LIMIT 1`,
    ms
  );
  return row ? rowToTrip(row) : null;
}

// The trip whose [start,end] span contains `ms`. Used after a reset/recompute
// (which deletes and re-creates trips with fresh ids) to re-locate the trip the
// user was looking at and keep them on its page.
export async function getTripContainingTime(
  db: Db,
  ms: number
): Promise<Trip | null> {
  const row = await db.getFirstAsync<Row>(
    `SELECT * FROM trips WHERE start_time_ms <= ? AND end_time_ms >= ?
     ORDER BY start_time_ms DESC LIMIT 1`,
    ms,
    ms
  );
  return row ? rowToTrip(row) : null;
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

// Like getTripsInRange but hydrates each trip's sections (rowToTrip leaves them
// empty — only getTripById fills them). The day map and its trip rows need the
// per-section geometry + modes, so load them here.
export async function getTripsInRangeWithSections(
  db: Db,
  startMs: number,
  endMs: number
): Promise<Trip[]> {
  const trips = await getTripsInRange(db, startMs, endMs);
  for (const t of trips) {
    if (t.id != null) t.sections = await getSectionsForTrip(db, t.id);
  }
  return trips;
}

export async function setTripDraft(
  db: Db,
  tripId: number,
  draft: boolean,
  reason: Trip['draftReason']
): Promise<void> {
  await db.runAsync(
    `UPDATE trips SET draft = ?, draft_reason = ? WHERE id = ?`,
    draft ? 1 : 0,
    reason,
    tripId
  );
}

export async function updateTripAggregates(
  db: Db,
  tripId: number,
  dominantMode: string,
  co2G: number
): Promise<void> {
  await db.runAsync(
    `UPDATE trips SET dominant_mode = ?, co2_g = ? WHERE id = ?`,
    dominantMode,
    co2G,
    tripId
  );
}

export async function setTripEditFlags(
  db: Db,
  tripId: number,
  edited: boolean,
  locked: boolean
): Promise<void> {
  await db.runAsync(
    `UPDATE trips SET edited = ?, locked = ? WHERE id = ?`,
    edited ? 1 : 0,
    locked ? 1 : 0,
    tripId
  );
}

export async function replaceTripSectionsAndBreaks(
  db: Db,
  tripId: number,
  sections: Trip['sections'],
  breaks: Trip['breaks']
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM sections WHERE trip_id = ?`, tripId);
    await db.runAsync(`DELETE FROM trip_breaks WHERE trip_id = ?`, tripId);
    for (const s of sections) await insertSection(db, tripId, s);
    for (const b of breaks) await insertBreak(db, tripId, b);
  });
}

export async function listDraftTripIds(db: Db): Promise<number[]> {
  const rows = await db.getAllAsync<{ id: number }>(
    `SELECT id FROM trips WHERE draft = 1 AND locked = 0 ORDER BY start_time_ms DESC`
  );
  return rows.map((r) => r.id);
}

export async function updateTripTimes(
  db: Db,
  tripId: number,
  startTimeMs: number,
  endTimeMs: number,
  endPlaceId: number | null
): Promise<void> {
  await db.runAsync(
    `UPDATE trips SET start_time_ms = ?, end_time_ms = ?, end_place_id = ? WHERE id = ?`,
    startTimeMs,
    endTimeMs,
    endPlaceId,
    tripId
  );
}

export async function updateTripTotals(
  db: Db,
  tripId: number,
  distanceM: number,
  co2G: number,
  dominantMode: string,
  geojson: string
): Promise<void> {
  await db.runAsync(
    `UPDATE trips SET distance_m = ?, co2_g = ?, dominant_mode = ?, geojson = ? WHERE id = ?`,
    distanceM,
    co2G,
    dominantMode,
    geojson,
    tripId
  );
}
