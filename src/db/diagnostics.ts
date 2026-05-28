import type { SQLiteBindValue } from 'expo-sqlite';
import type { Db } from './client';

/**
 * Event types emitted by the native tracker into `tracker_diagnostics`.
 * Keep these strings in sync with the Kotlin constants in NativeStore.kt.
 */
export const DIAGNOSTIC_EVENTS = {
  AR_SUBSCRIBED: 'ar_subscribed',
  AR_UNSUBSCRIBED: 'ar_unsubscribed',
  AR_SILENCE_DETECTED: 'ar_silence_detected',
  SVC_CREATE: 'svc_create',
  SVC_START_COMMAND: 'svc_start_command',
  SVC_DESTROY: 'svc_destroy',
  SVC_TASK_REMOVED: 'svc_task_removed',
  BOOT: 'boot',
  STATE_MOVING: 'state_moving',
  STATE_STATIONARY: 'state_stationary',
  GEOFENCE_ARMED: 'geofence_armed',
  GEOFENCE_EXIT: 'geofence_exit',
  GEOFENCE_ERROR: 'geofence_error',
  WATCHDOG_FIRE: 'watchdog_fire',
  WATCHDOG_RESTART: 'watchdog_restart',
  ENV_SNAPSHOT: 'env_snapshot',
} as const;

export type DiagnosticEventType =
  (typeof DIAGNOSTIC_EVENTS)[keyof typeof DIAGNOSTIC_EVENTS];

export interface DiagnosticEvent {
  id: number;
  timestampMs: number;
  eventType: string;
  payload: unknown | null;
}

interface Row {
  id: number;
  timestamp_ms: number;
  event_type: string;
  payload: string | null;
}

function rowToEvent(r: Row): DiagnosticEvent {
  let parsed: unknown = null;
  if (r.payload != null) {
    try {
      parsed = JSON.parse(r.payload);
    } catch {
      parsed = r.payload;
    }
  }
  return {
    id: r.id,
    timestampMs: r.timestamp_ms,
    eventType: r.event_type,
    payload: parsed,
  };
}

export async function insertDiagnosticEvent(
  db: Db,
  timestampMs: number,
  eventType: string,
  payload: unknown | null
): Promise<number> {
  const payloadStr = payload == null ? null : JSON.stringify(payload);
  const res = await db.runAsync(
    `INSERT INTO tracker_diagnostics(timestamp_ms, event_type, payload)
     VALUES(?, ?, ?)`,
    timestampMs,
    eventType,
    payloadStr
  );
  return res.lastInsertRowId;
}

export async function listDiagnosticEvents(
  db: Db,
  opts: { sinceMs?: number; type?: string; limit?: number } = {}
): Promise<DiagnosticEvent[]> {
  const where: string[] = [];
  const args: SQLiteBindValue[] = [];
  if (opts.sinceMs !== undefined) {
    where.push('timestamp_ms >= ?');
    args.push(opts.sinceMs);
  }
  if (opts.type !== undefined) {
    where.push('event_type = ?');
    args.push(opts.type);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limitSql = opts.limit !== undefined ? `LIMIT ${opts.limit}` : '';
  const rows = await db.getAllAsync<Row>(
    `SELECT id, timestamp_ms, event_type, payload
     FROM tracker_diagnostics
     ${whereSql}
     ORDER BY timestamp_ms DESC
     ${limitSql}`,
    ...args
  );
  return rows.map(rowToEvent);
}

export async function countDiagnosticEvents(
  db: Db,
  opts: { sinceMs?: number; type?: string } = {}
): Promise<number> {
  const where: string[] = [];
  const args: SQLiteBindValue[] = [];
  if (opts.sinceMs !== undefined) {
    where.push('timestamp_ms >= ?');
    args.push(opts.sinceMs);
  }
  if (opts.type !== undefined) {
    where.push('event_type = ?');
    args.push(opts.type);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tracker_diagnostics ${whereSql}`,
    ...args
  );
  return r?.n ?? 0;
}
