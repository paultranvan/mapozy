import * as FileSystem from 'expo-file-system';
import { externalApiAllowed } from './net';
import {
  InvalidDatabaseError,
  preserveExternalApiOptOut,
  validateImportedDb,
} from './importDbValidation';

export { InvalidDatabaseError };

const SQLITE_DIR = `${FileSystem.documentDirectory}SQLite/`;
const TARGET = `${SQLITE_DIR}mapozy.db`;
const BACKUP = `${SQLITE_DIR}mapozy.db.preimport`;
// The candidate is copied here and vetted before it may replace TARGET. It
// has to live in the SQLite directory: that is where expo-sqlite opens files.
const STAGING_NAME = 'mapozy.db.importing';
const STAGING = `${SQLITE_DIR}${STAGING_NAME}`;

/** A database file plus the sidecars SQLite may leave next to it. A stale
 *  sidecar is not harmless: on the next open SQLite replays a leftover
 *  `-journal` / `-wal` INTO the main file, corrupting a freshly imported DB. */
const withSidecars = (path: string) => [path, `${path}-journal`, `${path}-wal`, `${path}-shm`];

async function removeAll(paths: string[]): Promise<void> {
  for (const p of paths) await FileSystem.deleteAsync(p, { idempotent: true });
}

export interface ImportDbResult {
  backupPath: string;
  sourceSize: number;
}

// Verify the first 16 bytes match the SQLite-3 file header ("SQLite format 3\0").
// Cheap defence against importing a totally wrong file (image, txt, truncated
// download) which would crash the app on the next openDb() and leave it in an
// unrecoverable state without an in-app restore path.
async function assertSqliteMagic(uri: string): Promise<void> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    length: 16,
    position: 0,
  });
  const header = globalThis.atob(b64);
  if (!header.startsWith('SQLite format 3')) {
    throw new InvalidDatabaseError('File is not a SQLite database');
  }
}

/**
 * Replace the app's SQLite file with the contents of `sourceUri`.
 *
 * Caller MUST stop the native tracking service and warn the user to close
 * + reopen the app — both the JS and native sides keep their own open
 * SQLite handles on the live mapozy.db, and writes from either after the
 * swap will corrupt the freshly imported file.
 *
 * A copy of the pre-import DB is left at `mapozy.db.preimport` for manual
 * recovery (open the DB through Files / adb pull and rename back).
 */
export async function importDb(sourceUri: string): Promise<ImportDbResult> {
  const info = await FileSystem.getInfoAsync(sourceUri, { size: true });
  if (!info.exists) throw new InvalidDatabaseError('Source file not found');
  const size = info.size ?? 0;
  if (size === 0) throw new InvalidDatabaseError('Source file is empty');

  await assertSqliteMagic(sourceUri);

  await FileSystem.makeDirectoryAsync(SQLITE_DIR, { intermediates: true });

  // Stage, then vet. Nothing below this block runs for a file we would not
  // trust as the live database, so a rejected import leaves the app untouched.
  await removeAll(withSidecars(STAGING));
  await FileSystem.copyAsync({ from: sourceUri, to: STAGING });
  try {
    await vetStagedDb();
  } catch (e) {
    await removeAll(withSidecars(STAGING));
    throw e instanceof InvalidDatabaseError
      ? e
      : new InvalidDatabaseError('File is not a readable SQLite database');
  }

  const currentInfo = await FileSystem.getInfoAsync(TARGET);
  if (currentInfo.exists) {
    await FileSystem.deleteAsync(BACKUP, { idempotent: true });
    await FileSystem.copyAsync({ from: TARGET, to: BACKUP });
  }

  // Remove the live file together with its journal/WAL sidecars (see
  // withSidecars), then promote the vetted copy — never the original source,
  // which could have changed since it was checked.
  await removeAll(withSidecars(TARGET));
  await FileSystem.moveAsync({ from: STAGING, to: TARGET });
  await removeAll(withSidecars(STAGING));

  return { backupPath: BACKUP, sourceSize: size };
}

/** Open the staged copy, validate it, and carry over the user's external-API
 *  opt-out. expo-sqlite is imported lazily so this module still loads under
 *  Node (tests) without the native module. */
async function vetStagedDb(): Promise<void> {
  const SQLite = await import('expo-sqlite');
  const staged = await SQLite.openDatabaseAsync(STAGING_NAME);
  try {
    await validateImportedDb(staged);
    await preserveExternalApiOptOut(staged, externalApiAllowed());
  } finally {
    await staged.closeAsync();
  }
}
