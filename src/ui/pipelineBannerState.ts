export type PipelineBannerState = 'computing' | 'classifying' | 'inProgress' | 'upToDate';

export interface BannerInput {
  running: boolean;
  enriching: boolean;
  isTracking: boolean;
  motionState: 'moving' | 'stationary' | null;
  unconsumedCount: number;
}

/**
 * Honest status model. We cannot cheaply know "a finished trip is waiting"
 * without re-running segmentation, so the banner reflects activity/freshness:
 *  - computing:   a pipeline run is in flight (highest priority). Local-only
 *                 and fast, so this state is short-lived.
 *  - classifying: the background transit-classification pass is walking draft
 *                 trips (network-bound — can take minutes). Trips are already
 *                 visible as drafts; this explains why some still look grey.
 *  - inProgress:  tracking AND moving — a trip is being recorded and will
 *                 appear once it ends. Not actionable.
 *  - upToDate:    idle (stationary, or not tracking). Always tappable to
 *                 recompute.
 * The `isTracking` guard matters: the native motionState defaults to 'moving'
 * on a fresh install, so without it a not-yet-tracking device would show the
 * non-actionable "in progress" banner and hide the manual recompute.
 * `unconsumedCount` is shown only as de-emphasised detail on upToDate; a small
 * residual is expected at a stay and must not read as "new trips pending".
 */
export function derivePipelineBannerState(input: BannerInput): PipelineBannerState {
  if (input.running) return 'computing';
  if (input.enriching) return 'classifying';
  if (input.isTracking && input.motionState === 'moving') return 'inProgress';
  return 'upToDate';
}
