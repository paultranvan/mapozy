import type { Db } from './client';
import type { Place } from '../types';
import { PLACE_CATEGORY_VALUES } from '../types';
import { haversineMeters } from '../lib/distance';

const MATCH_RADIUS_M = 100;
const LAT_DEG_M = 111_320;

interface Row {
  id: number;
  kind: string;
  name: string | null;
  category: string | null;
  latitude: number;
  longitude: number;
  radius_m: number;
  display_name: string | null;
  visit_count: number;
  first_seen_ms: number;
  last_seen_ms: number;
}

const CATEGORIES = new Set<string>(PLACE_CATEGORY_VALUES);

// Cap the auto-place scan for the "frequent stop" picker; 200 busiest is plenty.
const CLUSTER_SCAN_LIMIT = 200;

function rowToPlace(r: Row): Place {
  return {
    id: r.id,
    kind: r.kind === 'user' ? 'user' : 'auto',
    name: r.name,
    category: r.category && CATEGORIES.has(r.category) ? (r.category as Place['category']) : null,
    latitude: r.latitude,
    longitude: r.longitude,
    radiusM: r.radius_m,
    displayName: r.display_name,
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
     WHERE kind = 'auto'
       AND latitude BETWEEN ? AND ?
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
    `INSERT INTO places (kind, latitude, longitude, radius_m, visit_count, first_seen_ms, last_seen_ms)
     VALUES ('auto', ?, ?, 50, 1, ?, ?)`,
    lat,
    lon,
    timestampMs,
    timestampMs
  );
  return res.lastInsertRowId;
}

export async function insertPlaceAt(
  db: Db,
  lat: number,
  lon: number,
  timestampMs: number
): Promise<number> {
  const res = await db.runAsync(
    `INSERT INTO places (kind, latitude, longitude, radius_m, visit_count, first_seen_ms, last_seen_ms)
     VALUES ('auto', ?, ?, 50, 1, ?, ?)`,
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

export interface UserPlaceInput {
  name: string;
  category: Place['category'];
  latitude: number;
  longitude: number;
  radiusM: number;
  displayName?: string | null;
}

export async function createUserPlace(db: Db, input: UserPlaceInput): Promise<number> {
  const now = Date.now();
  const res = await db.runAsync(
    `INSERT INTO places (kind, name, category, latitude, longitude, radius_m, display_name, visit_count, first_seen_ms, last_seen_ms)
     VALUES ('user', ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    input.name, input.category, input.latitude, input.longitude, input.radiusM, input.displayName ?? null, now, now
  );
  return res.lastInsertRowId;
}

export async function updateUserPlace(db: Db, id: number, input: UserPlaceInput): Promise<void> {
  await db.runAsync(
    `UPDATE places SET name = ?, category = ?, latitude = ?, longitude = ?, radius_m = ?, display_name = ?
     WHERE id = ? AND kind = 'user'`,
    input.name, input.category, input.latitude, input.longitude, input.radiusM, input.displayName ?? null, id
  );
}

export async function deleteUserPlace(db: Db, id: number): Promise<void> {
  await db.runAsync(`DELETE FROM places WHERE id = ? AND kind = 'user'`, id);
}

export async function getUserPlaces(db: Db): Promise<Place[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM places WHERE kind = 'user' ORDER BY name COLLATE NOCASE`
  );
  return rows.map(rowToPlace);
}

export async function getAutoPlaces(db: Db, limit: number): Promise<Place[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM places WHERE kind = 'auto' ORDER BY visit_count DESC LIMIT ?`,
    limit
  );
  return rows.map(rowToPlace);
}

// Auto-places whose center lies within `radiusM` of the given coordinates, used
// for both visit counts and "is this cluster already owned by a POI".
async function autoPlacesInRadius(db: Db, lat: number, lon: number, radiusM: number): Promise<Place[]> {
  const latDelta = radiusM / LAT_DEG_M;
  const lonDelta = radiusM / (LAT_DEG_M * Math.cos((lat * Math.PI) / 180));
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM places WHERE kind = 'auto'
       AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`,
    lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta
  );
  return rows
    .map(rowToPlace)
    .filter((p) => haversineMeters(lat, lon, p.latitude, p.longitude) <= radiusM);
}

export async function getUserPoiVisitStats(
  db: Db, poi: Place
): Promise<{ visitCount: number; lastSeenMs: number }> {
  const owned = await autoPlacesInRadius(db, poi.latitude, poi.longitude, poi.radiusM);
  return {
    visitCount: owned.reduce((s, p) => s + p.visitCount, 0),
    lastSeenMs: owned.reduce((m, p) => Math.max(m, p.lastSeenMs), 0),
  };
}

// Frequent stops not yet inside any user POI — proposed in the editor's
// "from a frequent stop" picker. Busiest first.
export async function getUnnamedClusters(db: Db, limit: number): Promise<Place[]> {
  const autos = (await db.getAllAsync<Row>(
    `SELECT * FROM places WHERE kind = 'auto' ORDER BY visit_count DESC LIMIT ${CLUSTER_SCAN_LIMIT}`
  )).map(rowToPlace);
  const users = await getUserPlaces(db);
  const free = autos.filter(
    (a) => !users.some((u) => haversineMeters(a.latitude, a.longitude, u.latitude, u.longitude) <= u.radiusM)
  );
  return free.slice(0, limit);
}
