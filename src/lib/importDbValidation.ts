import type { Db } from '../db/client';
import { SETTING_KEYS } from '../db/settings';

/** Thrown when a file offered for import is not a usable Mapozy database. */
export class InvalidDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDatabaseError';
  }
}

// Tables created by the very first migration and never dropped since: every
// genuine Mapozy database has them, whatever app version exported it.
const REQUIRED_TABLES = ['_meta', 'raw_points', 'trips', 'sections', 'places', 'settings'];

/**
 * Vet a database file BEFORE it replaces the live one.
 *
 * An imported file is untrusted input — it arrives from a share sheet, an
 * email attachment, a download — and once swapped in it is opened on every
 * launch and written to by the tracker, with no in-app way back. So:
 *
 *  - it must be structurally sound (`quick_check`): a damaged or crafted file
 *    otherwise fails on the NEXT launch, leaving the app unable to start;
 *  - it must actually be a Mapozy database (core tables present);
 *  - it must carry no triggers or views. Mapozy's schema has never defined
 *    either, so any that exist were put there by whoever authored the file,
 *    and a trigger is SQL that would run silently on every GPS fix the
 *    tracker inserts from then on (rewriting or deleting the user's history).
 *
 * Throws InvalidDatabaseError; resolves when the file is acceptable.
 */
export async function validateImportedDb(db: Db): Promise<void> {
  let check: Record<string, unknown> | null;
  try {
    check = await db.getFirstAsync<Record<string, unknown>>('PRAGMA quick_check(1)');
  } catch {
    throw new InvalidDatabaseError('File is not a readable SQLite database');
  }
  if (!check || Object.values(check)[0] !== 'ok') {
    throw new InvalidDatabaseError('Database file is corrupted');
  }

  const objects = await db.getAllAsync<{ type: string; name: string }>(
    `SELECT type, name FROM sqlite_master WHERE type IN ('table', 'trigger', 'view')`
  );
  const tables = new Set(objects.filter((o) => o.type === 'table').map((o) => o.name));
  const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
  if (missing.length > 0) {
    throw new InvalidDatabaseError('File is not a Mapozy database');
  }
  if (objects.some((o) => o.type === 'trigger' || o.type === 'view')) {
    throw new InvalidDatabaseError(
      'Database contains triggers or views, which Mapozy never creates — refusing to import it'
    );
  }
}

/**
 * Carry the user's "no external API calls" choice across an import.
 *
 * `settings` travels with the imported file, so without this an import
 * silently replaces the kill switch with whatever the file's author had —
 * typically "allowed" — and the app starts sending coordinates to Overpass /
 * Nominatim / Valhalla again on the next launch, against an explicit opt-out.
 * Only the restrictive value is forced: importing never turns the switch ON.
 */
export async function preserveExternalApiOptOut(db: Db, currentlyAllowed: boolean): Promise<void> {
  if (currentlyAllowed) return;
  await db.runAsync(
    `INSERT INTO settings(key, value) VALUES(?, '0')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    SETTING_KEYS.ALLOW_EXTERNAL_API
  );
}
