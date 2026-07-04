import { useSyncExternalStore } from 'react';

export interface PipelineRunState {
  running: boolean;
  lastRunAt: number | null;
  lastTripsInserted: number | null;
  /** Background transit-classification pass is active. */
  enriching: boolean;
  /** Draft trips still waiting for classification in the active pass. */
  draftsPending: number;
}

let state: PipelineRunState = {
  running: false,
  lastRunAt: null,
  lastTripsInserted: null,
  enriching: false,
  draftsPending: 0,
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
    ...state,
    running: false,
    lastRunAt: Date.now(),
    lastTripsInserted: tripsInserted,
  };
  emit();
}

export function markEnrichmentProgress(draftsPending: number): void {
  state = { ...state, enriching: true, draftsPending };
  emit();
}

export function markEnrichmentEnd(): void {
  state = { ...state, enriching: false, draftsPending: 0 };
  emit();
}

export function usePipelineRunState(): PipelineRunState {
  return useSyncExternalStore(subscribePipelineRunState, getPipelineRunState);
}
