import type { Db } from '../db/client';

export interface PeriodKpi {
  totalDistanceM: number;
  tripsCount: number;
  totalCo2G: number;
  totalDurationS: number;
}

export async function periodKpi(
  db: Db,
  startMs: number,
  endMs: number
): Promise<PeriodKpi> {
  const r = await db.getFirstAsync<{
    d: number | null;
    c: number;
    co2: number | null;
    dur: number | null;
  }>(
    `SELECT SUM(distance_m) as d, COUNT(*) as c, SUM(co2_g) as co2, SUM(duration_s) as dur
     FROM trips WHERE start_time_ms BETWEEN ? AND ?`,
    startMs,
    endMs
  );
  return {
    totalDistanceM: r?.d ?? 0,
    tripsCount: r?.c ?? 0,
    totalCo2G: r?.co2 ?? 0,
    totalDurationS: r?.dur ?? 0,
  };
}

export interface DailyBucket {
  dayKey: string;
  distanceM: number;
  tripsCount: number;
}

export async function dailyDistances(
  db: Db,
  startMs: number,
  endMs: number
): Promise<DailyBucket[]> {
  const rows = await db.getAllAsync<{ day_key: string; d: number; c: number }>(
    `SELECT date(start_time_ms / 1000, 'unixepoch', 'localtime') as day_key,
            SUM(distance_m) as d,
            COUNT(*) as c
     FROM trips WHERE start_time_ms BETWEEN ? AND ?
     GROUP BY day_key ORDER BY day_key ASC`,
    startMs,
    endMs
  );
  return rows.map((r) => ({
    dayKey: r.day_key,
    distanceM: r.d,
    tripsCount: r.c,
  }));
}
