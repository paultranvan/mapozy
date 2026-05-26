const GPS_QUIET_MS = 10 * 60_000;
const GPS_STALE_MS = 60 * 60_000;
const ACT_QUIET_MS = 30 * 60_000;
const ACT_STALE_MS = 90 * 60_000;
const AR_SILENCE_ALERT_WINDOW_MS = 60 * 60_000;
const RECENTLY_RESTARTED_MS = 30_000;

export interface HealthInputs {
  trackingEnabledSetting: boolean;
  isTracking: boolean;
  lastLocationAt: number | null;
  lastActivityAt: number | null;
  lastArSilenceDetectedAt: number | null;
  lastAutoRestartAt: number | null;
}

export type HealthState =
  | { kind: 'off' }
  | { kind: 'stopped' }
  | { kind: 'ar_silence_alert'; silenceDetectedAt: number }
  | { kind: 'stale'; gpsAge: number | null; activityAge: number | null }
  | { kind: 'quiet'; gpsAge: number | null; activityAge: number | null }
  | { kind: 'healthy'; gpsAge: number | null; activityAge: number | null };

export interface HealthSnapshot {
  state: HealthState;
  gpsAge: number | null;
  activityAge: number | null;
  recentlyRestarted: boolean;
  restartedAt: number | null;
}

function ageOrInfinite(at: number | null, nowMs: number): number {
  return at == null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - at);
}

function ageOrNull(at: number | null, nowMs: number): number | null {
  return at == null ? null : Math.max(0, nowMs - at);
}

export function deriveHealth(input: HealthInputs, nowMs: number): HealthSnapshot {
  const gpsAge = ageOrNull(input.lastLocationAt, nowMs);
  const activityAge = ageOrNull(input.lastActivityAt, nowMs);
  const gpsAgeInf = ageOrInfinite(input.lastLocationAt, nowMs);
  const activityAgeInf = ageOrInfinite(input.lastActivityAt, nowMs);

  const recentlyRestarted =
    input.lastAutoRestartAt != null &&
    nowMs - input.lastAutoRestartAt < RECENTLY_RESTARTED_MS;
  const restartedAt = input.lastAutoRestartAt;

  let state: HealthState;
  if (!input.trackingEnabledSetting) {
    state = { kind: 'off' };
  } else if (!input.isTracking) {
    state = { kind: 'stopped' };
  } else if (
    input.lastArSilenceDetectedAt != null &&
    nowMs - input.lastArSilenceDetectedAt < AR_SILENCE_ALERT_WINDOW_MS
  ) {
    state = {
      kind: 'ar_silence_alert',
      silenceDetectedAt: input.lastArSilenceDetectedAt,
    };
  } else if (gpsAgeInf >= GPS_STALE_MS || activityAgeInf >= ACT_STALE_MS) {
    state = { kind: 'stale', gpsAge, activityAge };
  } else if (gpsAgeInf >= GPS_QUIET_MS || activityAgeInf >= ACT_QUIET_MS) {
    state = { kind: 'quiet', gpsAge, activityAge };
  } else {
    state = { kind: 'healthy', gpsAge, activityAge };
  }

  return { state, gpsAge, activityAge, recentlyRestarted, restartedAt };
}
