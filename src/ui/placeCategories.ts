import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PlaceCategory } from '../types';
import type { CustomCategory } from '../db/customCategories';

export interface CategoryMeta {
  key: string;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
}

// Colors are the exact coachCO2 purpose palette; icons are the closest
// MaterialCommunityIcons glyphs (Mapozy already uses MCI everywhere).
export const PLACE_CATEGORIES: CategoryMeta[] = [
  { key: 'home', label: 'Home', icon: 'home', color: '#C9883F' },
  { key: 'work', label: 'Work', icon: 'briefcase', color: '#8978FF' },
  { key: 'sport', label: 'Sport', icon: 'dumbbell', color: '#B3BF26' },
  { key: 'shopping', label: 'Shopping', icon: 'cart', color: '#FF7B5E' },
  { key: 'family', label: 'Family', icon: 'account-group', color: '#1CAAE8' },
  { key: 'entertainment', label: 'Leisure', icon: 'glass-cocktail', color: '#F85AA8' },
  { key: 'travel', label: 'Travel', icon: 'image-filter-hdr', color: '#15CACD' },
  { key: 'other', label: 'Other', icon: 'map-marker', color: '#A4A7AC' },
];

const BY_KEY = new Map(PLACE_CATEGORIES.map((c) => [c.key, c]));

export function categoryMeta(category: PlaceCategory | string | null): CategoryMeta {
  return (category ? BY_KEY.get(category) : undefined) ?? BY_KEY.get('other')!;
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
