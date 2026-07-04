import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { ensureTransitCacheSchema } from '../../db/transitCacheDb';
import { runPipeline } from '../runPipeline';
import { planRecompute, recomputeForTrips } from '../recomputeRange';
import { listTrips } from '../../db/trips';
import { syntheticTrip } from './_fixtures';
import { insertRawPoint } from '../../db/rawPoints';
import { insertRawActivity } from '../../db/rawActivities';
import { refreshDraftTrips } from '../../tracking/refreshDrafts';
import type { OverpassDeps } from '../../lib/overpass';

function fakeResponse(body: unknown) {
  return { status: 200, ok: true, json: async () => body } as unknown as Response;
}

// Rail way covering the synthetic trip's drive leg (lat 45.0->45.018 at lon 5.0024).
function railFetch(): OverpassDeps['fetchFn'] {
  return async (_url, init) => {
    const body = String((init as RequestInit).body ?? '');
    if (body.includes('way%5B%22railway') || body.includes('way["railway')) {
      return fakeResponse({
        elements: [
          {
            type: 'way',
            id: 1,
            tags: { railway: 'rail' },
            geometry: [
              { lat: 45.0, lon: 5.0024 },
              { lat: 45.018, lon: 5.0024 },
            ],
          },
        ],
      });
    }
    return fakeResponse({ elements: [] });
  };
}

async function seed(db: ReturnType<typeof createMockDb>) {
  const { points, activities } = syntheticTrip();
  for (const p of points) await insertRawPoint(db, p);
  for (const a of activities) await insertRawActivity(db, a);
  return points[points.length - 1]!.timestampMs;
}

describe('recomputeForTrips — transit forwarding', () => {
  it('enriches recomputed trips when a transit dep is passed (drive -> train)', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const maxTs = await seed(db);

    // Initial run without transit: the drive is car.
    await runPipeline(db, { upToMs: maxTs + 1, nowMs: maxTs });
    const before = (await listTrips(db, 10, 0))[0]!;
    expect(before.dominantMode).toBe('car');

    // Recompute WITH a rail-returning transit dep: the rebuilt trip lands as a
    // pending draft (recompute itself stays local/fast), and the follow-up
    // draft pass — which the UI kicks right after — turns the drive into train.
    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    const transit: OverpassDeps = {
      db,
      cacheDb: async () => cacheDb,
      fetchFn: railFetch(),
      nowMs: () => 1,
      minIntervalMs: 0,
    };
    const plan = await planRecompute(db, [before.id!], maxTs + 1);
    const res = await recomputeForTrips(db, plan, maxTs, transit);

    const rebuilt = (await listTrips(db, 10, 0))[0]!;
    expect(rebuilt.draft).toBe(true);
    expect(res.pendingEnrichmentTripIds).toEqual([rebuilt.id]);

    await refreshDraftTrips(db, transit);

    const after = (await listTrips(db, 10, 0))[0]!;
    expect(after.dominantMode).toBe('train');
    expect(after.draft).toBe(false);
  });

  it('leaves trips as-is when no transit dep is passed (offline default)', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const maxTs = await seed(db);
    await runPipeline(db, { upToMs: maxTs + 1, nowMs: maxTs });
    const before = (await listTrips(db, 10, 0))[0]!;

    const plan = await planRecompute(db, [before.id!], maxTs + 1);
    await recomputeForTrips(db, plan, maxTs); // no transit dep

    const after = (await listTrips(db, 10, 0))[0]!;
    expect(after.dominantMode).toBe('car');
  });
});
