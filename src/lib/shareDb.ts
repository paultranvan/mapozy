import * as Sharing from 'expo-sharing';
import type { Db } from '@/db/client';
import { prepareDbExport } from './exportDb';

export async function shareDb(db: Db): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }

  const { destPath } = await prepareDbExport(db);

  await Sharing.shareAsync(destPath, {
    mimeType: 'application/vnd.sqlite3',
    dialogTitle: 'Share Mapozy database',
    UTI: 'public.database',
  });
}
