import type { Db } from './client';
import { getTripById, updateTripTotals } from './trips';
import { effectiveDominantMode, effectiveCo2Total } from '../pipeline/effectiveMode';
import { parseCoords, coordsToGeojson } from '../pipeline/edits/sectionGeometry';

/**
 * Recompute a trip's distance/co2/dominant/geojson from its current sections
 * (override-aware) and persist them. Use after any edit that changes section
 * modes or structure.
 */
export async function recomputeAndPersistTripAggregates(
  db: Db,
  tripId: number
): Promise<void> {
  const trip = await getTripById(db, tripId);
  if (!trip || trip.id == null) return;
  const sections = trip.sections;
  const distanceM = sections.reduce((s, x) => s + x.distanceM, 0);
  const dominantMode = effectiveDominantMode(sections);
  const co2G = effectiveCo2Total(sections);
  const allCoords: Array<[number, number]> = [];
  for (const s of sections) {
    for (const c of parseCoords(s.geojson)) allCoords.push(c);
  }
  await updateTripTotals(
    db,
    tripId,
    distanceM,
    co2G,
    dominantMode,
    coordsToGeojson(allCoords)
  );
}
