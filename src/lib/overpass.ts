import type { Db } from '../db/client';
import { haversineMeters } from './distance';

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface TransitStop {
  id: number;
  lat: number;
  lon: number;
  railway?: string; // station | halt | tram_stop | subway_entrance
  station?: string; // subway | light_rail | tram | ...
  routeRef?: string; // route_ref tag (bus lines), e.g. "12;38"
  busStop: boolean;
  name?: string;
}

export interface RailwayWay {
  id: number;
  railway: string; // rail | light_rail | subway | tram | narrow_gauge
  coords: Array<[number, number]>; // [lon, lat]
}

export class OverpassRateLimitError extends Error {
  constructor() {
    super('Overpass rate limited (HTTP 429)');
    this.name = 'OverpassRateLimitError';
  }
}
export class OverpassOfflineError extends Error {
  constructor() {
    super('Overpass unreachable (offline)');
    this.name = 'OverpassOfflineError';
  }
}
export class OverpassUnavailableError extends Error {
  constructor(status: number) {
    super(`Overpass HTTP error ${status}`);
    this.name = 'OverpassUnavailableError';
  }
}

export interface OverpassDeps {
  db: Db;
  fetchFn?: typeof fetch;
  nowMs?: () => number; // for cache TTL; default Date.now
  minIntervalMs?: number; // rate-limit; default 1100, tests pass 0
}

// Heavy rail-geometry queries over dense areas frequently 429/504 on a single
// public instance, which would needlessly draft trips. Try mirrors in turn and
// only fail once they all reject.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];
const USER_AGENT = 'mapozy/0.1.0 (personal use)';
const DEFAULT_MIN_INTERVAL_MS = 1100;
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const GRID_DEG = 0.005; // ~500 m latitude cell
const PAD_DEG = 0.004; // bbox padding so any in-cell point's radius is covered

let lastFetchMs = 0;

