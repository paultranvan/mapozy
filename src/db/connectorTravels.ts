import type { Db } from './client';

export type ConnectorType = 'tiime';

/** Record that a Mapozy trip was exported to a connector. Idempotent per
 *  (connector, trip): a re-send overwrites the stored external id + timestamp. */
export async function recordSentTravel(
  db: Db,
  connector: ConnectorType,
  mapozyTripId: number,
  externalTravelId: string,
  sentAtMs: number
): Promise<void> {
  await db.runAsync(
    `INSERT INTO connector_travels(connector_type, mapozy_trip_id, external_travel_id, sent_at)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(connector_type, mapozy_trip_id)
     DO UPDATE SET external_travel_id = excluded.external_travel_id, sent_at = excluded.sent_at`,
    connector,
    mapozyTripId,
    externalTravelId,
    sentAtMs
  );
}

export async function getSentTripIds(
  db: Db,
  connector: ConnectorType
): Promise<Set<number>> {
  const rows = await db.getAllAsync<{ mapozy_trip_id: number }>(
    `SELECT mapozy_trip_id FROM connector_travels WHERE connector_type = ?`,
    connector
  );
  return new Set(rows.map((r) => r.mapozy_trip_id));
}

export async function isTripSent(
  db: Db,
  connector: ConnectorType,
  mapozyTripId: number
): Promise<boolean> {
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM connector_travels WHERE connector_type = ? AND mapozy_trip_id = ?`,
    connector,
    mapozyTripId
  );
  return (r?.n ?? 0) > 0;
}
