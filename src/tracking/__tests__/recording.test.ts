import {
  deriveRecordingState,
  RECORDING_THRESHOLD_M,
  type RecordingInputs,
} from '../recording';

function inputs(overrides: Partial<RecordingInputs> = {}): RecordingInputs {
  return {
    trackingEnabledSetting: true,
    isTracking: true,
    recentPoints: [],
    ...overrides,
  };
}

// 1 degree of latitude ~= 111_320 m at the equator. Build points along a
// north-south line so longitude cancels out and displacement is just dLat.
function lineNorth(meters: number, samples = 6) {
  const dLatPerMeter = 1 / 111_320;
  const stepMeters = meters / (samples - 1);
  return Array.from({ length: samples }, (_, i) => ({
    lat: 48.8 + i * stepMeters * dLatPerMeter,
    lon: 2.35,
  }));
}

describe('deriveRecordingState', () => {
  it('warning: tracking setting disabled', () => {
    expect(
      deriveRecordingState(inputs({ trackingEnabledSetting: false }))
    ).toBe('warning');
  });

  it('warning: native tracker stopped', () => {
    expect(deriveRecordingState(inputs({ isTracking: false }))).toBe(
      'warning'
    );
  });

  it('idle: no recent points (cold open)', () => {
    expect(deriveRecordingState(inputs({ recentPoints: [] }))).toBe('idle');
  });

  it('idle: only one point', () => {
    expect(
      deriveRecordingState(
        inputs({ recentPoints: [{ lat: 48.8, lon: 2.35 }] })
      )
    ).toBe('idle');
  });

  it('idle: displacement below threshold', () => {
    expect(
      deriveRecordingState(
        inputs({ recentPoints: lineNorth(RECORDING_THRESHOLD_M - 10) })
      )
    ).toBe('idle');
  });

  it('recording: displacement at threshold', () => {
    expect(
      deriveRecordingState(
        inputs({ recentPoints: lineNorth(RECORDING_THRESHOLD_M + 1) })
      )
    ).toBe('recording');
  });

  it('recording: clearly moving (~200 m)', () => {
    expect(
      deriveRecordingState(inputs({ recentPoints: lineNorth(200) }))
    ).toBe('recording');
  });
});
