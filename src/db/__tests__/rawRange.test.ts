import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import {
  insertRawPoint,
  markPointsConsumed,
  resetConsumedPointsInRange,
  consumeUnconsumedPointsInRange,
  countPointsInRange,
  getUnconsumedPointsInRange,
} from '../rawPoints';
import {
  insertRawActivity,
  markActivitiesConsumed,
  resetConsumedActivitiesInRange,
  consumeUnconsumedActivitiesInRange,
  getUnconsumedActivitiesInRange,
} from '../rawActivities';
import type { Db } from '../client';

function pt(t: number) {
  return {
    timestampMs: t,
    latitude: 45,
    longitude: 5,
    altitude: null,
    accuracyMeters: 5,
    speedMps: null,
    bearingDeg: null,
    batteryLevel: null,
    isCharging: false,
  };
}

describe('raw range helpers', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('countPointsInRange counts regardless of consumed flag', async () => {
    const id1 = await insertRawPoint(db, pt(1000));
    await insertRawPoint(db, pt(2000));
    await insertRawPoint(db, pt(9000)); // outside range
    await markPointsConsumed(db, [id1]);
    expect(await countPointsInRange(db, 500, 2500)).toBe(2);
    expect(await countPointsInRange(db, 100, 300)).toBe(0);
  });

  it('resetConsumedPointsInRange clears consumed only inside the range', async () => {
    const a = await insertRawPoint(db, pt(1000));
    const b = await insertRawPoint(db, pt(2000));
    const c = await insertRawPoint(db, pt(9000));
    await markPointsConsumed(db, [a, b, c]);
    const n = await resetConsumedPointsInRange(db, 500, 2500);
    expect(n).toBe(2);
    const unconsumed = await getUnconsumedPointsInRange(db, 0, 10_000);
    expect(unconsumed.map((p) => p.timestampMs).sort()).toEqual([1000, 2000]);
  });

  // Inclusive of endMs on purpose: the recompute span ends at the next trip's
  // start fix, which a gap-terminated trip needs to close its final gap stay.
  // recomputeForTrips re-consumes whatever the bounded re-run leaves behind.
  it('resetConsumedPointsInRange includes points exactly at both bounds', async () => {
    const a = await insertRawPoint(db, pt(1000));
    const b = await insertRawPoint(db, pt(2000));
    await markPointsConsumed(db, [a, b]);
    const n = await resetConsumedPointsInRange(db, 1000, 2000);
    expect(n).toBe(2);
  });

  it('consumeUnconsumed*InRange re-consume only inside the inclusive range', async () => {
    await insertRawPoint(db, pt(1000));
    await insertRawPoint(db, pt(2000));
    await insertRawPoint(db, pt(9000));
    expect(await consumeUnconsumedPointsInRange(db, 500, 2000)).toBe(2);
    const left = await getUnconsumedPointsInRange(db, 0, 10_000);
    expect(left.map((p) => p.timestampMs)).toEqual([9000]);

    await insertRawActivity(db, { timestampMs: 1000, type: 'still', confidence: 90 });
    await insertRawActivity(db, { timestampMs: 9000, type: 'still', confidence: 90 });
    expect(await consumeUnconsumedActivitiesInRange(db, 500, 2500)).toBe(1);
    const leftAct = await getUnconsumedActivitiesInRange(db, 0, 10_000);
    expect(leftAct.map((x) => x.timestampMs)).toEqual([9000]);
  });

  it('resetConsumedActivitiesInRange clears consumed only inside the range', async () => {
    const a = await insertRawActivity(db, { timestampMs: 1000, type: 'still', confidence: 90 });
    const b = await insertRawActivity(db, { timestampMs: 9000, type: 'still', confidence: 90 });
    await markActivitiesConsumed(db, [a, b]);
    const n = await resetConsumedActivitiesInRange(db, 500, 2500);
    expect(n).toBe(1);
    const unconsumed = await getUnconsumedActivitiesInRange(db, 0, 10_000);
    expect(unconsumed.map((x) => x.timestampMs)).toEqual([1000]);
  });
});
