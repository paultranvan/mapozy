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

// User POIs: places gain a `kind` discriminator ('auto' = clustering substrate,
// 'user' = a place the user declared), plus a free `name` and a `category`
// (home/work/sport/…). Existing rows stay 'auto'; the Places tab shows only
// kind='user'. `label` is retired from display logic but kept for back-compat.
const MIGRATION_008 = `
ALTER TABLE places ADD COLUMN kind TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE places ADD COLUMN name TEXT;
ALTER TABLE places ADD COLUMN category TEXT;
CREATE INDEX IF NOT EXISTS idx_places_kind ON places(kind);
`;

// Frequent-cluster suggestions can be dismissed by the user; a dismissed auto
// place never resurfaces as a suggestion.
const MIGRATION_009 = `
ALTER TABLE places ADD COLUMN suggestion_dismissed INTEGER NOT NULL DEFAULT 0;
`;

// User-defined place categories (reusable): name + MaterialCommunityIcons glyph
// + colour. A place's `category` stores 'custom:<id>' to reference one.
const MIGRATION_010 = `
CREATE TABLE IF NOT EXISTS custom_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
`;

// The transit cache moved to its own DB file (transit-cache.db, see
// src/db/transitCacheDb.ts). Nothing is transferred: it is disposable,
// re-downloadable data that was bloating exports and fragmenting this file.
const MIGRATION_011 = `
DROP TABLE IF EXISTS transit_cache;
`;

// Structured place addresses (captured from Nominatim addressdetails) so
// connectors can emit street/postcode/city/country without re-geocoding, plus a
// connector-agnostic ledger of trips already exported to an external service.
const MIGRATION_012 = `
ALTER TABLE places ADD COLUMN street TEXT;
ALTER TABLE places ADD COLUMN house_number TEXT;
ALTER TABLE places ADD COLUMN postal_code TEXT;
ALTER TABLE places ADD COLUMN city TEXT;
ALTER TABLE places ADD COLUMN country TEXT;

CREATE TABLE IF NOT EXISTS connector_travels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector_type TEXT NOT NULL,
  mapozy_trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  external_travel_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  UNIQUE(connector_type, mapozy_trip_id)
);
CREATE INDEX IF NOT EXISTS idx_connector_travels_trip ON connector_travels(mapozy_trip_id);
`;

// Mapozy recompute deletes+recreates trips with NEW ids, and the old
// mapozy_trip_id FK's ON DELETE CASCADE erased the dedup row along with it,
// so a previously-sent trip reappeared as a candidate and got re-sent to the
// connector. Places persist across a recompute (only trips are
// deleted/recreated), so dedup switches to a content signature keyed on
// stable place ids instead of the volatile trip id. This table is new
// (migration 012) and holds no production data, so drop+recreate is safe.
const MIGRATION_013 = `
DROP TABLE IF EXISTS connector_travels;
CREATE TABLE connector_travels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector_type TEXT NOT NULL,
  signature TEXT NOT NULL,
  mapozy_trip_id INTEGER,
  external_travel_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  UNIQUE(connector_type, signature)
);
CREATE INDEX IF NOT EXISTS idx_connector_travels_sig ON connector_travels(connector_type, signature);
`;

// The dedup signature format changed (place-ids -> content coords) once the
// connector switched to proximity detection. Any pre-release row was keyed by
// the old format and would no longer match, so clear the ledger. The connector
// never shipped a working send path, so there is no real sent-history to lose.
const MIGRATION_014 = `
DELETE FROM connector_travels;
`;

// A Tiime travel is not claimable on its own: it must be attached to a mileage
// expense report ("note de frais kilométrique"). The report is created right
// after the travel, so its outcome is tracked per sent travel rather than in a
// table of its own. `travel_body` stores the fully-computed snake-case travel
// (server-computed amount included) so a failed report can be replayed with a
// single call — without recreating the travel or recomputing an amount that
// could come back different.
const MIGRATION_015 = `
ALTER TABLE connector_travels ADD COLUMN travel_body TEXT;
ALTER TABLE connector_travels ADD COLUMN expense_report_id TEXT;
ALTER TABLE connector_travels ADD COLUMN expense_report_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE connector_travels ADD COLUMN expense_report_error TEXT;
`;

export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: MIGRATION_001 },
  { version: 2, sql: MIGRATION_002 },
  { version: 3, sql: MIGRATION_003 },
  { version: 4, sql: MIGRATION_004 },
  { version: 5, sql: MIGRATION_005 },
  { version: 6, sql: MIGRATION_006 },
  { version: 7, sql: MIGRATION_007 },
  { version: 8, sql: MIGRATION_008 },
  { version: 9, sql: MIGRATION_009 },
  { version: 10, sql: MIGRATION_010 },
  { version: 11, sql: MIGRATION_011 },
  { version: 12, sql: MIGRATION_012 },
  { version: 13, sql: MIGRATION_013 },
  { version: 14, sql: MIGRATION_014 },
  { version: 15, sql: MIGRATION_015 },
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
