import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PlaceCategory } from '../types';
import type { CustomCategory } from '../db/customCategories';
import { t, type TranslationKey } from '@/i18n';

export interface CategoryMeta {
  key: string;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
}

// Colors are the exact coachCO2 purpose palette; icons are the closest
// MaterialCommunityIcons glyphs (Mapozy already uses MCI everywhere).
// Labels are resolved through i18n at call time (see builtinCategories) so
// they follow the app language; custom categories keep their user-given name.
const BASE: Omit<CategoryMeta, 'label'>[] = [
  { key: 'home', icon: 'home', color: '#C9883F' },
  { key: 'work', icon: 'briefcase', color: '#8978FF' },
  { key: 'sport', icon: 'dumbbell', color: '#B3BF26' },
  { key: 'shopping', icon: 'cart', color: '#FF7B5E' },
  { key: 'family', icon: 'account-group', color: '#1CAAE8' },
  { key: 'entertainment', icon: 'glass-cocktail', color: '#F85AA8' },
  { key: 'travel', icon: 'image-filter-hdr', color: '#15CACD' },
  { key: 'other', icon: 'map-marker', color: '#A4A7AC' },
];

export function builtinCategories(): CategoryMeta[] {
  return BASE.map((c) => ({
    ...c,
    label: t(`category.${c.key}` as TranslationKey),
  }));
}

export function categoryMeta(category: PlaceCategory | string | null): CategoryMeta {
  const all = builtinCategories();
  return (category ? all.find((c) => c.key === category) : undefined) ?? all[all.length - 1]!;
}

export function customToMeta(c: CustomCategory): CategoryMeta {
  return {
    key: `custom:${c.id}`,
    label: c.name,
    icon: c.icon as keyof typeof MaterialCommunityIcons.glyphMap,
    color: c.color,
  };
}

/** Resolve a category key against a merged list (built-in + custom), else 'other'. */
export function resolveCategory(key: string | null, all: CategoryMeta[]): CategoryMeta {
  return (key ? all.find((c) => c.key === key) : undefined) ?? categoryMeta('other');
}
