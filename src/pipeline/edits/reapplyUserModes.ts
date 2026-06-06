import type { Db } from '../../db/client';
import type { Mode } from '../../types';
import { co2GramsForSection } from '../../co2/compute';

export interface UserModeSnapshot {
  startTimeMs: number;
  endTimeMs: number;
  userMode: Mode;
}

/** Capture user_mode overrides for the given trips, keyed by section bounds. */
export async function snapshotUserModes(
  db: Db,
  tripIds: number[]
): Promise<UserModeSnapshot[]> {
  if (tripIds.length === 0) return [];
  const placeholders = tripIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<{
    start_time_ms: number;
    end_time_ms: number;
    user_mode: string;
  }>(
    `SELECT start_time_ms, end_time_ms, user_mode FROM sections
     WHERE trip_id IN (${placeholders}) AND user_mode IS NOT NULL`,
    ...tripIds
  );
  return rows.map((r) => ({
    startTimeMs: r.start_time_ms,
    endTimeMs: r.end_time_ms,
    userMode: r.user_mode as Mode,
  }));
}

/**
 * Reapply snapshotted overrides to any section whose bounds match EXACTLY.
 * Updates the section's user_mode + co2, and marks the owning trip edited.
 */
export async function reapplyUserModes(
  db: Db,
  snapshots: UserModeSnapshot[]
): Promise<void> {
  for (const snap of snapshots) {
    const rows = await db.getAllAsync<{ id: number; trip_id: number; distance_m: number }>(
      `SELECT id, trip_id, distance_m FROM sections
       WHERE start_time_ms = ? AND end_time_ms = ?`,
      snap.startTimeMs,
      snap.endTimeMs
    );
    for (const row of rows) {
      const co2 = co2GramsForSection(snap.userMode, row.distance_m);
      await db.runAsync(
        `UPDATE sections SET user_mode = ?, mode_source = 'manual', co2_g = ? WHERE id = ?`,
        snap.userMode,
        co2,
        row.id
      );
      await db.runAsync(`UPDATE trips SET edited = 1 WHERE id = ?`, row.trip_id);
    }
  }
}
