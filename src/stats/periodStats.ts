import type { Db } from '../db/client';
import type { PeriodKey } from '../lib/time';

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

// --- Period-aware bucketing -------------------------------------------------
// The "By …" chart aggregates the per-day rows above into buckets whose
// granularity steps up with the selected period, so a year doesn't render as
// 365 daily bars (tester feedback: "par an ça devrait être des années … par
// mois … pas par jour"). One step coarser than the period:
//   today/week → day, month → week, year → month, all → year.

export type BucketGranularity = 'day' | 'week' | 'month' | 'year';

export function bucketGranularityFor(period: PeriodKey): BucketGranularity {
  switch (period) {
    case 'today':
    case 'week':
      return 'day';
    case 'month':
      return 'week';
    case 'year':
      return 'month';
    case 'all':
      return 'year';
  }
}

export interface DisplayBucket {
  // Sortable key (chronological string sort).
  key: string;
  // Short x-axis label.
  label: string;
  distanceM: number;
  tripsCount: number;
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function parseDayKey(dayKey: string): { y: number; m: number; d: number } {
  const [y, m, d] = dayKey.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// (key, label) the day belongs to at the given granularity. Weeks are
// Monday-aligned to match navigablePeriodRange's startOfWeek.
function bucketFor(dayKey: string, g: BucketGranularity): { key: string; label: string } {
  const { y, m, d } = parseDayKey(dayKey);
  if (g === 'year') return { key: String(y), label: String(y) };
  if (g === 'month') return { key: `${y}-${pad2(m)}`, label: MONTHS_SHORT[m - 1]! };
  // week: snap back to Monday
  const date = new Date(y, m - 1, d);
  const dow = (date.getDay() + 6) % 7; // Mon=0 … Sun=6
  date.setDate(date.getDate() - dow);
  const wy = date.getFullYear();
  const wm = date.getMonth() + 1;
  const wd = date.getDate();
  return { key: `${wy}-${pad2(wm)}-${pad2(wd)}`, label: `${wd} ${MONTHS_SHORT[wm - 1]}` };
}

/**
 * Roll per-day buckets up to the requested granularity, summing distance and
 * trip counts. Returns chronologically-sorted display buckets with x-axis
 * labels. `day` granularity is a passthrough that just attaches labels.
 */
export function aggregateDailyBuckets(
  daily: DailyBucket[],
  granularity: BucketGranularity
): DisplayBucket[] {
  if (granularity === 'day') {
    return daily.map((b) => {
      const { m, d } = parseDayKey(b.dayKey);
      return {
        key: b.dayKey,
        label: `${d} ${MONTHS_SHORT[m - 1]}`,
        distanceM: b.distanceM,
        tripsCount: b.tripsCount,
      };
    });
  }
  const byKey = new Map<string, DisplayBucket>();
  for (const b of daily) {
    const { key, label } = bucketFor(b.dayKey, granularity);
    const cur = byKey.get(key);
    if (cur) {
      cur.distanceM += b.distanceM;
      cur.tripsCount += b.tripsCount;
    } else {
      byKey.set(key, { key, label, distanceM: b.distanceM, tripsCount: b.tripsCount });
    }
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
