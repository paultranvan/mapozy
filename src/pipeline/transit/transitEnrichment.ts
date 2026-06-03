import type { DraftReason } from '../../types';
import {
  getTripById,
  setTripDraft,
  updateTripAggregates,
} from '../../db/trips';
import { updateSectionClassification } from '../../db/sections';
import { co2GramsForSection } from '../../co2/compute';
import { dominantModeFor } from '../dominantMode';
import { RULES } from '../rules';
import { classifySection } from './classifySection';
import {
  getRailwaysIn,
  getStopsNear,
  OverpassRateLimitError,
  OverpassOfflineError,
  OverpassUnavailableError,
  type OverpassDeps,
  type BBox,
} from '../../lib/overpass';

export interface EnrichResult {
  status: 'enriched' | 'draft' | 'skipped';
  reason?: DraftReason;
  changed: number;
}

function coordsOf(geojson: string): Array<[number, number]> {
  try {
    const g = JSON.parse(geojson) as { coordinates?: Array<[number, number]> };
    return Array.isArray(g.coordinates) ? g.coordinates : [];
  } catch {
    return [];
  }
}

function bboxOf(coords: Array<[number, number]>): BBox {
  let south = 90;
  let west = 180;
  let north = -90;
  let east = -180;
  for (const [lon, lat] of coords) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  return { south, west, north, east };
}

/**
 * Re-runnable, network-touching transit classification for one stored trip.
 * Walks the trip's `car` sections, reclassifies via Overpass, recomputes
 * aggregates, and clears `draft`. On any Overpass failure it sets the matching
 * `draft`/`draftReason` and returns without mutating section modes. Operating on
 * the stored trip (not raw points) makes this safe to re-run — it IS the
 * pull-to-refresh mechanism for draft trips.
 */
export async function enrichTripTransit(
  deps: OverpassDeps,
  tripId: number
): Promise<EnrichResult> {
  const db = deps.db;
  const trip = await getTripById(db, tripId);
  if (!trip || trip.id == null) return { status: 'skipped', changed: 0 };

  const radius = RULES.TRANSIT_STOP_RADIUS.defaults.radiusM;
  let changed = 0;

  try {
    for (const sec of trip.sections) {
      if (sec.mode !== 'car' || sec.id == null) continue;
      const coords = coordsOf(sec.geojson);
      if (coords.length < 2) continue;

      const ways = await getRailwaysIn(deps, bboxOf(coords));
      const start = coords[0]!;
      const end = coords[coords.length - 1]!;
      const startStops = await getStopsNear(deps, start[1], start[0], radius);
      const endStops = await getStopsNear(deps, end[1], end[0], radius);

      const cls = classifySection({ coords, ways, startStops, endStops });
      if (cls) {
        const co2 = co2GramsForSection(cls.mode, sec.distanceM);
        await updateSectionClassification(
          db,
          sec.id,
          cls.mode,
          cls.modeSource,
          cls.modeConfidence,
          co2
        );
        sec.mode = cls.mode;
        sec.co2G = co2;
        changed++;
      }
    }
  } catch (err) {
    let reason: DraftReason;
    if (err instanceof OverpassRateLimitError) reason = 'rate_limited';
    else if (err instanceof OverpassOfflineError) reason = 'offline';
    else if (err instanceof OverpassUnavailableError) reason = 'overpass_error';
    else throw err;
    await setTripDraft(db, trip.id, true, reason);
    return { status: 'draft', reason, changed };
  }

  const dom = dominantModeFor(trip.sections);
  const co2Total = trip.sections.reduce((a, s) => a + s.co2G, 0);
  await updateTripAggregates(db, trip.id, dom, co2Total);
  await setTripDraft(db, trip.id, false, null);
  return { status: 'enriched', changed };
}
