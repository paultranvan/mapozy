import type { Db } from '../db/client';
import type { Mode } from '../types';

export interface ModeBucket {
  mode: Mode;
  distanceM: number;
  durationS: number;
  co2G: number;
}

// Grouped by *effective* mode (user override wins over auto-detected —
// SQL twin of pipeline/effectiveMode.ts), matching what the user sees on
// trips and what the mode-filtered chart/KPI queries in periodStats.ts sum.
export async function modeBreakdown(
  db: Db,
  startMs: number,
  endMs: number
): Promise<ModeBucket[]> {
  const rows = await db.getAllAsync<{
    mode: string;
    d: number;
    dur: number;
    co2: number;
  }>(
    `SELECT COALESCE(s.user_mode, s.mode) as mode,
            SUM(s.distance_m) as d,
            SUM(s.duration_s) as dur,
            SUM(s.co2_g) as co2
     FROM sections s
     JOIN trips t ON s.trip_id = t.id
     WHERE t.start_time_ms BETWEEN ? AND ?
     GROUP BY COALESCE(s.user_mode, s.mode)
     ORDER BY d DESC`,
    startMs,
    endMs
  );
  return rows.map((r) => ({
    mode: r.mode as Mode,
    distanceM: r.d,
    durationS: r.dur,
    co2G: r.co2,
  }));
}
