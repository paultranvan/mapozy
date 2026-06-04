import type { DraftReason } from '../../types';
import type { Section } from '../../types';
import {
  getTripById,
  setTripDraft,
  updateTripAggregates,
  replaceTripSectionsAndBreaks,
  updateTripTotals,
} from '../../db/trips';
import { updateSectionClassification } from '../../db/sections';
import { getPointsInRange } from '../../db/rawPoints';
import { co2GramsForSection } from '../../co2/compute';
import { dominantModeFor } from '../dominantMode';
import { RULES } from '../rules';
import { classifySection } from './classifySection';
import {
  isMetroStation,
  qualifiesAsSubwayGap,
  buildSubwaySection,
  rebuildWithSubway,
  recomputeTotals,
} from './subwayGaps';
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
  if (coords.length === 0) throw new Error('bboxOf: empty coords');
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

function firstCoord(geojson: string): [number, number] | null {
  try {
    const g = JSON.parse(geojson) as { coordinates?: Array<[number, number]> };
    return g.coordinates && g.coordinates.length > 0 ? g.coordinates[0]! : null;
  } catch {
    return null;
  }
}
function lastCoord(geojson: string): [number, number] | null {
  try {
    const g = JSON.parse(geojson) as { coordinates?: Array<[number, number]> };
    return g.coordinates && g.coordinates.length > 0
      ? g.coordinates[g.coordinates.length - 1]!
      : null;
  } catch {
    return null;
  }
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
  const subwayRadius = RULES.SUBWAY_STATION_RADIUS.defaults.radiusM;
  let changed = 0;
  let restructured = false;
  const conversions = new Map<number, Section>();

  try {
    // Pass 1: reclassify motorized (car) sections via rail-match/station/bus.
    const maxAccM = RULES.ACCURACY_FILTER.defaults.maxAccuracyM;
    for (const sec of trip.sections) {
      if (sec.mode !== 'car' || sec.id == null) continue;
      // Match on the RAW fixes, not the persisted resampled trace. A section's
      // 10-s resampling interpolates straight chords across GPS gaps (e.g. a
      // subway surfacing only near stations), and those chords bow far off the
      // curved track — tanking rail coverage. The raw fixes sit on the rail.
      // Fall back to the resampled trace when raw points aren't available.
      const rawFixes = (await getPointsInRange(db, sec.startTimeMs, sec.endTimeMs))
        .filter((p) => p.accuracyMeters <= maxAccM)
        .map((p) => [p.longitude, p.latitude] as [number, number]);
      const coords = rawFixes.length >= 2 ? rawFixes : coordsOf(sec.geojson);
      if (coords.length < 2) continue;
      const ways = await getRailwaysIn(deps, bboxOf(coords));
      const start = coords[0]!;
      const end = coords[coords.length - 1]!;
      const startStops = await getStopsNear(deps, start[1], start[0], radius);
      const endStops = await getStopsNear(deps, end[1], end[0], radius);
      const cls = classifySection({ coords, ways, startStops, endStops });
      if (cls) {
        const co2 = co2GramsForSection(cls.mode, sec.distanceM);
        await updateSectionClassification(db, sec.id, cls.mode, cls.modeSource, cls.modeConfidence, co2);
        sec.mode = cls.mode;
        sec.co2G = co2;
        changed++;
      }
    }

    // Pass 2: convert gap-derived breaks between two metro stations to subway.
    const byOrdering = new Map<number, (typeof trip.sections)[number]>();
    for (const s of trip.sections) byOrdering.set(s.ordering, s);
    for (const b of trip.breaks) {
      if (!b.gap) continue;
      const before = byOrdering.get(b.ordering);
      const after = byOrdering.get(b.ordering + 1);
      if (!before || !after) continue;
      const entry = lastCoord(before.geojson);
      const exit = firstCoord(after.geojson);
      if (!entry || !exit) continue;
      if (!qualifiesAsSubwayGap(b, entry, exit)) continue;
      const startStops = await getStopsNear(deps, entry[1], entry[0], subwayRadius);
      const endStops = await getStopsNear(deps, exit[1], exit[0], subwayRadius);
      if (startStops.some(isMetroStation) && endStops.some(isMetroStation)) {
        conversions.set(b.ordering, buildSubwaySection(b, entry, exit));
        restructured = true;
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

  if (restructured) {
    const rebuilt = rebuildWithSubway(trip.sections, trip.breaks, conversions);
    await replaceTripSectionsAndBreaks(db, trip.id, rebuilt.sections, rebuilt.breaks);
    const totals = recomputeTotals(rebuilt.sections);
    await updateTripTotals(db, trip.id, totals.distanceM, totals.co2G, totals.dominantMode, totals.geojson);
  } else {
    const dom = dominantModeFor(trip.sections);
    const co2Total = trip.sections.reduce((a, s) => a + s.co2G, 0);
    await updateTripAggregates(db, trip.id, dom, co2Total);
  }
  await setTripDraft(db, trip.id, false, null);
  return { status: 'enriched', changed };
}
