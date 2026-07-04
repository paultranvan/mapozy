export type ActivityType =
  | 'still'
  | 'walking'
  | 'running'
  | 'on_bicycle'
  | 'in_vehicle'
  | 'unknown';

export type Mode =
  | 'car'
  | 'bike'
  | 'walk'
  | 'run'
  | 'bus'
  | 'train'
  | 'tram'
  | 'subway'
  | 'plane'
  | 'boat';
export type DominantMode = Mode | 'mixed';

// Why a section received its mode — for UI badges, debugging, and so a
// stronger signal can be made to outrank a weaker one during enrichment.
//   'activity'   — Android activity recognition (default for existing modes)
//   'speed'      — p75-speed fallback
//   'railmatch'  — trace follows OSM railway geometry
//   'station'    — endpoints matched transit stops / routes
//   'corridor'   — bus stops of one route line the trace (door-to-door bus)
//   'gap'        — underground subway gap converted to a section (Plan C)
//   'watermatch' — trace follows OSM waterway / ferry-route geometry
export type ModeSource =
  | 'activity'
  | 'speed'
  | 'railmatch'
  | 'station'
  | 'corridor'
  | 'gap'
  | 'watermatch'
  | 'manual';

// Why a trip could not be fully classified online (left as a `draft`).
export type DraftReason = 'offline' | 'rate_limited' | 'overpass_error';

export interface RawPoint {
  id: number;
  timestampMs: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracyMeters: number;
  speedMps: number | null;
  bearingDeg: number | null;
  batteryLevel: number | null;
  isCharging: boolean;
  consumed: boolean;
}

export interface RawActivity {
  id: number;
  timestampMs: number;
  type: ActivityType;
  confidence: number;
  consumed: boolean;
}

export type PlaceKind = 'auto' | 'user';
export const PLACE_CATEGORY_VALUES = [
  'home', 'work', 'sport', 'shopping',
  'family', 'entertainment', 'travel', 'other',
] as const;
export type PlaceCategory = (typeof PLACE_CATEGORY_VALUES)[number];

export interface Place {
  id: number;
  kind: PlaceKind;
  name: string | null;
  // Category key: a built-in PlaceCategory value (e.g. 'home') or 'custom:<id>'
  // referencing a row in the custom_categories table.
  category: string | null;
  latitude: number;
  longitude: number;
  radiusM: number;
  displayName: string | null;
  visitCount: number;
  firstSeenMs: number;
  lastSeenMs: number;
}

export interface Section {
  id?: number;
  tripId?: number;
  ordering: number;
  startTimeMs: number;
  endTimeMs: number;
  mode: Mode;
  distanceM: number;
  durationS: number;
  avgSpeedMps: number;
  maxSpeedMps: number;
  co2G: number;
  geojson: string;
  // Road-snapped geometry from Valhalla map-matching (LineString). NULL/absent
  // when not matched — the UI then renders `geojson`. Cosmetic only: distances
  // and aggregates are always computed from the raw `geojson`.
  matchedGeojson?: string | null;
  modeSource?: ModeSource;
  modeConfidence?: number;
  userMode?: Mode | null;
}

export interface TripBreak {
  id?: number;
  tripId?: number;
  ordering: number;
  startTimeMs: number;
  endTimeMs: number;
  centerLat: number;
  centerLon: number;
  gap?: boolean;
}

export interface Trip {
  id?: number;
  startTimeMs: number;
  endTimeMs: number;
  startPlaceId: number | null;
  endPlaceId: number | null;
  distanceM: number;
  durationS: number;
  dominantMode: DominantMode;
  co2G: number;
  geojson: string;
  manualPurpose: string | null;
  draft: boolean;
  draftReason: DraftReason | null;
  edited: boolean;
  locked: boolean;
  createdAtMs: number;
  sections: Section[];
  breaks: TripBreak[];
}
