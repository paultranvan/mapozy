import { pathLengthMeters } from '../lib/distance';

export const RECORDING_WINDOW_MS = 5 * 60_000;
export const RECORDING_THRESHOLD_M = 50;

export type RecordingStatus = 'recording' | 'idle' | 'warning';

export interface RecordingInputs {
  trackingEnabledSetting: boolean;
  isTracking: boolean;
  recentPoints: Array<{ lat: number; lon: number }>;
}

export function deriveRecordingState(input: RecordingInputs): RecordingStatus {
  if (!input.trackingEnabledSetting || !input.isTracking) return 'warning';
  if (input.recentPoints.length < 2) return 'idle';
  const coords: Array<[number, number]> = input.recentPoints.map((p) => [
    p.lon,
    p.lat,
  ]);
  const meters = pathLengthMeters(coords);
  return meters >= RECORDING_THRESHOLD_M ? 'recording' : 'idle';
}
