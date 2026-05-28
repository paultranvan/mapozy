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
  await FileSystem.deleteAsync(destPath, { idempotent: true });
  await db.execAsync(`VACUUM INTO '${sqlitePath}'`);

  return { destPath, filename };
}
