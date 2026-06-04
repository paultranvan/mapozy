import type { Db } from './client';
import type { RawActivity, ActivityType } from '../types';

export type RawActivityInsert = Omit<RawActivity, 'id' | 'consumed'>;

interface Row {
  id: number;
  timestamp_ms: number;
  type: string;
  confidence: number;
  consumed: number;
}

function rowToActivity(r: Row): RawActivity {
  return {
    id: r.id,
    timestampMs: r.timestamp_ms,
    type: r.type as ActivityType,
    confidence: r.confidence,
    consumed: r.consumed !== 0,
  };
}

export async function insertRawActivity(db: Db, a: RawActivityInsert): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO raw_activities (timestamp_ms, type, confidence, consumed)
     VALUES (?, ?, ?, 0)`,
    a.timestampMs,
    a.type,
    a.confidence
  );
  return r.lastInsertRowId;
}

export async function getUnconsumedActivitiesInRange(
  db: Db,
  startMs: number,
  endMs: number
): Promise<RawActivity[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM raw_activities
     WHERE consumed=0 AND timestamp_ms BETWEEN ? AND ?
     ORDER BY timestamp_ms ASC`,
    startMs,
    endMs
  );
  return rows.map(rowToActivity);
}

export async function getAllUnconsumedActivities(db: Db): Promise<RawActivity[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM raw_activities WHERE consumed=0 ORDER BY timestamp_ms ASC`
  );
  return rows.map(rowToActivity);
}

const SQLITE_MAX_VARIABLES = 900;

export async function markActivitiesConsumed(db: Db, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  for (let i = 0; i < ids.length; i += SQLITE_MAX_VARIABLES) {
    const chunk = ids.slice(i, i + SQLITE_MAX_VARIABLES);
    const placeholders = chunk.map(() => '?').join(',');
    await db.runAsync(
      `UPDATE raw_activities SET consumed=1 WHERE id IN (${placeholders})`,
      ...chunk
    );
  }
}

export async function resetConsumedActivitiesInRange(
  db: Db,
  startMs: number,
  endMs: number
): Promise<number> {
  const r = await db.runAsync(
    `UPDATE raw_activities SET consumed=0 WHERE timestamp_ms BETWEEN ? AND ?`,
    startMs,
    endMs
  );
  return r.changes;
}

export async function purgeOldConsumedActivities(db: Db, beforeMs: number): Promise<number> {
  const r = await db.runAsync(
    `DELETE FROM raw_activities WHERE consumed=1 AND timestamp_ms < ?`,
    beforeMs
  );
  return r.changes;
}
