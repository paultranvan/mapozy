import { createMockDb } from '../mockDb';
import { ensureTransitCacheSchema } from '../transitCacheDb';
import { evictTransitCache, CACHE_CAP_BYTES } from '../maintenance';
import { CACHE_TTL_MS } from '../../lib/overpass';
import type { Db } from '../client';

const NOW = 100 * 24 * 60 * 60 * 1000; // day 100

async function put(db: Db, key: string, bytes: number, fetchedAt: number) {
  await db.runAsync(
    `INSERT INTO transit_cache (cell_key, kind, payload, fetched_at_ms) VALUES (?, 'ways', ?, ?)`,
    key,
    'x'.repeat(bytes),
    fetchedAt
  );
}

async function keys(db: Db): Promise<string[]> {
  return (
    await db.getAllAsync<{ cell_key: string }>(`SELECT cell_key FROM transit_cache ORDER BY cell_key`)
  ).map((r) => r.cell_key);
}

describe('evictTransitCache', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await ensureTransitCacheSchema(db);
  });

  it('deletes rows past the TTL, keeps fresh ones', async () => {
    await put(db, 'waystile:1:1', 10, NOW - CACHE_TTL_MS - 1);
    await put(db, 'waystile:2:2', 10, NOW - 1000);
    const r = await evictTransitCache(db, NOW);
    expect(await keys(db)).toEqual(['waystile:2:2']);
    expect(r.rowsDeleted).toBe(1);
    expect(r.bytesFreed).toBe(10);
  });

  it('deletes legacy pre-tiling ways:* keys regardless of age', async () => {
    await put(db, 'ways:45.1:5.1:45.2:5.2', 10, NOW - 1000);
    await put(db, 'stops:45.1:5.1', 10, NOW - 1000);
    await evictTransitCache(db, NOW);
    expect(await keys(db)).toEqual(['stops:45.1:5.1']);
  });

  it('evicts oldest-fetched rows until under the cap', async () => {
    const chunk = Math.ceil(CACHE_CAP_BYTES / 3) + 1024; // 3 rows ≈ over cap
    await put(db, 'waystile:1:1', chunk, NOW - 3000); // oldest
    await put(db, 'waystile:2:2', chunk, NOW - 2000);
    await put(db, 'waystile:3:3', chunk, NOW - 1000);
    await evictTransitCache(db, NOW);
    const left = await keys(db);
    expect(left).not.toContain('waystile:1:1');
    expect(left).toContain('waystile:3:3');
  });

  it('leaves a small fresh cache untouched', async () => {
    await put(db, 'waystile:1:1', 10, NOW - 1000);
    const r = await evictTransitCache(db, NOW);
    expect(r.rowsDeleted).toBe(0);
    expect(r.bytesFreed).toBe(0);
  });
});
