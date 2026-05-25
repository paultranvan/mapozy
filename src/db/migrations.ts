import type { Db } from './client';

const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS raw_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_ms INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  altitude REAL,
  accuracy_m REAL NOT NULL,
  speed_mps REAL,
  bearing_deg REAL,
  battery_level REAL,
  is_charging INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_raw_points_ts ON raw_points(timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_raw_points_consumed_ts ON raw_points(consumed, timestamp_ms);

CREATE TABLE IF NOT EXISTS raw_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_ms INTEGER NOT NULL,
  type TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_raw_activities_ts ON raw_activities(timestamp_ms);

CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  radius_m REAL NOT NULL DEFAULT 50,
  display_name TEXT,
  label TEXT,
  visit_count INTEGER NOT NULL DEFAULT 0,
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_places_latlon ON places(latitude, longitude);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time_ms INTEGER NOT NULL,
  end_time_ms INTEGER NOT NULL,
  start_place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
  end_place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
  distance_m REAL NOT NULL,
  duration_s INTEGER NOT NULL,
  dominant_mode TEXT NOT NULL,
  co2_g REAL NOT NULL DEFAULT 0,
  geojson TEXT NOT NULL,
  manual_purpose TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trips_start ON trips(start_time_ms);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  ordering INTEGER NOT NULL,
  start_time_ms INTEGER NOT NULL,
  end_time_ms INTEGER NOT NULL,
  mode TEXT NOT NULL,
  distance_m REAL NOT NULL,
  duration_s INTEGER NOT NULL,
  avg_speed_mps REAL NOT NULL,
  max_speed_mps REAL NOT NULL,
  co2_g REAL NOT NULL DEFAULT 0,
  geojson TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sections_trip ON sections(trip_id, ordering);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: MIGRATION_001 },
];

export async function getSchemaVersion(db: Db): Promise<number> {
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM _meta WHERE key='schema_version'`
    );
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}

export async function runMigrations(db: Db): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS _meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const current = await getSchemaVersion(db);
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      await db.execAsync(m.sql);
      await db.runAsync(
        `INSERT INTO _meta(key,value) VALUES('schema_version',?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        String(m.version)
      );
    }
  }
}
