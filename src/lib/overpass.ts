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
  db: Db; // MAIN app db — enrichment reads trips/raw points from it
  cacheDb: () => Promise<Db>; // transit-cache.db provider (lazy, async open)
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
export const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const GRID_DEG = 0.005; // ~500 m latitude cell
const PAD_DEG = 0.004; // bbox padding so any in-cell point's radius is covered

let lastFetchMs = 0;

function snap(v: number): number {
  return Math.floor(v / GRID_DEG) * GRID_DEG;
}
function r5(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

async function cacheGet<T>(deps: OverpassDeps, key: string, now: number): Promise<T | null> {
  const db = await deps.cacheDb();
  const row = await db.getFirstAsync<{ payload: string; fetched_at_ms: number }>(
    `SELECT payload, fetched_at_ms FROM transit_cache WHERE cell_key = ?`,
    key
  );
  if (!row) return null;
  if (now - row.fetched_at_ms > CACHE_TTL_MS) return null;
  return JSON.parse(row.payload) as T;
}

async function cacheSet(
  deps: OverpassDeps,
  key: string,
  kind: string,
  payload: unknown,
  now: number
): Promise<void> {
  const db = await deps.cacheDb();
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
  let stops = await cacheGet<TransitStop[]>(deps, key, now);
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
    await cacheSet(deps, key, 'stops', stops, now);
  }
  return stops.filter((s) => haversineMeters(lat, lon, s.lat, s.lon) <= radiusM);
}

const TILE_DEG = 0.05; // ~5.5 km latitude — dedup unit for railway geometry
const TILE_CHUNK = 12; // max tiles per Overpass query (keeps responses small)

interface Tile {
  tx: number;
  ty: number;
}

function tileKey(t: Tile): string {
  return `waystile:${t.tx}:${t.ty}`;
}

function tileBBox(t: Tile): BBox {
  return {
    south: t.ty * TILE_DEG,
    west: t.tx * TILE_DEG,
    north: (t.ty + 1) * TILE_DEG,
    east: (t.tx + 1) * TILE_DEG,
  };
}

// Tiles crossed by the polyline, in path order. Endpoints alone can skip a
// tile when a segment is long (GPS gaps interpolate multi-km chords), so long
// segments are sampled every half-tile.
function tilesForPath(coords: Array<[number, number]>): Tile[] {
  const seen = new Set<string>();
  const out: Tile[] = [];
  const add = (lon: number, lat: number) => {
    const tx = Math.floor(lon / TILE_DEG);
    const ty = Math.floor(lat / TILE_DEG);
    const k = `${tx}:${ty}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ tx, ty });
    }
  };
  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i]!;
    add(lon, lat);
    if (i + 1 < coords.length) {
      const [lon2, lat2] = coords[i + 1]!;
      const span = Math.max(Math.abs(lon2 - lon), Math.abs(lat2 - lat));
      const steps = Math.ceil(span / (TILE_DEG / 2));
      for (let s = 1; s < steps; s++) {
        add(lon + ((lon2 - lon) * s) / steps, lat + ((lat2 - lat) * s) / steps);
      }
    }
  }
  return out;
}

function padBBox(b: BBox, pad: number): BBox {
  return { south: b.south - pad, west: b.west - pad, north: b.north + pad, east: b.east + pad };
}

function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

function wayBBox(w: RailwayWay): BBox {
  let south = 90;
  let west = 180;
  let north = -90;
  let east = -180;
  for (const [lon, lat] of w.coords) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  return { south, west, north, east };
}

function roundWay(w: RailwayWay): RailwayWay {
  return { ...w, coords: w.coords.map(([lon, lat]) => [r5(lon), r5(lat)] as [number, number]) };
}

/**
 * Railway ways near a section's polyline, cached per fixed 0.05° tile so
 * near-identical trips share cache rows instead of re-querying (and
 * re-storing) whole per-trip bboxes. Missing tiles are fetched in chunks of
 * TILE_CHUNK via one bounding-rect query each; every fetched tile is cached,
 * empty ones included. Returned set is deduped by way id and may extend
 * slightly beyond the path's surroundings (harmless: callers measure
 * point-to-way distance).
 */
export async function getRailwaysNear(
  deps: OverpassDeps,
  coords: Array<[number, number]>
): Promise<RailwayWay[]> {
  const now = (deps.nowMs ?? Date.now)();
  const tiles = tilesForPath(coords);
  const byId = new Map<number, RailwayWay>();
  const missing: Tile[] = [];
  for (const t of tiles) {
    const cached = await cacheGet<RailwayWay[]>(deps, tileKey(t), now);
    if (cached === null) missing.push(t);
    else for (const w of cached) byId.set(w.id, w);
  }
  for (let i = 0; i < missing.length; i += TILE_CHUNK) {
    const chunk = missing.slice(i, i + TILE_CHUNK);
    let rect = tileBBox(chunk[0]!);
    for (const t of chunk.slice(1)) {
      const b = tileBBox(t);
      rect = {
        south: Math.min(rect.south, b.south),
        west: Math.min(rect.west, b.west),
        north: Math.max(rect.north, b.north),
        east: Math.max(rect.east, b.east),
      };
    }
    const q = padBBox(rect, PAD_DEG);
    const query =
      `[out:json][timeout:60];` +
      `way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge)$"](${q.south},${q.west},${q.north},${q.east});` +
      `out geom;`;
    const ways = parseWays(await overpassFetch(deps, query)).map(roundWay);
    for (const t of chunk) {
      // Pad the tile so border-hugging ways land in both neighbours.
      const padded = padBBox(tileBBox(t), PAD_DEG);
      const tileWays = ways.filter((w) => bboxIntersects(wayBBox(w), padded));
      await cacheSet(deps, tileKey(t), 'ways', tileWays, now);
      for (const w of tileWays) byId.set(w.id, w);
    }
  }
  return [...byId.values()];
}
