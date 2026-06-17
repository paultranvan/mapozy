import type { Db } from './client';

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM settings WHERE key = ?`,
    key
  );
  return r?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}

export async function getAllSettings(db: Db): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM settings`
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export const SETTING_KEYS = {
  ONBOARDING_DONE: 'onboarding_done',
  TRACKING_ENABLED: 'tracking_enabled',
  TRACKING_SENSITIVITY: 'tracking_sensitivity',
  THEME: 'theme',
  LAST_HOMEWORK_DETECTION_MS: 'last_homework_detection_ms',
  LAST_KNOWN_PLACE_ID: 'last_known_place_id',
  LAST_AUTO_RESTART_AT: 'last_auto_restart_at',
  // When '1' (or unset = default), the app MAY make outbound calls — Overpass
  // (transit), Nominatim (place names), Valhalla (map-matching). When '0', all
  // are bypassed and trips fall back to local-only processing. See src/lib/net.ts.
  ALLOW_EXTERNAL_API: 'allow_external_api',
} as const;
