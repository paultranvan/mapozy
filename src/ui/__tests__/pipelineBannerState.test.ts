import { derivePipelineBannerState } from '../pipelineBannerState';

describe('derivePipelineBannerState', () => {
  it('computing takes priority even while moving', () => {
    expect(
      derivePipelineBannerState({ running: true, enriching: false, isTracking: true, motionState: 'moving', unconsumedCount: 5 })
    ).toBe('computing');
  });

  it('computing takes priority over classifying', () => {
    expect(
      derivePipelineBannerState({ running: true, enriching: true, isTracking: true, motionState: 'moving', unconsumedCount: 5 })
    ).toBe('computing');
  });

  it('classifying while the background enrichment pass is active', () => {
    expect(
      derivePipelineBannerState({ running: false, enriching: true, isTracking: true, motionState: 'stationary', unconsumedCount: 0 })
    ).toBe('classifying');
  });

  it('classifying wins over inProgress — drafts explain the grey cards', () => {
    expect(
      derivePipelineBannerState({ running: false, enriching: true, isTracking: true, motionState: 'moving', unconsumedCount: 5 })
    ).toBe('classifying');
  });

  it('inProgress while tracking, moving, and not running', () => {
    expect(
      derivePipelineBannerState({ running: false, enriching: false, isTracking: true, motionState: 'moving', unconsumedCount: 5 })
    ).toBe('inProgress');
  });

  it('upToDate while stationary', () => {
    expect(
      derivePipelineBannerState({ running: false, enriching: false, isTracking: true, motionState: 'stationary', unconsumedCount: 3 })
    ).toBe('upToDate');
  });

  it('upToDate when not tracking, even though native motionState defaults to moving', () => {
    expect(
      derivePipelineBannerState({ running: false, enriching: false, isTracking: false, motionState: 'moving', unconsumedCount: 7 })
    ).toBe('upToDate');
  });

  it('upToDate when motion state is unknown', () => {
    expect(
      derivePipelineBannerState({ running: false, enriching: false, isTracking: false, motionState: null, unconsumedCount: 0 })
    ).toBe('upToDate');
  });
});
