import { deriveHealth, HealthInputs } from '../health';

const MINUTE = 60_000;
const NOW = 1_700_000_000_000;

function inputs(overrides: Partial<HealthInputs> = {}): HealthInputs {
  return {
    trackingEnabledSetting: true,
    isTracking: true,
    lastLocationAt: NOW - 2 * MINUTE,
    lastActivityAt: NOW - 5 * MINUTE,
    lastArSilenceDetectedAt: null,
    lastAutoRestartAt: null,
    ...overrides,
  };
}

describe('deriveHealth', () => {
  it('off: setting disabled overrides everything', () => {
    const r = deriveHealth(inputs({ trackingEnabledSetting: false }), NOW);
    expect(r.state.kind).toBe('off');
  });

  it('stopped: setting on, native off', () => {
    const r = deriveHealth(inputs({ isTracking: false }), NOW);
    expect(r.state.kind).toBe('stopped');
  });

  it('healthy: both streams fresh', () => {
    const r = deriveHealth(inputs(), NOW);
    expect(r.state.kind).toBe('healthy');
    expect(r.gpsAge).toBe(2 * MINUTE);
    expect(r.activityAge).toBe(5 * MINUTE);
  });

  it('quiet via GPS at 15min', () => {
    const r = deriveHealth(inputs({ lastLocationAt: NOW - 15 * MINUTE }), NOW);
    expect(r.state.kind).toBe('quiet');
  });

  it('quiet via activity at 45min', () => {
    const r = deriveHealth(inputs({ lastActivityAt: NOW - 45 * MINUTE }), NOW);
    expect(r.state.kind).toBe('quiet');
  });

  it('healthy at exactly 9m GPS and 29m activity', () => {
    const r = deriveHealth(
      inputs({
        lastLocationAt: NOW - 9 * MINUTE,
        lastActivityAt: NOW - 29 * MINUTE,
      }),
      NOW
    );
    expect(r.state.kind).toBe('healthy');
  });

  it('quiet at exactly 10m GPS (lower bound inclusive)', () => {
    const r = deriveHealth(inputs({ lastLocationAt: NOW - 10 * MINUTE }), NOW);
    expect(r.state.kind).toBe('quiet');
  });

  it('stale via GPS at 70min', () => {
    const r = deriveHealth(inputs({ lastLocationAt: NOW - 70 * MINUTE }), NOW);
    expect(r.state.kind).toBe('stale');
  });

  it('stale via activity at 95min', () => {
    const r = deriveHealth(inputs({ lastActivityAt: NOW - 95 * MINUTE }), NOW);
    expect(r.state.kind).toBe('stale');
  });

  it('stale at exactly 60m GPS (lower bound inclusive)', () => {
    const r = deriveHealth(inputs({ lastLocationAt: NOW - 60 * MINUTE }), NOW);
    expect(r.state.kind).toBe('stale');
  });

  it('ar_silence_alert: silence detected 10min ago wins over otherwise-healthy', () => {
    const r = deriveHealth(
      inputs({ lastArSilenceDetectedAt: NOW - 10 * MINUTE }),
      NOW
    );
    expect(r.state.kind).toBe('ar_silence_alert');
  });

  it('ar_silence_alert decays after 60min', () => {
    const r = deriveHealth(
      inputs({ lastArSilenceDetectedAt: NOW - 70 * MINUTE }),
      NOW
    );
    expect(r.state.kind).toBe('healthy');
  });

  it('stopped wins over ar_silence_alert', () => {
    const r = deriveHealth(
      inputs({
        isTracking: false,
        lastArSilenceDetectedAt: NOW - 10 * MINUTE,
      }),
      NOW
    );
    expect(r.state.kind).toBe('stopped');
  });

  it('recentlyRestarted true at 15s', () => {
    const r = deriveHealth(inputs({ lastAutoRestartAt: NOW - 15_000 }), NOW);
    expect(r.recentlyRestarted).toBe(true);
    expect(r.restartedAt).toBe(NOW - 15_000);
  });

  it('recentlyRestarted false at 45s', () => {
    const r = deriveHealth(inputs({ lastAutoRestartAt: NOW - 45_000 }), NOW);
    expect(r.recentlyRestarted).toBe(false);
  });

  it('null lastLocationAt treated as infinitely stale', () => {
    const r = deriveHealth(
      inputs({ lastLocationAt: null, lastActivityAt: null }),
      NOW
    );
    expect(r.state.kind).toBe('stale');
    expect(r.gpsAge).toBeNull();
    expect(r.activityAge).toBeNull();
  });
});
