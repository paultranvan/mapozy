import type { Db } from './client';

export type ConnectorType = 'tiime';

/** Record that a travel was exported to a connector, keyed by a content
 *  signature rather than the (volatile) Mapozy trip id: a recompute deletes
 *  and recreates trips with new ids, but the signature survives it. Idempotent
 *  per (connector, signature): a re-send overwrites the stored external id,
 *  timestamp and trip id. */
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
                   mapozy_trip_id = excluded.mapozy_trip_id`,
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
