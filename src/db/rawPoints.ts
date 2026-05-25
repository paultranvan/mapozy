import type { Db } from './client';
import type { RawPoint } from '../types';

export type RawPointInsert = Omit<RawPoint, 'id' | 'consumed'>;

interface Row {
  id: number;
  timestamp_ms: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy_m: number;
  speed_mps: number | null;
  bearing_deg: number | null;
  battery_level: number | null;
  is_charging: number;
  consumed: number;
}

function rowToPoint(r: Row): RawPoint {
  return {
    id: r.id,
    timestampMs: r.timestamp_ms,
    latitude: r.latitude,
    longitude: r.longitude,
    altitude: r.altitude,
    accuracyMeters: r.accuracy_m,
    speedMps: r.speed_mps,
    bearingDeg: r.bearing_deg,
    batteryLevel: r.battery_level,
    isCharging: r.is_charging !== 0,
    consumed: r.consumed !== 0,
  };
}

export async function insertRawPoint(db: Db, p: RawPointInsert): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO raw_points
      (timestamp_ms, latitude, longitude, altitude, accuracy_m, speed_mps, bearing_deg, battery_level, is_charging, consumed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    p.timestampMs,
    p.latitude,
    p.longitude,
    p.altitude,
    p.accuracyMeters,
    p.speedMps,
    p.bearingDeg,
    p.batteryLevel,
    p.isCharging ? 1 : 0
  );
  return r.lastInsertRowId;
}

export async function getUnconsumedPointsInRange(
  db: Db,
  startMs: number,
  endMs: number
): Promise<RawPoint[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM raw_points
     WHERE consumed=0 AND timestamp_ms BETWEEN ? AND ?
     ORDER BY timestamp_ms ASC`,
    startMs,
    endMs
  );
  return rows.map(rowToPoint);
}

export async function getAllUnconsumedPoints(db: Db): Promise<RawPoint[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM raw_points WHERE consumed=0 ORDER BY timestamp_ms ASC`
  );
  return rows.map(rowToPoint);
}

const SQLITE_MAX_VARIABLES = 900;

export async function markPointsConsumed(db: Db, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  for (let i = 0; i < ids.length; i += SQLITE_MAX_VARIABLES) {
    const chunk = ids.slice(i, i + SQLITE_MAX_VARIABLES);
    const placeholders = chunk.map(() => '?').join(',');
    await db.runAsync(
      `UPDATE raw_points SET consumed=1 WHERE id IN (${placeholders})`,
      ...chunk
    );
  }
}

export async function countUnconsumedPoints(db: Db): Promise<number> {
  const r = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM raw_points WHERE consumed=0`
  );
  return r?.c ?? 0;
}

export async function purgeOldConsumedPoints(db: Db, beforeMs: number): Promise<number> {
  const r = await db.runAsync(
    `DELETE FROM raw_points WHERE consumed=1 AND timestamp_ms < ?`,
    beforeMs
  );
  return r.changes;
}
