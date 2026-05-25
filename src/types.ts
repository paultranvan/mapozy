export type ActivityType =
  | 'still'
  | 'walking'
  | 'running'
  | 'on_bicycle'
  | 'in_vehicle'
  | 'unknown';

export type Mode = 'car' | 'bike' | 'walk' | 'run';
export type DominantMode = Mode | 'mixed';

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

export interface Place {
  id: number;
  latitude: number;
  longitude: number;
  radiusM: number;
  displayName: string | null;
  label: 'home' | 'work' | null;
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
  createdAtMs: number;
  sections: Section[];
}
