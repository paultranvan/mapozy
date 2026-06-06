import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import { insertTripWithSections, getTripById } from '../../../db/trips';
import { snapshotUserModes, reapplyUserModes } from '../reapplyUserModes';
import type { Trip } from '../../../types';

function line(c: Array<[number, number]>) {
  return JSON.stringify({ type: 'LineString', coordinates: c });
}
function mkTrip(): Trip {
  return {
    id: 0,
    startTimeMs: 0,
    endTimeMs: 10_000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 1000,
    durationS: 10,
    dominantMode: 'car',
    co2G: 0,
    geojson: line([[0, 0], [0, 0.01]]),
    manualPurpose: null,
    draft: false,
    draftReason: null,
    edited: true,
    locked: false,
    createdAtMs: 0,
    sections: [
      {
        ordering: 0,
        startTimeMs: 0,
        endTimeMs: 10_000,
        mode: 'car',
        distanceM: 1000,
        durationS: 10,
        avgSpeedMps: 100,
        maxSpeedMps: 100,
        co2G: 0,
        geojson: line([[0, 0], [0, 0.01]]),
        userMode: 'train',
      },
    ],
    breaks: [],
  };
}

it('reapplies a user_mode to a rebuilt section with matching bounds', async () => {
  const db = createMockDb();
  await runMigrations(db);
  const id = await insertTripWithSections(db, mkTrip());
  const snap = await snapshotUserModes(db, [id]);
  expect(snap).toHaveLength(1);

  await db.runAsync(`DELETE FROM trips WHERE id = ?`, id);
  const rebuilt = mkTrip();
  rebuilt.sections[0]!.userMode = undefined;
  rebuilt.edited = false;
  const newId = await insertTripWithSections(db, rebuilt);

  await reapplyUserModes(db, snap);
  const out = (await getTripById(db, newId))!;
  expect(out.sections[0]!.userMode).toBe('train');
  expect(out.edited).toBe(true);
});

it('drops an override when no rebuilt section matches the bounds', async () => {
  const db = createMockDb();
  await runMigrations(db);
  const id = await insertTripWithSections(db, mkTrip());
  const snap = await snapshotUserModes(db, [id]);
  await db.runAsync(`DELETE FROM trips WHERE id = ?`, id);
  const rebuilt = mkTrip();
  rebuilt.sections[0]!.startTimeMs = 5; // shifted bounds → no match
  rebuilt.sections[0]!.userMode = undefined;
  const newId = await insertTripWithSections(db, rebuilt);
  await reapplyUserModes(db, snap);
  const out = (await getTripById(db, newId))!;
  expect(out.sections[0]!.userMode == null).toBe(true);
});
