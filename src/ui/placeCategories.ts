import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PlaceCategory } from '../types';

export interface CategoryMeta {
  key: PlaceCategory;
  labelFr: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
}

// Colors are the exact coachCO2 purpose palette; icons are the closest
// MaterialCommunityIcons glyphs (Mapozy already uses MCI everywhere).
export const PLACE_CATEGORIES: CategoryMeta[] = [
  { key: 'home', labelFr: 'Maison', icon: 'home', color: '#C9883F' },
  { key: 'work', labelFr: 'Travail', icon: 'briefcase', color: '#8978FF' },
  { key: 'sport', labelFr: 'Sport', icon: 'dumbbell', color: '#B3BF26' },
  { key: 'shopping', labelFr: 'Achats', icon: 'cart', color: '#FF7B5E' },
  { key: 'family', labelFr: 'Proches', icon: 'account-group', color: '#1CAAE8' },
  { key: 'entertainment', labelFr: 'Loisirs', icon: 'glass-cocktail', color: '#F85AA8' },
  { key: 'travel', labelFr: 'Voyage', icon: 'image-filter-hdr', color: '#15CACD' },
  { key: 'other', labelFr: 'Autre', icon: 'map-marker', color: '#A4A7AC' },
];

const BY_KEY = new Map(PLACE_CATEGORIES.map((c) => [c.key, c]));

export function categoryMeta(category: PlaceCategory | null): CategoryMeta {
  return (category ? BY_KEY.get(category) : undefined) ?? BY_KEY.get('other')!;
}
