import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { insertSection, getSectionsForTrip } from '../sections';
import type { Section } from '../../types';

async function makeTripRow(db: ReturnType<typeof createMockDb>): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO trips
       (start_time_ms, end_time_ms, start_place_id, end_place_id, distance_m,
        duration_s, dominant_mode, co2_g, geojson, manual_purpose, created_at_ms)
     VALUES (0,1,NULL,NULL,0,1,'car',0,'{}',NULL,0)`
  );
  return r.lastInsertRowId;
}

function baseSection(over: Partial<Section>): Section {
  return {
    ordering: 0,
    startTimeMs: 0,
    endTimeMs: 1000,
    mode: 'train',
    distanceM: 100,
    durationS: 1,
    avgSpeedMps: 100,
    maxSpeedMps: 100,
    co2G: 2.4,
    geojson: '{"type":"LineString","coordinates":[]}',
    ...over,
  };
}

describe('sections DB — mode metadata round-trip', () => {
  it('persists and reads back mode_source / mode_confidence', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const tripId = await makeTripRow(db);

    await insertSection(
      db,
      tripId,
      baseSection({ modeSource: 'railmatch', modeConfidence: 0.92 })
    );

    const [s] = await getSectionsForTrip(db, tripId);
    expect(s!.mode).toBe('train');
    expect(s!.modeSource).toBe('railmatch');
    expect(s!.modeConfidence).toBeCloseTo(0.92, 5);
  });

  it('reads metadata as undefined when absent (legacy rows)', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const tripId = await makeTripRow(db);
    await insertSection(db, tripId, baseSection({}));

    const [s] = await getSectionsForTrip(db, tripId);
    expect(s!.modeSource).toBeUndefined();
    expect(s!.modeConfidence).toBeUndefined();
  });
});
