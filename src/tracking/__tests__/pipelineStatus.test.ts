import {
  getPipelineRunState,
  subscribePipelineRunState,
  markPipelineRunStart,
  markPipelineRunEnd,
} from '../pipelineStatus';

describe('pipelineStatus store', () => {
  afterEach(() => {
    // reset to a clean end state between tests
    markPipelineRunEnd(0);
  });

  it('starts not running', () => {
    expect(getPipelineRunState().running).toBe(false);
  });

  it('marks running on start and clears on end, recording outcome', () => {
    markPipelineRunStart();
    expect(getPipelineRunState().running).toBe(true);
    markPipelineRunEnd(3);
    const s = getPipelineRunState();
    expect(s.running).toBe(false);
    expect(s.lastTripsInserted).toBe(3);
    expect(typeof s.lastRunAt).toBe('number');
  });

  it('notifies subscribers on change', () => {
    let calls = 0;
    const unsub = subscribePipelineRunState(() => {
      calls += 1;
    });
    markPipelineRunStart();
    markPipelineRunEnd(0);
    unsub();
    markPipelineRunStart();
    expect(calls).toBe(2);
  });
});
