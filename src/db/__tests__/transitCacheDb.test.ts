import { createMockDb } from '../mockDb';
import { ensureTransitCacheSchema } from '../transitCacheDb';

describe('transitCacheDb', () => {
  it('creates the transit_cache table, idempotently', async () => {
    const db = createMockDb();
    await ensureTransitCacheSchema(db);
    await ensureTransitCacheSchema(db); // second call must not throw
    await db.runAsync(
      `INSERT INTO transit_cache (cell_key, kind, payload, fetched_at_ms)
       VALUES (?, ?, ?, ?)`,
      'waystile:1:2',
      'ways',
      '[]',
      123
    );
    const row = await db.getFirstAsync<{ payload: string }>(
      `SELECT payload FROM transit_cache WHERE cell_key = ?`,
      'waystile:1:2'
    );
    expect(row?.payload).toBe('[]');
  });
});
