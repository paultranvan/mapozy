import { shouldRunGivenMotion } from '../foregroundTrigger';

describe('shouldRunGivenMotion', () => {
  it('blocks while tracking AND moving (avoid fragmenting a live trip)', () => {
    expect(shouldRunGivenMotion({ isTracking: true, motionState: 'moving' })).toBe(false);
  });

  it('runs while tracking and stationary', () => {
    expect(shouldRunGivenMotion({ isTracking: true, motionState: 'stationary' })).toBe(true);
  });

  it('runs when not tracking, even though native motionState defaults to moving', () => {
    expect(shouldRunGivenMotion({ isTracking: false, motionState: 'moving' })).toBe(true);
  });

  it('runs when motion state is unknown', () => {
    expect(shouldRunGivenMotion({ isTracking: false, motionState: null })).toBe(true);
  });
});
