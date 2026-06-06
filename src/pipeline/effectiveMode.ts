import type { Mode, DominantMode, Section } from '../types';
import { dominantModeFor } from './dominantMode';
import { co2GramsForSection } from '../co2/compute';

/** The mode the user sees and that aggregates use: override wins over auto. */
export function effectiveMode(section: Section): Mode {
  return section.userMode ?? section.mode;
}

/** Dominant mode computed from effective (override-aware) section modes. */
export function effectiveDominantMode(sections: Section[]): DominantMode {
  return dominantModeFor(
    sections.map((s) => ({ mode: effectiveMode(s), distanceM: s.distanceM }))
  );
}

/** CO₂ total recomputed from effective modes (not the stored per-section co2). */
export function effectiveCo2Total(sections: Section[]): number {
  return sections.reduce(
    (sum, s) => sum + co2GramsForSection(effectiveMode(s), s.distanceM),
    0
  );
}
