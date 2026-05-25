import type { DominantMode, Mode } from '../types';

export const MODE_COLORS: Record<DominantMode, string> = {
  car: '#E76F51',
  bike: '#2A9D8F',
  walk: '#264653',
  run: '#E9C46A',
  mixed: '#8D99AE',
};

export const MODE_ICONS: Record<Mode, string> = {
  car: 'car',
  bike: 'bike',
  walk: 'walk',
  run: 'run',
};

export const DOMINANT_MODE_ICONS: Record<DominantMode, string> = {
  ...MODE_ICONS,
  mixed: 'transit-connection-variant',
};

export const PLACE_ICONS = {
  home: 'home',
  work: 'briefcase',
  pin: 'map-marker',
} as const;
