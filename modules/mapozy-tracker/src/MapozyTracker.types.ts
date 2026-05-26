export type ActivityType =
  | 'still'
  | 'walking'
  | 'running'
  | 'on_bicycle'
  | 'in_vehicle'
  | 'unknown';

// Per-install knobs only. The interval/distance-filter knobs that used to
// live here moved into native-side TrackingRules.LocationProfile — they are
// rule parameters now, not user config.
export interface TrackingConfig {
  desiredAccuracy: 'high' | 'balanced';
  activityIntervalMs: number;
  foregroundNotificationTitle: string;
  foregroundNotificationBody: string;
}

export interface LocationUpdate {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracyMeters: number;
  speedMps: number | null;
  bearingDeg: number | null;
  timestampMs: number;
  batteryLevel: number;
  isCharging: boolean;
}

export interface ActivityUpdate {
  type: ActivityType;
  confidence: number;
  timestampMs: number;
}

export interface TrackingStatus {
  isTracking: boolean;
  lastLocationAt: number | null;
  lastActivityType: ActivityType | null;
}
