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

// Generic structured event log used by the native tracker to surface
// subscription health (AR subscribe/unsubscribe, silence detection, etc.)
// without coupling those signals to the hot tables. `event_type` is a free
// string; `payload` is opaque JSON-or-null so we can add new event shapes
// without further migrations.
const MIGRATION_002 = `
CREATE TABLE IF NOT EXISTS tracker_diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_ms INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_tracker_diagnostics_ts
  ON tracker_diagnostics(timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_tracker_diagnostics_type_ts
  ON tracker_diagnostics(event_type, timestamp_ms);
`;

// Breaks are short stops (5-30 min) that sit *inside* a trip rather than
// ending it. `ordering` is the section index that the break follows:
// break with ordering=k sits between section[k] and section[k+1].
const MIGRATION_003 = `
CREATE TABLE IF NOT EXISTS trip_breaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  ordering INTEGER NOT NULL,
  start_time_ms INTEGER NOT NULL,
  end_time_ms INTEGER NOT NULL,
  center_lat REAL NOT NULL,
  center_lon REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trip_breaks_trip
  ON trip_breaks(trip_id, ordering);
`;

// Public-transit detection (see docs/superpowers/specs/...transit...md):
//   - sections gain mode_source / mode_confidence so the UI/debug can show
//     *why* a section got its mode and so stronger signals outrank weaker.
//   - trips gain draft / draft_reason: a trip computed without network (or
//     when Overpass rate-limited) is saved 'draft' and re-enriched on refresh.
//   - transit_cache memoises Overpass stop/way lookups by geo-cell so repeat
//     traffic through an area never re-queries.
const MIGRATION_004 = `
ALTER TABLE sections ADD COLUMN mode_source TEXT;
ALTER TABLE sections ADD COLUMN mode_confidence REAL;
ALTER TABLE trips ADD COLUMN draft INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN draft_reason TEXT;

CREATE TABLE IF NOT EXISTS transit_cache (
  cell_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at_ms INTEGER NOT NULL
);
`;

// Subway gap detection: mark a break as gap-derived (a GPS dropout, i.e. a data
// gap) vs a real dwell, so transit enrichment can convert a gap between two
// metro stations into a subway section.
const MIGRATION_005 = `
ALTER TABLE trip_breaks ADD COLUMN gap INTEGER NOT NULL DEFAULT 0;
`;

// Trip editing (see docs/superpowers/specs/2026-06-06-trip-editing-design.md):
//   - sections.user_mode: a user override of the auto-detected mode. NULL = use
//     mode. effectiveMode = user_mode ?? mode.
//   - trips.edited: any manual edit happened (mode or structural) — drives the
//     "edited" badge and enables Reset to auto.
//   - trips.locked: trip was STRUCTURALLY edited (split/merge); excluded from
//     auto-recompute and transit refresh until Reset to auto.
const MIGRATION_006 = `
ALTER TABLE sections ADD COLUMN user_mode TEXT;
ALTER TABLE trips ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
`;

// Map-matching (Valhalla): a section can carry a road-snapped geometry computed
// online, stored ALONGSIDE the raw `geojson` so the map can draw the snapped
// line while the raw trace stays the source of truth for distances/aggregates.
// NULL = not matched (offline, low confidence, or non-snappable mode) → the UI
// falls back to the raw geojson.
const MIGRATION_007 = `
ALTER TABLE sections ADD COLUMN matched_geojson TEXT;
`;

export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: MIGRATION_001 },
  { version: 2, sql: MIGRATION_002 },
  { version: 3, sql: MIGRATION_003 },
  { version: 4, sql: MIGRATION_004 },
  { version: 5, sql: MIGRATION_005 },
  { version: 6, sql: MIGRATION_006 },
  { version: 7, sql: MIGRATION_007 },
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
