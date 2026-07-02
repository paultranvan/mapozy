// src/db/__tests__/maintenance.test.ts
import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { ensureTransitCacheSchema } from '../transitCacheDb';
import { runDbMaintenance, maybeVacuum, RAW_RETENTION_MS } from '../maintenance';
import { insertRawPoint } from '../rawPoints';
import { countDiagnosticEvents } from '../diagnostics';
import { runPipeline } from '../../pipeline/runPipeline';
import type { Db } from '../client';

const NOW = 200 * 24 * 60 * 60 * 1000; // day 200

async function seedPoint(db: Db, tsMs: number, consumed: boolean) {
  await insertRawPoint(db, {
    timestampMs: tsMs,
    latitude: 45,
    longitude: 5,
    altitude: null,
    accuracyMeters: 5,
    speedMps: null,
    bearingDeg: null,
    batteryLevel: null,
    isCharging: false,
  });
  if (consumed) {
    await db.runAsync(`UPDATE raw_points SET consumed = 1 WHERE timestamp_ms = ?`, tsMs);
  }
}

async function pointCount(db: Db): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM raw_points`);
  return r?.n ?? 0;
}

describe('runDbMaintenance', () => {
  let db: Db;
  let cacheDb: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
    cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
  });

  it('purges only consumed raw points older than the retention window', async () => {
    await seedPoint(db, NOW - RAW_RETENTION_MS - 1000, true); // old + consumed → purged
    await seedPoint(db, NOW - RAW_RETENTION_MS - 500, false); // old but NOT consumed → kept
    await seedPoint(db, NOW - 1000, true); // recent → kept
    const res = await runDbMaintenance(db, cacheDb, NOW);
    expect(res?.pointsPurged).toBe(1);
    expect(await pointCount(db)).toBe(2);
  });

  it('writes a db_maintenance diagnostic event', async () => {
    await runDbMaintenance(db, cacheDb, NOW);
    expect(await countDiagnosticEvents(db, { type: 'db_maintenance' })).toBe(1);
  });

  it('is throttled to once per day', async () => {
    expect(await runDbMaintenance(db, cacheDb, NOW)).not.toBeNull();
    expect(await runDbMaintenance(db, cacheDb, NOW + 1000)).toBeNull();
    expect(await runDbMaintenance(db, cacheDb, NOW + 25 * 60 * 60 * 1000)).not.toBeNull();
  });

  it('runs without a cache db (external API disabled)', async () => {
    const res = await runDbMaintenance(db, null, NOW);
    expect(res).not.toBeNull();
    expect(res?.cache).toBeNull();
  });
});

describe('maybeVacuum', () => {
  it('vacuums when enough freelist pages accumulated, else skips', async () => {
    const db = createMockDb();
    await db.execAsync(`CREATE TABLE blob (id INTEGER PRIMARY KEY, v TEXT)`);
    // Small DB, nothing freed yet → skip.
    expect(await maybeVacuum(db)).toBe(false);
    // Insert then delete ~2 MB so >20% of pages land on the freelist.
    await db.runAsync(`INSERT INTO blob (v) VALUES (?)`, 'x'.repeat(2 * 1024 * 1024));
    await db.runAsync(`DELETE FROM blob`);
    expect(await maybeVacuum(db)).toBe(true);
    // Freelist reclaimed → next call skips again.
    expect(await maybeVacuum(db)).toBe(false);
  });
});

describe('pipeline wiring', () => {
  it('a completed pipeline run performs maintenance', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const NOW2 = 300 * 24 * 60 * 60 * 1000;
    await seedPoint(db, NOW2 - 60_000, false);
    await seedPoint(db, NOW2 - 30_000, false);
    await runPipeline(db, { upToMs: NOW2, nowMs: NOW2 });
    expect(await countDiagnosticEvents(db, { type: 'db_maintenance' })).toBe(1);
  });

  it('cache-open failure does not abort maintenance or raw purge', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const NOW2 = 300 * 24 * 60 * 60 * 1000;
    await seedPoint(db, NOW2 - 60_000, false);
    await seedPoint(db, NOW2 - 30_000, false);
    const transit = {
      db,
      cacheDb: async (): Promise<never> => { throw new Error('disk full'); },
      fetchFn: async (): Promise<never> => { throw new Error('offline'); },
    };
    await runPipeline(db, { upToMs: NOW2, nowMs: NOW2, transit });
    expect(await countDiagnosticEvents(db, { type: 'db_maintenance' })).toBe(1);
  });
});
