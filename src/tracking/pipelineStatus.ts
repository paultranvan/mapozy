import { useSyncExternalStore } from 'react';

export interface PipelineRunState {
  running: boolean;
  lastRunAt: number | null;
  lastTripsInserted: number | null;
}

let state: PipelineRunState = {
  running: false,
  lastRunAt: null,
  lastTripsInserted: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getPipelineRunState(): PipelineRunState {
  return state;
}

export function subscribePipelineRunState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function markPipelineRunStart(): void {
  state = { ...state, running: true };
  emit();
}

export function markPipelineRunEnd(tripsInserted: number): void {
  state = {
    running: false,
    lastRunAt: Date.now(),
    lastTripsInserted: tripsInserted,
  };
  emit();
}

export function usePipelineRunState(): PipelineRunState {
  return useSyncExternalStore(subscribePipelineRunState, getPipelineRunState);
}
