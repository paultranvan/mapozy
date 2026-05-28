import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertDiagnosticEvent, DIAGNOSTIC_EVENTS } from '../../db/diagnostics';
import { getInterruptions } from '../interruptions';
import type { Db } from '../../db/client';

const MIN = 60_000;
const INTERVAL = 15 * MIN;
const NOW = 1_700_000_000_000;

describe('getInterruptions', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  it('reads diagnostics and returns a kill window', async () => {
    const last = NOW - 20 * INTERVAL;
    await insertDiagnosticEvent(db, last - INTERVAL, DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, null);
    await insertDiagnosticEvent(db, last, DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, null);
    await insertDiagnosticEvent(db, NOW, DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, null);

    const r = await getInterruptions(db, { intervalMs: INTERVAL, nowMs: NOW, sinceMs: NOW - 40 * INTERVAL });
    expect(r).toHaveLength(1);
    expect(r[0]!.startMs).toBe(last);
    expect(r[0]!.endMs).toBe(NOW);
    expect(r[0]!.cause).toBe('killed_recovered');
  });
});
