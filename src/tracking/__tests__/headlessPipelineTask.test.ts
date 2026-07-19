import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertRawPoint } from '../../db/rawPoints';
import { makeHeadlessPipelineTask } from '../headlessPipelineTask';
import { syntheticTrip } from '../../pipeline/__tests__/_fixtures';

async function mkDb() {
  const db = createMockDb();
  await runMigrations(db);
  return db;
}

describe('headlessPipelineTask', () => {
  it('segments pending raw points into (draft) trips and logs a diagnostic', async () => {
    const db = await mkDb();
    const { points } = syntheticTrip();
    for (const p of points) {
      await insertRawPoint(db, {
        timestampMs: p.timestampMs,
        latitude: p.latitude,
        longitude: p.longitude,
        altitude: p.altitude,
        accuracyMeters: p.accuracyMeters,
        speedMps: p.speedMps,
        bearingDeg: p.bearingDeg,
        batteryLevel: p.batteryLevel,
        isCharging: p.isCharging,
      });
    }

    // RN invokes the task with its taskData map as FIRST argument — the
    // 2026-07-19 emulator run proved a naive injectable-param signature
    // receives that object and dies with "Object is not a function".
    await makeHeadlessPipelineTask(async () => db)({ taskData: true });

    const trips = await db.getAllAsync<{ id: number; draft: number }>(
      `SELECT id, draft FROM trips`
    );
    expect(trips.length).toBeGreaterThan(0);
    // Transit deps are passed, so trips land as drafts for the (foreground)
    // enrichment pass — the headless task itself must stay network-free.
    expect(trips.every((t) => t.draft === 1)).toBe(true);
    const diag = await db.getAllAsync<{ payload: string }>(
      `SELECT payload FROM tracker_diagnostics WHERE event_type='headless_pipeline_run'`
    );
    expect(diag.length).toBe(1);
    expect(JSON.parse(diag[0]!.payload).tripsInserted).toBe(trips.length);
  });

  it('never rejects — a failing db is swallowed (headless crash = ANR risk)', async () => {
    await expect(
      makeHeadlessPipelineTask(async () => {
        throw new Error('boom');
      })({})
    ).resolves.toBeUndefined();
  });

  it('is a cheap no-op when there is nothing to consume', async () => {
    const db = await mkDb();
    await makeHeadlessPipelineTask(async () => db)(undefined);
    const trips = await db.getAllAsync(`SELECT id FROM trips`);
    expect(trips).toEqual([]);
  });
});
