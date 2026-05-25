import type { Db } from '../db/client';

export interface RecordsData {
  longestTripDistanceM: number;
  longestTripDateMs: number | null;
  bestDayDistanceM: number;
  bestDayMs: number | null;
  currentStreakDays: number;
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

  const distinctDays = await db.getAllAsync<{ day_key: string }>(
    `SELECT DISTINCT date(start_time_ms / 1000, 'unixepoch', 'localtime') as day_key
     FROM trips ORDER BY day_key DESC LIMIT 365`
  );
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < distinctDays.length; i++) {
    const expected = new Date(today);
    expected.setDate(today.getDate() - i);
    const expectedKey = expected.toISOString().slice(0, 10);
    if (distinctDays[i]?.day_key === expectedKey) streak++;
    else break;
  }

  return {
    longestTripDistanceM: longest?.d ?? 0,
    longestTripDateMs: longest?.t ?? null,
    bestDayDistanceM: bestDay?.d ?? 0,
    bestDayMs,
    currentStreakDays: streak,
  };
}
