import { derivePipelineBannerState } from '../pipelineBannerState';

describe('derivePipelineBannerState', () => {
  it('computing takes priority even while moving', () => {
    expect(
      derivePipelineBannerState({ running: true, isTracking: true, motionState: 'moving', unconsumedCount: 5 })
    ).toBe('computing');
  });

  it('inProgress while tracking, moving, and not running', () => {
    expect(
      derivePipelineBannerState({ running: false, isTracking: true, motionState: 'moving', unconsumedCount: 5 })
    ).toBe('inProgress');
  });

  it('upToDate while stationary', () => {
    expect(
      derivePipelineBannerState({ running: false, isTracking: true, motionState: 'stationary', unconsumedCount: 3 })
    ).toBe('upToDate');
  });

  it('upToDate when not tracking, even though native motionState defaults to moving', () => {
    expect(
      derivePipelineBannerState({ running: false, isTracking: false, motionState: 'moving', unconsumedCount: 7 })
    ).toBe('upToDate');
  });

  it('upToDate when motion state is unknown', () => {
    expect(
      derivePipelineBannerState({ running: false, isTracking: false, motionState: null, unconsumedCount: 0 })
    ).toBe('upToDate');
  });
});
