import { Alert } from 'react-native';
import * as MailComposer from 'expo-mail-composer';
import Constants from 'expo-constants';
import { t } from '@/i18n';
import type { Db } from '@/db/client';
import { buildExportFilename } from './sendDbToPaulFilename';
import { prepareDbExport } from './exportDb';

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

  const now = new Date();
  const { destPath, filename } = await prepareDbExport(db, now);

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
    Alert.alert(t('sendDb.sentTitle'), t('sendDb.sentMessage'));
  } else if (result.status === MailComposer.MailComposerStatus.SAVED) {
    Alert.alert(t('sendDb.savedTitle'), t('sendDb.savedMessage'));
  } else {
    Alert.alert(t('sendDb.cancelledTitle'), t('sendDb.cancelledMessage'));
  }
}
