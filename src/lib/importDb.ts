import * as FileSystem from 'expo-file-system';

const SQLITE_DIR = `${FileSystem.documentDirectory}SQLite/`;
const TARGET = `${SQLITE_DIR}mapozy.db`;
const TARGET_WAL = `${TARGET}-wal`;
const TARGET_SHM = `${TARGET}-shm`;
const BACKUP = `${SQLITE_DIR}mapozy.db.preimport`;

export interface ImportDbResult {
  backupPath: string;
  sourceSize: number;
}

export class InvalidDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDatabaseError';
  }
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

  const currentInfo = await FileSystem.getInfoAsync(TARGET);
  if (currentInfo.exists) {
    await FileSystem.deleteAsync(BACKUP, { idempotent: true });
    await FileSystem.copyAsync({ from: TARGET, to: BACKUP });
  }

  // Stale WAL/SHM from the prior DB would be interpreted as belonging to the
  // newly imported file on first open and produce "database disk image is
  // malformed". Wipe them; the imported DB carries its own journal state.
  await FileSystem.deleteAsync(TARGET_WAL, { idempotent: true });
  await FileSystem.deleteAsync(TARGET_SHM, { idempotent: true });
  await FileSystem.deleteAsync(TARGET, { idempotent: true });
  await FileSystem.copyAsync({ from: sourceUri, to: TARGET });

  return { backupPath: BACKUP, sourceSize: size };
}
