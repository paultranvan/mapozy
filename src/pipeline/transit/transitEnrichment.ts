import type { DraftReason } from '../../types';
import type { Section } from '../../types';
import {
  getTripById,
  setTripDraft,
  updateTripAggregates,
  replaceTripSectionsAndBreaks,
  updateTripTotals,
} from '../../db/trips';
import {
  updateSectionClassification,
  updateSectionMatchedGeometry,
  getSectionsForTrip,
} from '../../db/sections';
import { getPointsInRange } from '../../db/rawPoints';
import { haversineMeters } from '../../lib/distance';
import { co2GramsForSection } from '../../co2/compute';
import { dominantModeFor } from '../dominantMode';
import { effectiveMode } from '../effectiveMode';
import { mapMatch, type Costing } from '../../lib/valhalla';
import { RULES } from '../rules';
import type { Mode } from '../../types';
import {
  boatGuard,
  classifyBoat,
  classifyBusCorridor,
  classifySection,
  classifyTrainBySpeed,
  samplePathEvery,
  sharedEndpointBusRefs,
} from './classifySection';
import {
  isMetroStation,
  qualifiesAsSubwayGap,
  buildSubwaySection,
  rebuildWithSubway,
  recomputeTotals,
} from './subwayGaps';
import {
  capCoordsToTileBudget,
  getRailwaysNear,
  getStopsNear,
  getWaterwaysNear,
  OverpassRateLimitError,
  OverpassOfflineError,
  OverpassUnavailableError,
  type OverpassDeps,
  type TransitStop,
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
 * Network-touching classification of one still-`car` section: rail map-match,
 * endpoint stations, boat, then bus corridor. Returns null to leave it as
 * `car`. Overpass errors propagate to the caller's draft handling.
 */
async function classifyCarSectionOnline(
  deps: OverpassDeps,
  sec: Section,
  radius: number
): Promise<ReturnType<typeof classifySection>> {
  const db = deps.db;
  const maxAccM = RULES.ACCURACY_FILTER.defaults.maxAccuracyM;
  // Match on the RAW fixes, not the persisted resampled trace. A section's
  // 10-s resampling interpolates straight chords across GPS gaps (e.g. a
  // subway surfacing only near stations), and those chords bow far off the
  // curved track — tanking rail coverage. The raw fixes sit on the rail.
  // Fall back to the resampled trace when raw points aren't available.
  const rawPoints = (await getPointsInRange(db, sec.startTimeMs, sec.endTimeMs)).filter(
    (p) => p.accuracyMeters <= maxAccM
  );
  const rawFixes = rawPoints.map((p) => [p.longitude, p.latitude] as [number, number]);
  const useRaw = rawFixes.length >= 2;
  const coords = useRaw ? rawFixes : coordsOf(sec.geojson);
  if (coords.length < 2) return null;
  // Way-based matching (rail, water) runs on a tile-budgeted probe of the
  // trace — fetch and coverage measurement MUST share the same coords.
  const probe = capCoordsToTileBudget(coords, RULES.RAIL_MAP_MATCH.defaults.maxProbeTiles);
  const ways = await getRailwaysNear(deps, probe);
  const start = coords[0]!;
  const end = coords[coords.length - 1]!;
  const startStops = await getStopsNear(deps, start[1], start[0], radius);
  const endStops = await getStopsNear(deps, end[1], end[0], radius);
  let cls = classifySection({ coords: probe, ways, startStops, endStops });
  if (!cls && boatGuard(sec.distanceM, sec.durationS)) {
    // Step 3.5 — boat: slow, long section following waterway/ferry
    // geometry (tester: canal cruise classified walk·car·bike). Checked
    // before the bus corridor — cheaper (one tiled fetch vs per-400 m
    // stop probes) and a canal trace lined with quai-side bus stops must
    // not win as "bus".
    cls = classifyBoat(probe, await getWaterwaysNear(deps, probe));
  }
  if (!cls) {
    // Step 4 — bus. One unified path for both the door-to-door case
    // (endpoints are home/work, no stop nearby) and the endpoint-anchored
    // case (both ends near stops sharing a route_ref): gather the bus
    // stops lining the path (probing one cache cell every ~400 m) and
    // score route corridors, where dwell evidence is mandatory and a
    // shared endpoint ref counts as a structural vote. Guarded to
    // plausible bus legs so motorway drives skip the lookups; a shared
    // endpoint ref waives the length floor (a short anchored hop is
    // plausible), never the speed ceiling.
    const bc = RULES.BUS_CORRIDOR.defaults;
    const avgSpeed = sec.distanceM / Math.max(1, sec.durationS);
    const endpointRefs = sharedEndpointBusRefs(startStops, endStops);
    if (
      (sec.distanceM >= bc.minDistanceM || endpointRefs.size > 0) &&
      avgSpeed <= bc.maxAvgSpeedMps
    ) {
      const seen = new Map<number, TransitStop>();
      for (const p of samplePathEvery(coords, bc.cellProbeEveryM)) {
        for (const s of await getStopsNear(deps, p[1], p[0], bc.cellProbeRadiusM)) {
          seen.set(s.id, s);
        }
      }
      cls = classifyBusCorridor({
        path: coords,
        speeds: useRaw ? rawPoints.map((p) => p.speedMps ?? null) : coords.map(() => null),
        stops: [...seen.values()],
        endpointRefs,
      });
    }
  }
  return cls;
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
  // Structurally-edited trips are user-curated; never auto-reclassify them.
  if (trip.locked) return { status: 'skipped', changed: 0 };

  const radius = RULES.TRANSIT_STOP_RADIUS.defaults.radiusM;
  const subwayRadius = RULES.SUBWAY_STATION_RADIUS.defaults.radiusM;
  let changed = 0;
  let restructured = false;
  const conversions = new Map<number, Section>();

  try {
    // Pass 1: reclassify motorized (car) sections. RULE_TRAIN_SPEED first —
    // local and free; only unresolved sections pay the Overpass path.
    for (const sec of trip.sections) {
      if (sec.mode !== 'car' || sec.id == null) continue;
      if (sec.userMode != null) continue; // user override wins
      const cls =
        classifyTrainBySpeed(sec.distanceM, sec.durationS) ??
        (await classifyCarSectionOnline(deps, sec, radius));
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
      }
    }
    // A single untracked underground hop is plausible. TWO or more "subway"
    // gaps in one trip almost always mean a SURFACE ride (bus/tram) whose GPS
    // was repeatedly suspended by power-save — not a chain of metro legs. In
    // dense cities nearly every gap endpoint sits within the station radius, so
    // converting them all fabricates a string of straight-line teleports plus
    // bogus walk-to/from-station legs (tester: bus ride shown as metro with a
    // walk that never happened). Decline the whole set in that case.
    if (conversions.size >= 2) {
      conversions.clear();
    }
    restructured = conversions.size > 0;
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

  // Pass 3: road-snap non-transit sections via Valhalla. Runs AFTER any subway
  // restructure (which re-inserts sections) so matched geometry isn't clobbered,
  // and is fully best-effort: a Valhalla outage leaves the raw trace and never
  // drafts the trip (unlike the Overpass passes above).
  await mapMatchTripSections(deps, trip.id);

  await setTripDraft(db, trip.id, false, null);
  return { status: 'enriched', changed };
}

const COSTING_FOR_MODE: Partial<Record<Mode, Costing>> = {
  walk: 'pedestrian',
  run: 'pedestrian',
  car: 'auto',
  bike: 'bicycle',
};

// A trip's terminal sections carry an anchor fix from the adjacent stay (the
// arrival/departure point segmentation pulls into the trip), but that fix can
// sit up to one resample interval PAST the section's persisted end_time_ms —
// so a [start,end]-bounded raw re-query silently drops it and the map-matched
// line stops short of the destination (tester: walk drawn ending ~60 m before
// the place he named). Stays last minutes, so widening the terminal sections'
// query by one resample interval can never leak the next trip's fixes.
const ANCHOR_MARGIN_MS = RULES.RESAMPLE.defaults.intervalMs;

// If the snapped line still ends farther than this from the raw trace's
// endpoint, splice the raw endpoint back on. The short unsnapped tail is far
// less wrong than a trip that visibly "never arrives".
const ENDPOINT_SPLICE_M = 25;

function spliceEndpoints(
  matched: Array<[number, number]>,
  input: Array<[number, number]>
): Array<[number, number]> {
  const out = [...matched];
  const [firstIn, lastIn] = [input[0]!, input[input.length - 1]!];
  const firstM = out[0]!;
  const lastM = out[out.length - 1]!;
  if (haversineMeters(firstIn[1], firstIn[0], firstM[1], firstM[0]) > ENDPOINT_SPLICE_M) {
    out.unshift(firstIn);
  }
  if (haversineMeters(lastIn[1], lastIn[0], lastM[1], lastM[0]) > ENDPOINT_SPLICE_M) {
    out.push(lastIn);
  }
  return out;
}

/**
 * Snap each walk/run/car/bike section onto the road network and persist the
 * result as the section's matched geometry. Re-reads sections from the DB so it
 * sees post-restructure state. Best-effort per section: any failure (or a
 * sub-threshold confidence) clears the match so the UI falls back to raw.
 */
async function mapMatchTripSections(
  deps: OverpassDeps,
  tripId: number
): Promise<void> {
  const maxAccM = RULES.ACCURACY_FILTER.defaults.maxAccuracyM;
  const { minConfidence, maxPoints } = RULES.MAP_MATCH.defaults;
  const sections = await getSectionsForTrip(deps.db, tripId);
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]!;
    if (sec.id == null) continue;
    const costing = COSTING_FOR_MODE[effectiveMode(sec)];
    if (!costing) {
      // Not a road mode (train/boat/subway/…): a snap left over from an
      // earlier pass — when this section was still `car` — is now wrong.
      await updateSectionMatchedGeometry(deps.db, sec.id, null);
      continue;
    }
    // Match on raw fixes, not the resampled trace (same rationale as Pass 1).
    // Terminal sections reach into the adjacent stay for their anchor fix.
    const fromMs = sec.startTimeMs - (i === 0 ? ANCHOR_MARGIN_MS : 0);
    const toMs = sec.endTimeMs + (i === sections.length - 1 ? ANCHOR_MARGIN_MS : 0);
    const rawFixes = (await getPointsInRange(deps.db, fromMs, toMs))
      .filter((p) => p.accuracyMeters <= maxAccM)
      .map((p) => [p.longitude, p.latitude] as [number, number]);
    const coords = rawFixes.length >= 2 ? rawFixes : coordsOf(sec.geojson);
    if (coords.length < 2) continue;
    const res = await mapMatch(
      { fetchFn: deps.fetchFn, minIntervalMs: deps.minIntervalMs },
      coords,
      costing,
      maxPoints
    );
    const ok =
      res != null &&
      res.coords.length >= 2 &&
      (res.confidence == null || res.confidence >= minConfidence);
    await updateSectionMatchedGeometry(
      deps.db,
      sec.id,
      ok
        ? JSON.stringify({
            type: 'LineString',
            coordinates: spliceEndpoints(res!.coords, coords),
          })
        : null
    );
  }
}
