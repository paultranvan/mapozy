import type { Db } from '../db/client';
import { haversineMeters } from './distance';
import { externalFetch } from './net';

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

export interface WaterWay {
  id: number;
  water: string; // river | canal | fairway | ferry
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
// only fail once they all reject. Responsiveness order, measured 2026-07-15
// on a worst-case rail query: overpass-api.de 504'd in ~8 s, openstreetmap.fr
// answered in ~1.5 s, kumi.systems hung ~90 s (eating the whole 75 s client
// timeout before the chain could move on) — kumi stays last-resort only.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
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
  const doFetch = deps.fetchFn ?? externalFetch;
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
function wayCoords(e: any): Array<[number, number]> {
  if (!Array.isArray(e.geometry)) return [];
  return e.geometry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((g: any) => g && typeof g.lat === 'number' && typeof g.lon === 'number')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((g: any) => [g.lon, g.lat] as [number, number]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseWays(elements: any[]): RailwayWay[] {
  const out: RailwayWay[] = [];
  for (const e of elements) {
    if (e.type !== 'way') continue;
    const railway = e.tags?.railway;
    if (!railway) continue;
    const coords = wayCoords(e);
    if (coords.length >= 2) out.push({ id: e.id, railway, coords });
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseWaterWays(elements: any[]): WaterWay[] {
  const out: WaterWay[] = [];
  for (const e of elements) {
    if (e.type !== 'way') continue;
    const water = e.tags?.waterway ?? (e.tags?.route === 'ferry' ? 'ferry' : null);
    if (!water) continue;
    const coords = wayCoords(e);
    if (coords.length >= 2) out.push({ id: e.id, water, coords });
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
// Max tiles per Overpass query. Chunks are merged into one bounding rect, so a
// diagonal path turns a big chunk into a huge query area: measured on the
// tester's Belgium trips, 12-tile rects returned multi-MB responses taking
// 60-80 s (and often 429/504) on public instances. 6 halves the area — more
// queries, but each fast and reliable, and every tile is cached either way.
const TILE_CHUNK = 6;
// Max bounding-rect area (in tiles) of one chunk query. Path-ordered slices
// used to merge 6 diagonal tiles into up to a 6×6-tile rect (2026-07-14
// export: 16-tile ≈ 485 km² rects that 504'd on public instances); bounding
// the rect keeps every query small even when the path runs diagonally. 9
// allows a 3×3 block (or a full 6×1 straight run via TILE_CHUNK).
const CHUNK_MAX_RECT_TILES = 9;

interface Tile {
  tx: number;
  ty: number;
}

function tileKey(prefix: string, t: Tile): string {
  return `${prefix}:${t.tx}:${t.ty}`;
}

function tileBBox(t: Tile): BBox {
  return {
    south: t.ty * TILE_DEG,
    west: t.tx * TILE_DEG,
    north: (t.ty + 1) * TILE_DEG,
    east: (t.tx + 1) * TILE_DEG,
  };
}

// Tiles containing the trace's fixes, in path order. ONLY point tiles:
// classification is point-based (coverageFraction / dominantRailMode measure
// each COORD's distance to ways, and per-tile PAD_DEG covers border-hugging
// ways), so tiles crossed mid-chord by a long GPS-gap segment can never
// influence the result. Interpolating them used to nearly triple the fetch
// load on sparse power-save train rides (2026-07-14 export: 85 vs ~30 tiles
// on one 305 km section).
function tilesForPath(coords: Array<[number, number]>): Tile[] {
  const seen = new Set<string>();
  const out: Tile[] = [];
  for (const [lon, lat] of coords) {
    const tx = Math.floor(lon / TILE_DEG);
    const ty = Math.floor(lat / TILE_DEG);
    const k = `${tx}:${ty}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ tx, ty });
    }
  }
  return out;
}

/**
 * Subsample a trace so its point tiles fit the given budget (first and last
 * fix always kept). Bounds the Overpass workload of one section: probing rail
 * coverage on ~evenly spaced fixes estimates the full-trace coverage without
 * fetching every tile of a multi-hundred-km corridor. Callers must use the
 * RETURNED coords for both the way fetch and the classification so the two
 * stay consistent.
 */
export function capCoordsToTileBudget(
  coords: Array<[number, number]>,
  maxTiles: number
): Array<[number, number]> {
  if (coords.length < 3 || tilesForPath(coords).length <= maxTiles) return coords;
  for (let stride = 2; ; stride *= 2) {
    const sampled: Array<[number, number]> = [];
    for (let i = 0; i < coords.length; i += stride) sampled.push(coords[i]!);
    if (sampled[sampled.length - 1] !== coords[coords.length - 1]) {
      sampled.push(coords[coords.length - 1]!);
    }
    if (tilesForPath(sampled).length <= maxTiles || sampled.length <= 2) return sampled;
  }
}

// Group tiles (path order, so consecutive ones are spatially close) into
// chunks of at most TILE_CHUNK tiles whose merged bounding rect stays at most
// CHUNK_MAX_RECT_TILES tiles — one bounded Overpass query per chunk.
function chunkTilesByProximity(tiles: Tile[]): Array<{ chunk: Tile[]; rect: BBox }> {
  const out: Array<{ chunk: Tile[]; rect: BBox }> = [];
  let chunk: Tile[] = [];
  let rect: BBox | null = null;
  for (const t of tiles) {
    const b = tileBBox(t);
    const merged: BBox = rect
      ? {
          south: Math.min(rect.south, b.south),
          west: Math.min(rect.west, b.west),
          north: Math.max(rect.north, b.north),
          east: Math.max(rect.east, b.east),
        }
      : b;
    const rectTiles =
      Math.round((merged.north - merged.south) / TILE_DEG) *
      Math.round((merged.east - merged.west) / TILE_DEG);
    if (chunk.length > 0 && (chunk.length >= TILE_CHUNK || rectTiles > CHUNK_MAX_RECT_TILES)) {
      out.push({ chunk, rect: rect! });
      chunk = [t];
      rect = b;
    } else {
      chunk.push(t);
      rect = merged;
    }
  }
  if (chunk.length > 0) out.push({ chunk, rect: rect! });
  return out;
}

function padBBox(b: BBox, pad: number): BBox {
  return { south: b.south - pad, west: b.west - pad, north: b.north + pad, east: b.east + pad };
}

function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

function wayBBox(w: { coords: Array<[number, number]> }): BBox {
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

function roundWay<W extends { coords: Array<[number, number]> }>(w: W): W {
  return { ...w, coords: w.coords.map(([lon, lat]) => [r5(lon), r5(lat)] as [number, number]) };
}

/**
 * Generic tiled way fetch: ways of some kind near a polyline, cached per fixed
 * 0.05° tile so near-identical trips share cache rows instead of re-querying
 * (and re-storing) whole per-trip bboxes. Missing tiles are fetched in chunks
 * of TILE_CHUNK via one bounding-rect query each; every fetched tile is
 * cached, empty ones included. Returned set is deduped by way id and may
 * extend slightly beyond the path's surroundings (harmless: callers measure
 * point-to-way distance).
 */
async function getWaysNearTiled<W extends { id: number; coords: Array<[number, number]> }>(
  deps: OverpassDeps,
  coords: Array<[number, number]>,
  keyPrefix: string,
  cacheKind: string,
  selectorFor: (b: BBox) => string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parse: (elements: any[]) => W[]
): Promise<W[]> {
  const now = (deps.nowMs ?? Date.now)();
  const tiles = tilesForPath(coords);
  const byId = new Map<number, W>();
  const missing: Tile[] = [];
  for (const t of tiles) {
    const cached = await cacheGet<W[]>(deps, tileKey(keyPrefix, t), now);
    if (cached === null) missing.push(t);
    else for (const w of cached) byId.set(w.id, w);
  }
  for (const { chunk, rect } of chunkTilesByProximity(missing)) {
    const q = padBBox(rect, PAD_DEG);
    const query = `[out:json][timeout:60];(${selectorFor(q)});out geom;`;
    const ways = parse(await overpassFetch(deps, query)).map(roundWay);
    for (const t of chunk) {
      // Pad the tile so border-hugging ways land in both neighbours.
      const padded = padBBox(tileBBox(t), PAD_DEG);
      const tileWays = ways.filter((w) => bboxIntersects(wayBBox(w), padded));
      await cacheSet(deps, tileKey(keyPrefix, t), cacheKind, tileWays, now);
      for (const w of tileWays) byId.set(w.id, w);
    }
  }
  return [...byId.values()];
}

/** Railway ways near a section's polyline (see getWaysNearTiled). */
export async function getRailwaysNear(
  deps: OverpassDeps,
  coords: Array<[number, number]>
): Promise<RailwayWay[]> {
  return getWaysNearTiled(
    deps,
    coords,
    'waystile',
    'ways',
    (b) =>
      `way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge)$"](${b.south},${b.west},${b.north},${b.east});`,
    parseWays
  );
}

/**
 * Navigable-water ways near a section's polyline: river/canal/fairway
 * centerlines plus mapped ferry routes. Same tile cache mechanics as railways
 * (distinct key prefix). Used by the boat classifier.
 */
export async function getWaterwaysNear(
  deps: OverpassDeps,
  coords: Array<[number, number]>
): Promise<WaterWay[]> {
  return getWaysNearTiled(
    deps,
    coords,
    'watertile',
    'waterways',
    (b) =>
      `way["waterway"~"^(river|canal|fairway)$"](${b.south},${b.west},${b.north},${b.east});` +
      `way["route"="ferry"](${b.south},${b.west},${b.north},${b.east});`,
    parseWaterWays
  );
}
