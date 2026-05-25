export type ActivityType =
  | 'still'
  | 'walking'
  | 'running'
  | 'on_bicycle'
  | 'in_vehicle'
  | 'unknown';

export interface TrackingConfig {
  distanceFilterMeters: number;
  minTimeIntervalMs: number;
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
