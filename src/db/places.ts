import type { Db } from './client';
import type { Place } from '../types';
import { haversineMeters } from '../lib/distance';

const MATCH_RADIUS_M = 100;
const LAT_DEG_M = 111_320;

interface Row {
  id: number;
  latitude: number;
  longitude: number;
  radius_m: number;
  display_name: string | null;
  label: string | null;
  visit_count: number;
  first_seen_ms: number;
  last_seen_ms: number;
}

function rowToPlace(r: Row): Place {
  return {
    id: r.id,
    latitude: r.latitude,
    longitude: r.longitude,
    radiusM: r.radius_m,
    displayName: r.display_name,
    label: r.label === 'home' || r.label === 'work' ? r.label : null,
    visitCount: r.visit_count,
    firstSeenMs: r.first_seen_ms,
    lastSeenMs: r.last_seen_ms,
  };
}

export async function findOrCreatePlace(
  db: Db,
  lat: number,
  lon: number,
  timestampMs: number
): Promise<number> {
  const latDelta = MATCH_RADIUS_M / LAT_DEG_M;
  const lonDelta = MATCH_RADIUS_M / (LAT_DEG_M * Math.cos((lat * Math.PI) / 180));
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM places
     WHERE latitude BETWEEN ? AND ?
       AND longitude BETWEEN ? AND ?`,
    lat - latDelta,
    lat + latDelta,
    lon - lonDelta,
    lon + lonDelta
  );
  for (const r of rows) {
    const d = haversineMeters(lat, lon, r.latitude, r.longitude);
    if (d <= MATCH_RADIUS_M) {
      await db.runAsync(
        `UPDATE places SET visit_count = visit_count + 1, last_seen_ms = ? WHERE id = ?`,
        timestampMs,
        r.id
      );
      return r.id;
    }
  }
  const res = await db.runAsync(
    `INSERT INTO places (latitude, longitude, radius_m, visit_count, first_seen_ms, last_seen_ms)
     VALUES (?, ?, 50, 1, ?, ?)`,
    lat,
    lon,
    timestampMs,
    timestampMs
  );
  return res.lastInsertRowId;
}

export async function getPlaceById(db: Db, id: number): Promise<Place | null> {
  const r = await db.getFirstAsync<Row>(`SELECT * FROM places WHERE id = ?`, id);
  return r ? rowToPlace(r) : null;
}

export async function getAllPlaces(db: Db): Promise<Place[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM places ORDER BY visit_count DESC`
  );
  return rows.map(rowToPlace);
}

export async function setPlaceDisplayName(
  db: Db,
  id: number,
  displayName: string
): Promise<void> {
  await db.runAsync(`UPDATE places SET display_name = ? WHERE id = ?`, displayName, id);
}

export async function setPlaceLabel(
  db: Db,
  id: number,
  label: 'home' | 'work' | null
): Promise<void> {
  await db.runAsync(`UPDATE places SET label = ? WHERE id = ?`, label, id);
}
