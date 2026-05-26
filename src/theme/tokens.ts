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
  mode: {
    walk: '#21B930',
    bike: '#15CACD',
    car: '#FF7B5E',
    run: '#00AD48',
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
    fontFamily: 'Fraunces_500Medium',
    fontSize: 56,
    lineHeight: 60,
    letterSpacing: -1.6,
    fontVariant: ['tabular-nums'],
  },
  displayL: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.6,
  },
  display: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  dayHeader: {
    fontFamily: 'Fraunces_400Regular',
    fontSize: 22,
    lineHeight: 28,
  },
  numberM: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 19,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  },
  numberS: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 14,
    lineHeight: 18,
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
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.8,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
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

export const MODE_COLORS = colors.mode;
