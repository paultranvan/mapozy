import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { ensureTransitCacheSchema } from '../../db/transitCacheDb';
import {
  getStopsNear,
  getRailwaysIn,
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

describe('overpass — getRailwaysIn', () => {
  it('parses way geometry into [lon,lat] coords', async () => {
    const body = {
      elements: [
        {
          type: 'way',
          id: 10,
          tags: { railway: 'rail' },
          geometry: [
            { lat: 45.0, lon: 5.0 },
            { lat: 45.01, lon: 5.0 },
          ],
        },
      ],
    };
    const db = createMockDb();
    await runMigrations(db);
    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    const deps: OverpassDeps = {
      db,
      cacheDb: async () => cacheDb,
      fetchFn: async () => fakeResponse(body),
      nowMs: () => 1_000_000,
      minIntervalMs: 0,
    };
    const ways = await getRailwaysIn(deps, {
      south: 44.99,
      west: 4.99,
      north: 45.02,
      east: 5.01,
    });
    expect(ways).toHaveLength(1);
    expect(ways[0]!.railway).toBe('rail');
    expect(ways[0]!.coords).toEqual([
      [5.0, 45.0],
      [5.0, 45.01],
    ]);
  });

  it('caches ways — a second call for the same area does not re-fetch', async () => {
    let calls = 0;
    const db = createMockDb();
    await runMigrations(db);
    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    const deps = {
      db,
      cacheDb: async () => cacheDb,
      fetchFn: async () => {
        calls++;
        return fakeResponse({
          elements: [
            { type: 'way', id: 10, tags: { railway: 'rail' },
              geometry: [ { lat: 45.0, lon: 5.0 }, { lat: 45.01, lon: 5.0 } ] },
          ],
        });
      },
      nowMs: () => 1_000_000,
      minIntervalMs: 0,
    };
    const bbox = { south: 44.99, west: 4.99, north: 45.02, east: 5.01 };
    await getRailwaysIn(deps, bbox);
    await getRailwaysIn(deps, bbox);
    expect(calls).toBe(1);
  });
});
