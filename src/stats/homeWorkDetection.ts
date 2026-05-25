import type { Db } from '../db/client';
import { getAllPlaces, setPlaceLabel } from '../db/places';
import type { Place } from '../types';

interface VisitHistogramRow {
  hour: number;
  weekday: number;
  cnt: number;
}

const MIN_VISITS = 5;
const NIGHT_RATIO_FOR_HOME = 0.5;
const WORK_RATIO_FOR_WORK = 0.5;

/**
 * Heuristic detection of home and work:
 *  - Home: a top-visited place with > 50% of arrivals/departures between 22:00 and 06:00.
 *  - Work: a top-visited place (distinct from home) with > 50% of arrivals/departures
 *          on weekdays between 09:00 and 17:00.
 *
 * Pure conservative: ignores low-traffic candidates (< 5 visits).
 */
export async function detectHomeAndWork(
  db: Db
): Promise<{ homeId: number | null; workId: number | null }> {
  const places = (await getAllPlaces(db)).slice(0, 10);
  if (places.length === 0) return { homeId: null, workId: null };

  const thirtyDaysAgoMs = Date.now() - 30 * 86_400_000;
  const histograms = await Promise.all(
    places.map(async (p) => {
      const rows = await db.getAllAsync<VisitHistogramRow>(
        `SELECT cast(strftime('%H', t.start_time_ms/1000, 'unixepoch', 'localtime') as int) as hour,
                cast(strftime('%w', t.start_time_ms/1000, 'unixepoch', 'localtime') as int) as weekday,
                count(*) as cnt
         FROM trips t
         WHERE t.start_time_ms > ?
           AND (t.start_place_id = ? OR t.end_place_id = ?)
         GROUP BY hour, weekday`,
        thirtyDaysAgoMs,
        p.id,
        p.id
      );
      return { place: p, rows };
    })
  );

  let home: { place: Place; rows: VisitHistogramRow[] } | null = null;
  let work: { place: Place; rows: VisitHistogramRow[] } | null = null;

  let bestHomeScore = 0;
  for (const h of histograms) {
    const total = h.rows.reduce((s, r) => s + r.cnt, 0);
    if (total < MIN_VISITS) continue;
    const night = h.rows
      .filter((r) => r.hour >= 22 || r.hour < 6)
      .reduce((s, r) => s + r.cnt, 0);
    if (night / total > NIGHT_RATIO_FOR_HOME && total > bestHomeScore) {
      bestHomeScore = total;
      home = h;
    }
  }

  let bestWorkScore = 0;
  for (const h of histograms) {
    if (home && h.place.id === home.place.id) continue;
    const total = h.rows.reduce((s, r) => s + r.cnt, 0);
    if (total < MIN_VISITS) continue;
    const workHours = h.rows
      .filter(
        (r) => r.hour >= 9 && r.hour < 17 && r.weekday >= 1 && r.weekday <= 5
      )
      .reduce((s, r) => s + r.cnt, 0);
    if (workHours / total > WORK_RATIO_FOR_WORK && total > bestWorkScore) {
      bestWorkScore = total;
      work = h;
    }
  }

  for (const p of places) {
    if (p.label) await setPlaceLabel(db, p.id, null);
  }
  if (home) await setPlaceLabel(db, home.place.id, 'home');
  if (work) await setPlaceLabel(db, work.place.id, 'work');

  return {
    homeId: home?.place.id ?? null,
    workId: work?.place.id ?? null,
  };
}