function snap(v: number): number {
  return Math.floor(v / GRID_DEG) * GRID_DEG;
}
function snapBBox(b: BBox): BBox {
  return {
    south: Math.floor(b.south / GRID_DEG) * GRID_DEG,
    west: Math.floor(b.west / GRID_DEG) * GRID_DEG,
    north: Math.ceil(b.north / GRID_DEG) * GRID_DEG,
    east: Math.ceil(b.east / GRID_DEG) * GRID_DEG,
  };
}
function r5(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

async function cacheGet<T>(db: Db, key: string, now: number): Promise<T | null> {
  const row = await db.getFirstAsync<{ payload: string; fetched_at_ms: number }>(
    `SELECT payload, fetched_at_ms FROM transit_cache WHERE cell_key = ?`,
    key
  );
  if (!row) return null;
  if (now - row.fetched_at_ms > CACHE_TTL_MS) return null;
  return JSON.parse(row.payload) as T;
}

async function cacheSet(
  db: Db,
  key: string,
  kind: string,
  payload: unknown,
  now: number
): Promise<void> {
  await db.runAsync(
    `INSERT INTO transit_cache (cell_key, kind, payload, fetched_at_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cell_key) DO UPDATE SET
       payload = excluded.payload,
       kind = excluded.kind,
       fetched_at_ms = excluded.fetched_at_ms`,
    key,
    kind,
    JSON.stringify(payload),
    now
  );
}

async function rateLimit(minInterval: number): Promise<void> {
  if (minInterval <= 0) return;
  const wait = lastFetchMs + minInterval - Date.now();
  lastFetchMs = Date.now() + Math.max(0, wait); // claim the slot before yielding
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function overpassFetch(deps: OverpassDeps, query: string): Promise<any[]> {
  const doFetch = deps.fetchFn ?? fetch;
  // Track failure kinds across endpoints so the thrown error (and hence the
  // draft reason) reflects what actually went wrong.
  let saw429 = false;
  let sawServer = false;
  let lastStatus = 0;
  let sawNetwork = false;
  for (const endpoint of ENDPOINTS) {
    await rateLimit(deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
    let resp: Response;
    try {
      resp = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: 'data=' + encodeURIComponent(query),
      });
    } catch {
      sawNetwork = true;
      continue;
    }
    if (resp.status === 429) {
      saw429 = true;
      continue;
    }
    if (!resp.ok) {
      sawServer = true;
      lastStatus = resp.status;
      continue;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await resp.json()) as { elements?: any[] };
      return json.elements ?? [];
    } catch {
      sawServer = true;
      lastStatus = resp.status;
      continue;
    }
  }
  // All endpoints rejected. Prefer the most actionable reason.
  if (saw429) throw new OverpassRateLimitError();
  if (sawServer) throw new OverpassUnavailableError(lastStatus);
  if (sawNetwork) throw new OverpassOfflineError();
  throw new OverpassUnavailableError(lastStatus);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseStops(elements: any[]): TransitStop[] {
  const out: TransitStop[] = [];
  for (const e of elements) {
    if (e.type !== 'node' || typeof e.lat !== 'number' || typeof e.lon !== 'number') {
      continue;
    }
    const tags = e.tags ?? {};
    out.push({
      id: e.id,
      lat: e.lat,
      lon: e.lon,
      railway: tags.railway,
      station: tags.station,
      routeRef: tags.route_ref,
      busStop: tags.highway === 'bus_stop',
      name: tags.name,
    });
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseWays(elements: any[]): RailwayWay[] {
  const out: RailwayWay[] = [];
  for (const e of elements) {
    if (e.type !== 'way' || !Array.isArray(e.geometry)) continue;
    const railway = e.tags?.railway;
    if (!railway) continue;
    const coords = e.geometry
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((g: any) => g && typeof g.lat === 'number' && typeof g.lon === 'number')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((g: any) => [g.lon, g.lat] as [number, number]);
    if (coords.length >= 2) out.push({ id: e.id, railway, coords });
  }
  return out;
}

export async function getStopsNear(
  deps: OverpassDeps,
  lat: number,
  lon: number,
  radiusM: number
): Promise<TransitStop[]> {
  const now = (deps.nowMs ?? Date.now)();
  const key = `stops:${r5(snap(lat))}:${r5(snap(lon))}`;
  let stops = await cacheGet<TransitStop[]>(deps.db, key, now);
  if (stops === null) {
    const south = snap(lat) - PAD_DEG;
    const west = snap(lon) - PAD_DEG;
    const north = snap(lat) + GRID_DEG + PAD_DEG;
    const east = snap(lon) + GRID_DEG + PAD_DEG;
    const q =
      `[out:json][timeout:60];(` +
      `node["highway"="bus_stop"](${south},${west},${north},${east});` +
      `node["railway"~"^(station|halt|tram_stop|subway_entrance)$"](${south},${west},${north},${east});` +
      `node["public_transport"~"^(platform|stop_position)$"](${south},${west},${north},${east});` +
      `);out body;`;
    stops = parseStops(await overpassFetch(deps, q));
    await cacheSet(deps.db, key, 'stops', stops, now);
  }
  return stops.filter((s) => haversineMeters(lat, lon, s.lat, s.lon) <= radiusM);
}

export async function getRailwaysIn(
  deps: OverpassDeps,
  bbox: BBox
): Promise<RailwayWay[]> {
  const now = (deps.nowMs ?? Date.now)();
  const snapped = snapBBox(bbox);
  const key = `ways:${r5(snapped.south)}:${r5(snapped.west)}:${r5(snapped.north)}:${r5(snapped.east)}`;
  let ways = await cacheGet<RailwayWay[]>(deps.db, key, now);
  if (ways === null) {
    const { south, west, north, east } = snapped;
    const q =
      `[out:json][timeout:60];` +
      `way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge)$"](${south},${west},${north},${east});` +
      `out geom;`;
    ways = parseWays(await overpassFetch(deps, q));
    await cacheSet(deps.db, key, 'ways', ways, now);
  }
  return ways;
}
