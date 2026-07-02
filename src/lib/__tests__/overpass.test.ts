import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { ensureTransitCacheSchema } from '../../db/transitCacheDb';
import {
  getStopsNear,
  getRailwaysNear,
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

  it('covers tiles crossed mid-segment by long chords (subway gap interpolation)', async () => {
    // Two fixes 3 tiles apart with nothing in between: the middle tile must
    // still be fetched/cached, otherwise ways there would be invisible.
    let bboxes: string[] = [];
    const deps = await mkDeps(async (_url: any, init: any) => {
      bboxes.push(String(init.body));
      return fakeResponse({ elements: [] });
    });
    await getRailwaysNear(deps, [[5.01, 45.01], [5.16, 45.01]]); // tiles x=100..103
    const cacheDb = await deps.cacheDb();
    const rows = await cacheDb.getAllAsync<{ cell_key: string }>(
      `SELECT cell_key FROM transit_cache ORDER BY cell_key`
    );
    expect(rows.length).toBeGreaterThanOrEqual(4); // all crossed tiles cached
  });

  it('chunks large tile sets into several bounded Overpass queries', async () => {
    let calls = 0;
    const deps = await mkDeps(async () => {
      calls++;
      return fakeResponse({ elements: [] });
    });
    // 26 points 0.05° apart along lon → 26 tiles → ceil(26/12) = 3 queries.
    const coords = Array.from({ length: 26 }, (_, i) => [5.001 + i * 0.05, 45.001] as [number, number]);
    await getRailwaysNear(deps, coords);
    expect(calls).toBe(3);
  });
});
