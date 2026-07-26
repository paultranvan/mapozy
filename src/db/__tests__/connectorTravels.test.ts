import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import {
  recordSentTravel,
  getSentTripIds,
  isTripSent,
} from '../connectorTravels';

// connector_travels.mapozy_trip_id is a FK to trips(id) (migration 012), and
// the mock db runs with `PRAGMA foreign_keys = ON` (see mockDb.ts). So, as in
// breaks-gap.test.ts, tests need a real trips row to reference rather than an
// arbitrary hardcoded id.
async function makeTrip(db: ReturnType<typeof createMockDb>): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO trips
       (start_time_ms,end_time_ms,start_place_id,end_place_id,distance_m,
        duration_s,dominant_mode,co2_g,geojson,manual_purpose,created_at_ms)
     VALUES (0,1,NULL,NULL,0,1,'car',0,'{}',NULL,0)`
  );
  return r.lastInsertRowId;
}

describe('connectorTravels repo', () => {
  it('records a sent travel and reports it as sent', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const tripId = await makeTrip(db);
    expect(await isTripSent(db, 'tiime', tripId)).toBe(false);
    await recordSentTravel(db, 'tiime', tripId, '5560117', 1_700_000_000_000);
    expect(await isTripSent(db, 'tiime', tripId)).toBe(true);
    expect(await getSentTripIds(db, 'tiime')).toEqual(new Set([tripId]));
  });

  it('is idempotent on re-record (no duplicate row)', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const tripId = await makeTrip(db);
    await recordSentTravel(db, 'tiime', tripId, 'a', 1);
    await recordSentTravel(db, 'tiime', tripId, 'b', 2);
    expect(await getSentTripIds(db, 'tiime')).toEqual(new Set([tripId]));
  });
});
