import * as FileSystem from 'expo-file-system';
import type { Db } from '@/db/client';
import { buildExportFilename } from './sendDbToPaulFilename';

export type DbExport = {
  destPath: string;
  filename: string;
};

export async function prepareDbExport(db: Db, now: Date = new Date()): Promise<DbExport> {
  const filename = buildExportFilename(now);
  const destPath = `${FileSystem.cacheDirectory}${filename}`;

  // VACUUM INTO produces an atomic, consistent snapshot of the entire DB at a
  // single point in time. It's immune to the race that broke the old
  // wal_checkpoint + raw file copy: native writers can extend the source while
  // copyAsync streams it, leaving the destination with a header that claims
  // more pages than were actually copied → "database disk image is malformed".
  //
  // expo-file-system uses file:// URIs but SQLite's VACUUM INTO wants a plain
  // filesystem path — strip the scheme for the SQL only, keep the URI for
  // FileSystem and Sharing APIs.
  const sqlitePath = destPath.replace(/^file:\/\//, '');
  await purgeStaleExports();
  await FileSystem.deleteAsync(destPath, { idempotent: true });
  // VACUUM INTO takes a string literal, not a bind parameter, so the path is
  // spliced into the statement: double any quote so it can never end the
  // literal early, whatever the cache directory happens to be called.
  await db.execAsync(`VACUUM INTO '${sqlitePath.replace(/'/g, "''")}'`);

  return { destPath, filename };
}

const EXPORT_FILE_RE = /^mapozy-export-.*\.db(-journal)?$/;

/**
 * Delete earlier exports from the cache directory. Each one is a complete,
 * unencrypted copy of the user's location history; once shared it has served
 * its purpose, and there is no reason to keep a growing pile of them around
 * until Android decides to evict the cache. Best effort — a failure here must
 * never block a new export.
 */
async function purgeStaleExports(): Promise<void> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;
  try {
    const names = await FileSystem.readDirectoryAsync(dir);
    for (const name of names) {
      if (EXPORT_FILE_RE.test(name)) {
        await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
      }
    }
  } catch {
    // ignore
  }
}
