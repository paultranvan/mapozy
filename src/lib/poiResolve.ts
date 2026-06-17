import { haversineMeters } from './distance';
import type { Place } from '../types';

/**
 * The user POI whose zone (center + radiusM) contains (lat, lon). When several
 * zones overlap the point, the one with the nearest center wins. Returns null
 * if the point is outside every user POI.
 */
export function nearestUserPoi(lat: number, lon: number, pois: Place[]): Place | null {
  let best: Place | null = null;
  let bestD = Infinity;
  for (const p of pois) {
    if (p.kind !== 'user') continue;
    const d = haversineMeters(lat, lon, p.latitude, p.longitude);
    if (d <= p.radiusM && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}
