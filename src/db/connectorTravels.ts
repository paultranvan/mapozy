import type { Db } from './client';
import type { TiimeExpenseReportTravel } from '../connectors/tiime/types';

export type ConnectorType = 'tiime';

/** Outcome of the mileage expense report attached to a sent travel.
 *  'none' = never attempted (the user unchecked the box).
 *  'dismissed' = failed, and the user acknowledged it — kept distinct from
 *  'none' so the history still records that a report was owed and never made. */
export type ExpenseReportStatus = 'none' | 'done' | 'failed' | 'dismissed';

/** Record that a travel was exported to a connector, keyed by a content
 *  signature rather than the (volatile) Mapozy trip id: a recompute deletes
 *  and recreates trips with new ids, but the signature survives it. Idempotent
 *  per (connector, signature): a re-send overwrites the stored external id,
 *  timestamp and trip id — and resets the expense-report columns, since a
 *  re-send produces a NEW Tiime travel to which any previous report no longer
 *  refers. */
export async function recordSentTravel(
  db: Db,
  connector: ConnectorType,
  signature: string,
  externalTravelId: string,
  sentAtMs: number,
  mapozyTripId: number | null
): Promise<void> {
  await db.runAsync(
    `INSERT INTO connector_travels(connector_type, signature, mapozy_trip_id, external_travel_id, sent_at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(connector_type, signature)
     DO UPDATE SET external_travel_id = excluded.external_travel_id,
                   sent_at = excluded.sent_at,
                   mapozy_trip_id = excluded.mapozy_trip_id,
                   travel_body = NULL,
                   expense_report_id = NULL,
                   expense_report_status = 'none',
                   expense_report_error = NULL`,
    connector,
    signature,
    mapozyTripId,
    externalTravelId,
    sentAtMs
  );
}

export async function getSentSignatures(
  db: Db,
  connector: ConnectorType
): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ signature: string }>(
    `SELECT signature FROM connector_travels WHERE connector_type = ?`,
    connector
  );
  return new Set(rows.map((r) => r.signature));
}

export async function isSignatureSent(
  db: Db,
  connector: ConnectorType,
  signature: string
): Promise<boolean> {
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM connector_travels WHERE connector_type = ? AND signature = ?`,
    connector,
    signature
  );
  return (r?.n ?? 0) > 0;
}

export async function markExpenseReportDone(
  db: Db,
  connector: ConnectorType,
  signature: string,
  expenseReportId: string
): Promise<void> {
  await db.runAsync(
    `UPDATE connector_travels
        SET expense_report_status = 'done',
            expense_report_id = ?,
            expense_report_error = NULL
      WHERE connector_type = ? AND signature = ?`,
    expenseReportId,
    connector,
    signature
  );
}

/** Persist a failed report along with the travel body needed to replay it.
 *  `travelBody` is null when the failure happened before the travel was fully
 *  computed (the vehicle lookup or the amount computation failed) — such a row
 *  is still surfaced to the user, but its retry has to redo those steps. */
export async function markExpenseReportFailed(
  db: Db,
  connector: ConnectorType,
  signature: string,
  error: string,
  travelBody: TiimeExpenseReportTravel | null
): Promise<void> {
  await db.runAsync(
    `UPDATE connector_travels
        SET expense_report_status = 'failed',
            expense_report_error = ?,
            travel_body = ?
      WHERE connector_type = ? AND signature = ?`,
    error,
    travelBody ? JSON.stringify(travelBody) : null,
    connector,
    signature
  );
}

/** Stop surfacing a failed report. The travel stays recorded as sent (it does
 *  exist in Tiime), only the retry prompt goes away — a permanent banner the
 *  user cannot clear is worse than no banner at all. */
export async function dismissExpenseReport(
  db: Db,
  connector: ConnectorType,
  signature: string
): Promise<void> {
  await db.runAsync(
    `UPDATE connector_travels
        SET expense_report_status = 'dismissed'
      WHERE connector_type = ? AND signature = ? AND expense_report_status = 'failed'`,
    connector,
    signature
  );
}

export interface FailedExpenseReport {
  signature: string;
  externalTravelId: string;
  sentAtMs: number;
  error: string | null;
  /** Null when the travel never reached the computed stage — see
   *  `markExpenseReportFailed`. Such a row cannot be retried in one call. */
  travel: TiimeExpenseReportTravel | null;
}

/** Travels that exist in Tiime but whose expense report could not be created.
 *  They are no longer candidates (their signature is recorded as sent), so this
 *  is the only surface that can offer a retry after an app restart. */
export async function listFailedExpenseReports(
  db: Db,
  connector: ConnectorType
): Promise<FailedExpenseReport[]> {
  const rows = await db.getAllAsync<{
    signature: string;
    external_travel_id: string;
    sent_at: number;
    expense_report_error: string | null;
    travel_body: string | null;
  }>(
    `SELECT signature, external_travel_id, sent_at, expense_report_error, travel_body
       FROM connector_travels
      WHERE connector_type = ? AND expense_report_status = 'failed'
      ORDER BY sent_at DESC`,
    connector
  );
  return rows.map((r) => ({
    signature: r.signature,
    externalTravelId: r.external_travel_id,
    sentAtMs: r.sent_at,
    error: r.expense_report_error,
    travel: parseTravelBody(r.travel_body),
  }));
}

function parseTravelBody(raw: string | null): TiimeExpenseReportTravel | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TiimeExpenseReportTravel;
  } catch {
    return null;
  }
}
