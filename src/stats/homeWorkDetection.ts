import type { Db } from '../db/client';
import { getAutoPlaces, getUserPlaces } from '../db/places';
import type { Place, PlaceCategory } from '../types';

export interface HomeWorkSuggestion {
  latitude: number;
  longitude: number;
  displayName: string | null;
  category: PlaceCategory;
}

interface PresenceRow {
  hour: number;
  weekday: number;
  cnt: number;
}

const MIN_VISITS = 5;
// Home shows ~45% night presence in practice (people also come and go all day),
// so a >50% gate never fires. We instead RANK places by night-presence count
// and require only a modest ratio to rule out a place that's merely busy.
const HOME_MIN_RATIO = 0.4;
const WORK_MIN_RATIO = 0.5;

// Home window: evening return through morning departure (overnight presence).
const isHomeHour = (h: number) => h >= 21 || h < 8;
// Work window: weekday daytime, wide enough to catch 7-9 arrivals and 17-19
// departures (a 9-17 window misses both ends of a normal workday).
const isWorkHour = (h: number, wd: number) => h >= 8 && h < 19 && wd >= 1 && wd <= 5;

interface Candidate {
  place: Place;
  total: number;
  homeCount: number;
  workCount: number;
}

/**
 * Heuristic suggestion of home and work from when the user is *present* at each
 * auto-place. Presence is sampled at both endpoints of every trip: a trip departing
 * place P contributes its START time to P; a trip arriving at place P
 * contributes its END time to P.
 *
 *  - Home: the place with the most overnight presence (21:00-08:00),
 *    requiring ≥ 40% of its visits fall in that window.
 *  - Work: the most weekday-daytime place (08:00-19:00, distinct from home),
 *    requiring ≥ 50%.
 *
 * Conservative: ignores low-traffic candidates (< 5 visits).
 * Read-only: never mutates the DB. Suppresses a category when the user already
 * has a user POI with that category.
 */
export async function suggestHomeWork(
  db: Db
): Promise<{ home: HomeWorkSuggestion | null; work: HomeWorkSuggestion | null }> {
  const autos = await getAutoPlaces(db, 10);
  if (autos.length === 0) return { home: null, work: null };

  const thirtyDaysAgoMs = Date.now() - 30 * 86_400_000;

  const candidates: Candidate[] = [];
  for (const place of autos) {
    // Departures (place is the trip's start) keyed by start time; arrivals
    // (place is the trip's end) keyed by end time. UNION ALL so both count.
    const rows = await db.getAllAsync<PresenceRow>(
      `SELECT hour, weekday, count(*) as cnt FROM (
         SELECT cast(strftime('%H', start_time_ms/1000,'unixepoch','localtime') as int) as hour,
                cast(strftime('%w', start_time_ms/1000,'unixepoch','localtime') as int) as weekday
         FROM trips WHERE start_time_ms > ? AND start_place_id = ?
         UNION ALL
         SELECT cast(strftime('%H', end_time_ms/1000,'unixepoch','localtime') as int) as hour,
                cast(strftime('%w', end_time_ms/1000,'unixepoch','localtime') as int) as weekday
         FROM trips WHERE end_time_ms > ? AND end_place_id = ?
       ) GROUP BY hour, weekday`,
      thirtyDaysAgoMs,
      place.id,
      thirtyDaysAgoMs,
      place.id
    );
    const total = rows.reduce((s, r) => s + r.cnt, 0);
    if (total < MIN_VISITS) continue;
    candidates.push({
      place,
      total,
      homeCount: rows
        .filter((r) => isHomeHour(r.hour))
        .reduce((s, r) => s + r.cnt, 0),
      workCount: rows
        .filter((r) => isWorkHour(r.hour, r.weekday))
        .reduce((s, r) => s + r.cnt, 0),
    });
  }

  // Home: most overnight presence, with a ratio floor so a busy non-home place
  // can't win on raw count alone.
  const home =
    candidates
      .filter((c) => c.homeCount / c.total >= HOME_MIN_RATIO)
      .sort((a, b) => b.homeCount - a.homeCount)[0] ?? null;

  // Work: most weekday-daytime presence among the non-home places.
  const work =
    candidates
      .filter(
        (c) =>
          c.place.id !== home?.place.id &&
          c.workCount / c.total >= WORK_MIN_RATIO
      )
      .sort((a, b) => b.workCount - a.workCount)[0] ?? null;

  const users = await getUserPlaces(db);
  const hasCategory = (c: PlaceCategory) => users.some((u) => u.category === c);

  const toSuggestion = (p: Place | undefined, category: PlaceCategory): HomeWorkSuggestion | null =>
    p && !hasCategory(category)
      ? { latitude: p.latitude, longitude: p.longitude, displayName: p.displayName, category }
      : null;

  return {
    home: toSuggestion(home?.place, 'home'),
    work: toSuggestion(work?.place, 'work'),
  };
}
