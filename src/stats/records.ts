import type { Db } from '../db/client';

export interface RecordsData {
  longestTripDistanceM: number;
  longestTripDateMs: number | null;
  bestDayDistanceM: number;
  bestDayMs: number | null;
}

export async function records(db: Db): Promise<RecordsData> {
  const longest = await db.getFirstAsync<{ d: number; t: number }>(
    `SELECT distance_m as d, start_time_ms as t FROM trips ORDER BY distance_m DESC LIMIT 1`
  );

  const bestDay = await db.getFirstAsync<{ day_key: string; d: number }>(
    `SELECT date(start_time_ms / 1000, 'unixepoch', 'localtime') as day_key,
            SUM(distance_m) as d
     FROM trips GROUP BY day_key ORDER BY d DESC LIMIT 1`
  );
  const bestDayMs = bestDay
    ? new Date(bestDay.day_key + 'T00:00:00').getTime()
    : null;

  return {
    longestTripDistanceM: longest?.d ?? 0,
    longestTripDateMs: longest?.t ?? null,
    bestDayDistanceM: bestDay?.d ?? 0,
    bestDayMs,
  };
}
