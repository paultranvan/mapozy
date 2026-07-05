/**
 * Mapozy design tokens — palette inspired by CoachCO2 / cozy-ui.
 *
 * Cool grey-100 canvas (#F3F6F9), white floating cards, bright iOS-blue
 * primary (#0A84FF), deep navy secondary (#243B55) used as a sparing accent
 * on chips and trip pins, vivid red for danger.
 */

import type { DominantMode, Mode } from '../types';

export const colors = {
  ground: '#F3F6F9',
  surface: '#FFFFFF',
  surfaceMuted: '#EDF2F7',
  ink: '#1A2230',
  inkSoft: '#5C6470',
  inkOnGround: '#1A2230',
  inkOnGroundSoft: 'rgba(26, 34, 48, 0.55)',
  divider: '#E3E4E5',
  accent: '#0A84FF',
  accentSoft: '#E3F1FF',
  danger: '#EA3F3F',
  dangerSurface: '#FFECEC',
  dangerBorder: '#FF939D',
  deep: '#243B55',
  // Trip start/end markers — cozy-ui successColor / errorColor.
  start: '#00C853',
  end: '#FF3347',
  mode: {
    walk: '#0A84FF',
    bike: '#15CACD',
    car: '#FF7B5E',
    run: '#00AD48',
    bus: '#F5A623',
    train: '#7B68EE',
    tram: '#20B2AA',
    subway: '#9370DB',
    plane: '#E5446D',
    boat: '#2E86AB',
    mixed: '#A4A7AC',
  } satisfies Record<DominantMode, string>,
} as const;

export const radii = {
  card: 16,
  sheet: 22,
  chip: 12,
  pill: 999,
} as const;

export const space = [0, 4, 8, 12, 16, 24, 32, 48] as const;

export type TypeVariant =
  | 'displayXL'
  | 'displayL'
  | 'display'
  | 'dayHeader'
  | 'numberM'
  | 'numberS'
  | 'title'
  | 'body'
  | 'meta'
  | 'label'
  | 'ribbon';

export const type: Record<
  TypeVariant,
  {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    letterSpacing?: number;
    fontWeight?: '400' | '500' | '600' | '700';
    textTransform?: 'uppercase' | 'none';
    fontVariant?: ('tabular-nums' | 'oldstyle-nums')[];
  }
> = {
  displayXL: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 56,
    lineHeight: 60,
    letterSpacing: -1.6,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  displayL: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.6,
    fontWeight: '600',
  },
  display: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.2,
    fontWeight: '600',
  },
  dayHeader: {
    fontFamily: 'Inter_500Medium',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '500',
  },
  numberM: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 19,
    lineHeight: 22,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  numberS: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  meta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '400',
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  ribbon: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.4,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
};

export const MODE_ICONS: Record<Mode, string> = {
  car: 'car',
  bike: 'bike',
  walk: 'walk',
  run: 'run',
  bus: 'bus',
  train: 'train',
  tram: 'tram',
  subway: 'subway',
  plane: 'airplane',
  boat: 'ferry',
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

export const MODE_COLORS = colors.mode;
