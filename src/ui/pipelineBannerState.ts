export type PipelineBannerState = 'computing' | 'inProgress' | 'upToDate';

export interface BannerInput {
  running: boolean;
  motionState: 'moving' | 'stationary' | null;
  unconsumedCount: number;
}

/**
 * Honest status model. We cannot cheaply know "a finished trip is waiting"
 * without re-running segmentation, so the banner reflects activity/freshness:
 *  - computing:  a pipeline run is in flight (highest priority).
 *  - inProgress: the device is moving — a trip is being recorded and will
 *                appear once it ends. Not actionable.
 *  - upToDate:   stationary / unknown and idle. Always tappable to recompute.
 * `unconsumedCount` is shown only as de-emphasised detail on upToDate; a small
 * residual is expected at a stay and must not read as "new trips pending".
 */
export function derivePipelineBannerState(input: BannerInput): PipelineBannerState {
  if (input.running) return 'computing';
  if (input.motionState === 'moving') return 'inProgress';
  return 'upToDate';
}
