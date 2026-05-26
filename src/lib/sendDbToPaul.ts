import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as MailComposer from 'expo-mail-composer';
import Constants from 'expo-constants';
import type { Db } from '@/db/client';
import { buildExportFilename } from './sendDbToPaulFilename';

export { buildExportFilename };

export async function sendDbToPaul(db: Db): Promise<void> {
  const recipient = process.env.EXPO_PUBLIC_DEBUG_EMAIL;
  if (!recipient) {
    throw new Error(
      'EXPO_PUBLIC_DEBUG_EMAIL is not set. Copy .env.example to .env and configure it.'
    );
  }
  if (!(await MailComposer.isAvailableAsync())) {
    throw new Error('No mail app is configured on this device.');
  }

  // Flush WAL into the main database file so the copy reflects all writes.
  await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');

  const sourcePath = `${FileSystem.documentDirectory}SQLite/mapozy.db`;
  const now = new Date();
  const filename = buildExportFilename(now);
  const destPath = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.copyAsync({ from: sourcePath, to: destPath });

  const version = Constants.expoConfig?.version ?? 'unknown';
  const isoNow = now.toISOString();
  const dateLabel = filename.replace('mapozy-export-', '').replace('.db', '');

  const result = await MailComposer.composeAsync({
    recipients: [recipient],
    subject: `Mapozy data export — ${dateLabel}`,
    body:
      `Hi Paul,\n\n` +
      `Attached is my Mapozy SQLite database for debugging.\n\n` +
      `App version: ${version}\n` +
      `Exported: ${isoNow}\n`,
    attachments: [destPath],
  });

  // Note: per expo-mail-composer docs, on Android the status is always
  // reported as SENT regardless of what the user actually did. The SAVED
  // and CANCELLED branches only fire on iOS / web.
  if (result.status === MailComposer.MailComposerStatus.SENT) {
    Alert.alert('Sent', 'Your data is on its way to Paul. Thanks!');
  } else if (result.status === MailComposer.MailComposerStatus.SAVED) {
    Alert.alert('Saved', 'The email was saved as a draft.');
  } else {
    Alert.alert('Cancelled', 'No email was sent.');
  }
}
