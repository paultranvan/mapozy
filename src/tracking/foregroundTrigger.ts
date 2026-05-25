import type { AppStateStatus } from 'react-native';

export function shouldRunPipelineOnAppStateChange(
  next: AppStateStatus,
  prev: AppStateStatus
): boolean {
  return prev !== 'active' && next === 'active';
}
