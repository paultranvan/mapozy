import { shouldRunPipelineOnAppStateChange } from '../foregroundTrigger';

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
