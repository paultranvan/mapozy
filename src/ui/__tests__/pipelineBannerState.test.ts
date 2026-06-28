import { derivePipelineBannerState } from '../pipelineBannerState';

describe('derivePipelineBannerState', () => {
  it('computing takes priority even while moving', () => {
    expect(
      derivePipelineBannerState({ running: true, motionState: 'moving', unconsumedCount: 5 })
    ).toBe('computing');
  });

  it('inProgress while moving and not running', () => {
    expect(
      derivePipelineBannerState({ running: false, motionState: 'moving', unconsumedCount: 5 })
    ).toBe('inProgress');
  });

  it('upToDate while stationary', () => {
    expect(
      derivePipelineBannerState({ running: false, motionState: 'stationary', unconsumedCount: 3 })
    ).toBe('upToDate');
  });

  it('upToDate when motion state is unknown', () => {
    expect(
      derivePipelineBannerState({ running: false, motionState: null, unconsumedCount: 0 })
    ).toBe('upToDate');
  });
});
