import { createMockDb } from '../mockDb';
import { runMigrations, getSchemaVersion } from '../migrations';

describe('migration 004', () => {
  it('adds draft columns to trips and metadata columns to sections', async () => {
    const db = createMockDb();
    await runMigrations(db);

    expect(await getSchemaVersion(db)).toBeGreaterThanOrEqual(4);

    const tripCols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(trips)`
    );
    const tripNames = tripCols.map((c) => c.name);
    expect(tripNames).toContain('draft');
    expect(tripNames).toContain('draft_reason');

    const sectionCols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(sections)`
    );
    const sectionNames = sectionCols.map((c) => c.name);
    expect(sectionNames).toContain('mode_source');
    expect(sectionNames).toContain('mode_confidence');
  });

  it('creates the transit_cache table', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const t = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='transit_cache'`
    );
    expect(t?.name).toBe('transit_cache');
  });
});
