import type { Db } from '../db/client';
import { getAutoPlaces, getUserPlaces } from '../db/places';
import { nearestUserPoi } from '../lib/poiResolve';
import type { Place, PlaceCategory } from '../types';

export interface HomeSuggestion {
  latitude: number;
  longitude: number;
  displayName: string | null;
  category: PlaceCategory;
}

interface TripRow {
  s: number; // start_time_ms
  e: number; // end_time_ms
  sp: number | null; // start_place_id
  ep: number | null; // end_place_id
}

// Home is where you SLEEP, so require at least a couple of overnight stays
// before suggesting a place as home.
const MIN_OVERNIGHTS = 2;

// True if the stay [aMs, dMs] spans the deep-night core (local 04:00), i.e. the
// user slept there. This is the key to home detection: home is precisely where
// you stay overnight WITHOUT generating any trip, so its trip endpoints (evening
// arrival before 21:00, morning departure after 08:00) all fall in daytime — the
// only reliable signal is that a *stay* brackets the night, not when transitions
// happen.
function spansNight(aMs: number, dMs: number): boolean {
  const probe = new Date(aMs);
  probe.setHours(4, 0, 0, 0); // local 04:00 on the arrival's calendar day
  let mark = probe.getTime();
  if (mark <= aMs) mark += 86_400_000; // first 04:00 strictly after arrival
  return mark < dMs;
}

/**
 * Heuristic suggestion of the user's home from auto-places.
 *
 * Home = the place with the most overnight DWELL — stays that bracket the
 * deep-night core (local 04:00). A "stay" at place P is the gap between a trip
 * arriving at P and the next trip departing from P. Endpoint-hour sampling can't
 * find home: you arrive in the evening and leave in the morning, so the
 * transitions look like daytime even though you slept there.
 *
 * We deliberately do NOT auto-suggest "work": unlike sleeping, weekday-daytime
 * presence is a weak signal that can't tell a workplace apart from a gym, a
 * school run, or a physio appointment — better to let the user tag work by hand.
 *
 * Conservative: needs ≥ 2 overnight stays. Read-only: never mutates the DB.
 * Suppresses the suggestion when a user POI already covers the place.
 */
export async function suggestHome(db: Db): Promise<HomeSuggestion | null> {
  const autos = await getAutoPlaces(db, 10);
  if (autos.length === 0) return null;

  const thirtyDaysAgoMs = Date.now() - 30 * 86_400_000;
  const byId = new Map(autos.map((p) => [p.id, p]));

  // All recent trips in chronological order, so we can reconstruct inter-trip
  // stays: a stay at P is bounded by a trip arriving at P and the next
  // chronological trip departing from P.
  const trips = await db.getAllAsync<TripRow>(
    `SELECT start_time_ms as s, end_time_ms as e,
            start_place_id as sp, end_place_id as ep
     FROM trips WHERE end_time_ms > ? ORDER BY start_time_ms`,
    thirtyDaysAgoMs
  );

  const overnights = new Map<number, number>();
  for (let i = 0; i < trips.length - 1; i++) {
    const arrive = trips[i]!;
    const depart = trips[i + 1]!;
    const pid = arrive.ep;
    if (
      pid != null &&
      pid === depart.sp &&
      byId.has(pid) &&
      spansNight(arrive.e, depart.s)
    ) {
      overnights.set(pid, (overnights.get(pid) ?? 0) + 1);
    }
  }

  let home: Place | null = null;
  let bestOvernights = 0;
  for (const [pid, n] of overnights) {
    if (n >= MIN_OVERNIGHTS && n > bestOvernights) {
      bestOvernights = n;
      home = byId.get(pid) ?? null;
    }
  }
  if (!home) return null;

  const users = await getUserPlaces(db);
  if (nearestUserPoi(home.latitude, home.longitude, users) !== null) return null;

  return {
    latitude: home.latitude,
    longitude: home.longitude,
    displayName: home.displayName,
    category: 'home',
  };
}
