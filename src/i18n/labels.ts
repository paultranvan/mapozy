import { t, type TranslationKey } from './index';
import type { DominantMode } from '@/types';

// Localized display name for a transport mode ("Walk" / "Marche"). The
// catalogs carry one `mode.*` key per DominantMode value.
export function modeLabel(mode: DominantMode | string): string {
  return t(`mode.${mode}` as TranslationKey);
}
