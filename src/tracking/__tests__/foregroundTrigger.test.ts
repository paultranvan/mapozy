import {
  shouldRunPipelineOnAppStateChange,
  isIdleSinceLastPoint,
  shouldRunPipelineForForeground,
} from '../foregroundTrigger';

describe('shouldRunPipelineOnAppStateChange', () => {
  it('fires on background → active', () => {
    expect(shouldRunPipelineOnAppStateChange('active', 'background')).toBe(true);
  });

  it('fires on inactive → active', () => {
    expect(shouldRunPipelineOnAppStateChange('active', 'inactive')).toBe(true);
  });

  it('does not fire when staying active', () => {
    expect(shouldRunPipelineOnAppStateChange('active', 'active')).toBe(false);
  });

  it('does not fire on active → background', () => {
    expect(shouldRunPipelineOnAppStateChange('background', 'active')).toBe(false);
  });

  it('does not fire on background → inactive', () => {
    expect(shouldRunPipelineOnAppStateChange('inactive', 'background')).toBe(false);
  });
});

describe('isIdleSinceLastPoint', () => {
  const THRESHOLD = 30 * 60_000;
  const now = 1_700_000_000_000;

  it('reports idle when there is no last point', () => {
    expect(isIdleSinceLastPoint(null, now, THRESHOLD)).toBe(true);
  });

  it('reports idle when the last point is older than the threshold', () => {
    expect(isIdleSinceLastPoint(now - THRESHOLD - 1, now, THRESHOLD)).toBe(true);
  });

  it('reports idle when the last point is exactly the threshold old', () => {
    expect(isIdleSinceLastPoint(now - THRESHOLD, now, THRESHOLD)).toBe(true);
  });

  it('reports NOT idle when the last point is within the threshold', () => {
    expect(isIdleSinceLastPoint(now - 60_000, now, THRESHOLD)).toBe(false);
  });

  it('reports NOT idle for a freshly-recorded point', () => {
    expect(isIdleSinceLastPoint(now - 1000, now, THRESHOLD)).toBe(false);
  });
});

describe('shouldRunPipelineForForeground', () => {
  const IDLE = 30 * 60_000;
  const STALE = 12 * 60 * 60_000;
  const now = 1_700_000_000_000;

  it('fires when there are no unconsumed points', () => {
    expect(shouldRunPipelineForForeground(null, null, now, IDLE, STALE)).toBe(true);
  });

  it('fires when last point is older than the idle threshold', () => {
    const last = now - IDLE - 1;
    expect(shouldRunPipelineForForeground(last, last, now, IDLE, STALE)).toBe(true);
  });

  it('skips when last point is recent and oldest is also recent (active trip)', () => {
    expect(
      shouldRunPipelineForForeground(now - 60_000, now - 5 * 60_000, now, IDLE, STALE)
    ).toBe(false);
  });

  it('fires (bypass) when last point is recent but oldest is older than stale bypass', () => {
    expect(
      shouldRunPipelineForForeground(now - 60_000, now - STALE - 1, now, IDLE, STALE)
    ).toBe(true);
  });

  it('fires (bypass) when oldest is exactly the stale bypass threshold', () => {
    expect(
      shouldRunPipelineForForeground(now - 60_000, now - STALE, now, IDLE, STALE)
    ).toBe(true);
  });

  it('skips when oldest is just under the stale bypass and last point is recent', () => {
    expect(
      shouldRunPipelineForForeground(now - 60_000, now - STALE + 1000, now, IDLE, STALE)
    ).toBe(false);
  });
});
