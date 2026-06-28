import { shouldRunGivenMotion } from '../foregroundTrigger';

describe('shouldRunGivenMotion', () => {
  it('blocks while moving (avoid fragmenting an in-progress trip)', () => {
    expect(shouldRunGivenMotion('moving')).toBe(false);
  });

  it('runs while stationary', () => {
    expect(shouldRunGivenMotion('stationary')).toBe(true);
  });

  it('runs when motion state is unknown', () => {
    expect(shouldRunGivenMotion(null)).toBe(true);
  });
});
