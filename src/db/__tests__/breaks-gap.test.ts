import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { insertBreak, getBreaksForTrip } from '../breaks';

async function makeTrip(db: ReturnType<typeof createMockDb>): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO trips
       (start_time_ms,end_time_ms,start_place_id,end_place_id,distance_m,
        duration_s,dominant_mode,co2_g,geojson,manual_purpose,created_at_ms)
     VALUES (0,1,NULL,NULL,0,1,'car',0,'{}',NULL,0)`
  );
  return r.lastInsertRowId;
}

describe('trip_breaks gap column', () => {
  it('round-trips gap=true', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const tripId = await makeTrip(db);
    await insertBreak(db, tripId, {
      ordering: 0,
      startTimeMs: 0,
      endTimeMs: 1000,
      centerLat: 45,
      centerLon: 5,
      gap: true,
    });
    const [b] = await getBreaksForTrip(db, tripId);
    expect(b!.gap).toBe(true);
  });

  it('defaults gap to false', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const tripId = await makeTrip(db);
    await insertBreak(db, tripId, {
      ordering: 0,
      startTimeMs: 0,
      endTimeMs: 1000,
      centerLat: 45,
      centerLon: 5,
    });
    const [b] = await getBreaksForTrip(db, tripId);
    expect(b!.gap).toBe(false);
  });
});
