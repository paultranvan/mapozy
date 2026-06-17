import { externalFetch } from './net';

// Valhalla map-matching client. Mirrors the shape of `overpass.ts`: a thin,
// injectable fetch + a module-level rate limiter. We use the FOSSGIS public
// OSM-community instance and the `trace_attributes` endpoint with
// `shape_match: map_snap`, which returns a road-snapped `shape` (encoded
// polyline, precision 6) plus a `confidence_score`.
//
// NOTE: verify the endpoint + usage policy on-device. The public instance is
// best-effort and may rate-limit; every failure here is non-fatal — the caller
// keeps the raw trace, never drafts the trip.

const ENDPOINT = 'https://valhalla1.openstreetmap.de/trace_attributes';
const USER_AGENT = 'mapozy/0.1.0 (personal use)';
const DEFAULT_MIN_INTERVAL_MS = 1100;
// Valhalla encodes shapes at precision 6 (not Google's 5).
const POLYLINE_PRECISION = 6;

export type Costing = 'pedestrian' | 'auto' | 'bicycle';

export interface ValhallaDeps {
  fetchFn?: typeof fetch;
  nowMs?: () => number;
  minIntervalMs?: number;
}

export interface MatchResult {
  /** Snapped geometry as [lon, lat] pairs (GeoJSON order). */
  coords: Array<[number, number]>;
  /** Valhalla confidence_score in [0,1], or null when the API omitted it. */
  confidence: number | null;
}

let lastFetchMs = 0;

async function rateLimit(minInterval: number, now: () => number): Promise<void> {
  if (minInterval <= 0) return;
  const wait = lastFetchMs + minInterval - now();
  lastFetchMs = now() + Math.max(0, wait); // claim the slot before yielding
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Decode a Google/Valhalla-style encoded polyline into [lon, lat] pairs.
 * `precision` is the number of decimal digits (6 for Valhalla, 5 for Google).
 */
export function decodePolyline(
  str: string,
  precision = POLYLINE_PRECISION
): Array<[number, number]> {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords: Array<[number, number]> = [];
  const factor = Math.pow(10, precision);
  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

/** Evenly downsample to at most `max` points, always keeping first and last. */
function downsample(
  coords: Array<[number, number]>,
  max: number
): Array<[number, number]> {
  if (coords.length <= max) return coords;
  const out: Array<[number, number]> = [];
  const step = (coords.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(coords[Math.round(i * step)]!);
  return out;
}

/**
 * Map-match a trace onto the road/path network. Returns the snapped geometry +
 * confidence, or `null` on ANY failure (offline, rate-limited, server error, no
 * snappable edges, malformed response). Never throws — map-matching is cosmetic
 * and must never cost the caller a draft or a thrown error.
 */
export async function mapMatch(
  deps: ValhallaDeps,
  coords: Array<[number, number]>,
  costing: Costing,
  maxPoints = 800
): Promise<MatchResult | null> {
  if (coords.length < 2) return null;
  const doFetch = deps.fetchFn ?? externalFetch;
  const now = deps.nowMs ?? Date.now;
  const input = downsample(coords, maxPoints);
  const body = JSON.stringify({
    shape: input.map(([lon, lat]) => ({ lat, lon })),
    costing,
    shape_match: 'map_snap',
  });
  try {
    await rateLimit(deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS, now);
    const resp = await doFetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      shape?: string;
      confidence_score?: number;
    };
    if (typeof json.shape !== 'string') return null;
    const decoded = decodePolyline(json.shape);
    if (decoded.length < 2) return null;
    const confidence =
      typeof json.confidence_score === 'number' ? json.confidence_score : null;
    return { coords: decoded, confidence };
  } catch {
    // Network error, disabled kill-switch, malformed JSON — all non-fatal.
    return null;
  }
}
