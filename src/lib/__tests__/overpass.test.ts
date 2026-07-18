import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { ensureTransitCacheSchema } from '../../db/transitCacheDb';
import {
  getStopsNear,
  getRailwaysNear,
  capCoordsToTileBudget,
  OverpassRateLimitError,
  OverpassOfflineError,
  OverpassUnavailableError,
  type OverpassDeps,
} from '../overpass';

function fakeResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  return {
    status: init.status ?? 200,
    ok: init.ok ?? true,
    json: async () => body,
  } as unknown as Response;
}

async function mkDeps(
  fetchFn: OverpassDeps['fetchFn'],
  nowMs = 1_000_000
): Promise<OverpassDeps> {
  const db = createMockDb();
  await runMigrations(db);
  const cacheDb = createMockDb();
  await ensureTransitCacheSchema(cacheDb);
  return { db, cacheDb: async () => cacheDb, fetchFn, nowMs: () => nowMs, minIntervalMs: 0 };
}

describe('overpass — getStopsNear', () => {
  const stopsBody = {
    elements: [
      { type: 'node', id: 1, lat: 45.0, lon: 5.0, tags: { railway: 'station', name: 'Gare' } },
      { type: 'node', id: 2, lat: 45.02, lon: 5.02, tags: { highway: 'bus_stop', route_ref: '12;38' } },
    ],
  };

  it('parses nodes and filters by radius', async () => {
    const deps = await mkDeps(async () => fakeResponse(stopsBody));
    const stops = await getStopsNear(deps, 45.0, 5.0, 70);
    // Only the station at the exact point is within 70 m; the bus stop ~2.5 km away is filtered out.
    expect(stops.map((s) => s.id)).toEqual([1]);
    expect(stops[0]!.railway).toBe('station');
  });

  it('caches the cell — a second call does not re-fetch', async () => {
    let calls = 0;
    const deps = await mkDeps(async () => {
      calls++;
      return fakeResponse(stopsBody);
    });
    await getStopsNear(deps, 45.0, 5.0, 70);
    await getStopsNear(deps, 45.0, 5.0, 70);
    expect(calls).toBe(1);
  });

  it('falls back to the next endpoint when the first one errors', async () => {
    let calls = 0;
    const deps = await mkDeps(async () => {
      calls++;
      if (calls === 1) return fakeResponse({}, { status: 504, ok: false });
      return fakeResponse(stopsBody);
    });
    const stops = await getStopsNear(deps, 45.0, 5.0, 70);
    expect(calls).toBe(2); // first endpoint 504'd, second succeeded
    expect(stops.map((s) => s.id)).toEqual([1]);
  });

  it('tries mirrors in responsiveness order — kumi last', async () => {
    // Measured 2026-07-15 on a heavy rail query: overpass-api.de 504s in
    // ~8 s, openstreetmap.fr answers in ~1.5 s, kumi.systems HANGS ~90 s and
    // eats the whole 75 s client timeout — it must only ever be the last
    // resort.
    const urls: string[] = [];
    const deps = await mkDeps(async (url) => {
      urls.push(String(url));
      return fakeResponse({}, { status: 504, ok: false });
    });
    await getStopsNear(deps, 45.0, 5.0, 70).catch(() => {});
    expect(urls).toEqual([
      'https://overpass-api.de/api/interpreter',
      'https://overpass.openstreetmap.fr/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ]);
  });

  it('throws OverpassRateLimitError only after all endpoints 429', async () => {
    const deps = await mkDeps(async () => fakeResponse({}, { status: 429, ok: false }));
    await expect(getStopsNear(deps, 45.0, 5.0, 70)).rejects.toBeInstanceOf(
      OverpassRateLimitError
    );
  });

  it('throws OverpassOfflineError when fetch rejects', async () => {
    const deps = await mkDeps(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(getStopsNear(deps, 45.0, 5.0, 70)).rejects.toBeInstanceOf(
      OverpassOfflineError
    );
  });

  it('throws OverpassUnavailableError on a 5xx response', async () => {
    const deps = await mkDeps(async () => fakeResponse({}, { status: 503, ok: false }));
    await expect(getStopsNear(deps, 45.0, 5.0, 70)).rejects.toBeInstanceOf(
      OverpassUnavailableError
    );
  });

  it('throws OverpassUnavailableError when the body is not valid JSON', async () => {
    const badResp = {
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    } as unknown as Response;
    const deps = await mkDeps(async () => badResp);
    await expect(getStopsNear(deps, 45.0, 5.0, 70)).rejects.toBeInstanceOf(
      OverpassUnavailableError
    );
  });
});

describe('overpass — getRailwaysNear (tiled cache)', () => {
  const way = (id: number, pts: Array<[number, number]>) => ({
    type: 'way',
    id,
    tags: { railway: 'rail' },
    geometry: pts.map(([lon, lat]) => ({ lat, lon })),
  });

  it('fetches once for a path inside one tile, then serves from cache', async () => {
    let calls = 0;
    const deps = await mkDeps(async () => {
      calls++;
      return fakeResponse({ elements: [way(7, [[5.001, 45.001], [5.002, 45.002]])] });
    });
    const coords: Array<[number, number]> = [[5.001, 45.001], [5.002, 45.002]];
    const first = await getRailwaysNear(deps, coords);
    expect(first.map((w) => w.id)).toEqual([7]);
    expect(calls).toBe(1);
    const second = await getRailwaysNear(deps, coords);
    expect(second.map((w) => w.id)).toEqual([7]);
    expect(calls).toBe(1); // cache hit — no re-fetch
  });

  it('dedupes a way stored in several tiles', async () => {
    // Path crosses the 5.05 tile boundary → two tiles; the way spans both.
    const deps = await mkDeps(async () =>
      fakeResponse({ elements: [way(9, [[5.04, 45.001], [5.06, 45.001]])] })
    );
    const ways = await getRailwaysNear(deps, [[5.04, 45.001], [5.06, 45.001]]);
    expect(ways.map((w) => w.id)).toEqual([9]);
  });

  it('caches empty tiles — a railway-free area is not re-queried', async () => {
    let calls = 0;
    const deps = await mkDeps(async () => {
      calls++;
      return fakeResponse({ elements: [] });
    });
    await getRailwaysNear(deps, [[5.001, 45.001], [5.002, 45.002]]);
    await getRailwaysNear(deps, [[5.001, 45.001], [5.002, 45.002]]);
    expect(calls).toBe(1);
  });

  it('rounds stored coordinates to 5 decimals', async () => {
    const deps = await mkDeps(async () =>
      fakeResponse({ elements: [way(3, [[5.0012345678, 45.0019876543], [5.002, 45.002]])] })
    );
    const ways = await getRailwaysNear(deps, [[5.001, 45.001], [5.002, 45.002]]);
    expect(ways[0]!.coords[0]).toEqual([5.00123, 45.00199]);
  });

  it('fetches only tiles that contain fixes — mid-chord tiles are skipped', async () => {
    // Two fixes 3 tiles apart with nothing in between: classification is
    // point-based (coverageFraction measures each COORD's distance to ways,
    // and per-tile padding covers borders), so ways in tiles no fix sits in
    // can never influence the result — fetching them is pure Overpass load.
    // This was the main workload amplifier on long power-save train rides.
    const deps = await mkDeps(async () => {
      return fakeResponse({ elements: [] });
    });
    await getRailwaysNear(deps, [[5.01, 45.01], [5.16, 45.01]]); // tiles x=100 and x=103
    const cacheDb = await deps.cacheDb();
    const rows = await cacheDb.getAllAsync<{ cell_key: string }>(
      `SELECT cell_key FROM transit_cache ORDER BY cell_key`
    );
    expect(rows.map((r) => r.cell_key)).toEqual(['waystile:100:900', 'waystile:103:900']);
  });

  it('chunks large tile sets into several bounded Overpass queries', async () => {
    let calls = 0;
    const deps = await mkDeps(async () => {
      calls++;
      return fakeResponse({ elements: [] });
    });
    // 26 points 0.05° apart along lon → 26 tiles → ceil(26/6) = 5 queries
    // (TILE_CHUNK = 6 keeps each bounding-rect query small enough for loaded
    // public instances — see the constant's comment).
    const coords = Array.from({ length: 26 }, (_, i) => [5.001 + i * 0.05, 45.001] as [number, number]);
    await getRailwaysNear(deps, coords);
    expect(calls).toBe(5);
  });

  it('keeps every chunk query geographically compact on a diagonal path', async () => {
    // A diagonal path's consecutive tiles step +1 in BOTH axes; merging 6 of
    // them into one bounding rect used to cover a 6×6 = 36-tile area (the
    // 2026-07-14 export produced 16-tile ≈ 485 km² rects that 504'd on
    // public instances). Every query's bbox must stay ≤ ~9 tiles.
    const bodies: string[] = [];
    const deps = await mkDeps(async (_url, init) => {
      bodies.push(decodeURIComponent(String((init as RequestInit).body ?? '')));
      return fakeResponse({ elements: [] });
    });
    const coords = Array.from(
      { length: 12 },
      (_, i) => [5.001 + i * 0.05, 45.001 + i * 0.05] as [number, number]
    );
    await getRailwaysNear(deps, coords);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      const m = b.match(/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/);
      expect(m).not.toBeNull();
      const [south, west, north, east] = m!.slice(1).map(Number) as [number, number, number, number];
      // Subtract the fixed bbox padding, then measure in 0.05° tiles.
      const tilesLat = (north - south - 0.008) / 0.05;
      const tilesLon = (east - west - 0.008) / 0.05;
      expect(tilesLat * tilesLon).toBeLessThanOrEqual(9.01);
    }
  });
});

describe('overpass — capCoordsToTileBudget', () => {
  it('returns coords unchanged when they fit the budget', () => {
    const coords: Array<[number, number]> = [
      [5.001, 45.001],
      [5.002, 45.002],
    ];
    expect(capCoordsToTileBudget(coords, 24)).toEqual(coords);
  });

  it('subsamples a long trace down to the tile budget, keeping endpoints', () => {
    // 100 fixes spread over 100 distinct tiles along lon.
    const coords = Array.from(
      { length: 100 },
      (_, i) => [5.001 + i * 0.05, 45.001] as [number, number]
    );
    const capped = capCoordsToTileBudget(coords, 24);
    const tiles = new Set(capped.map(([lon, lat]) => `${Math.floor(lon / 0.05)}:${Math.floor(lat / 0.05)}`));
    expect(tiles.size).toBeLessThanOrEqual(24);
    expect(capped[0]).toEqual(coords[0]);
    expect(capped[capped.length - 1]).toEqual(coords[coords.length - 1]);
    // Every capped coord is a real input fix, in order.
    for (const c of capped) expect(coords).toContainEqual(c);
  });
});
