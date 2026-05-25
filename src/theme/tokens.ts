/**
 * Mapozy design tokens — single source of truth for the Adriatic identity.
 *
 * Locked in 2026-05-25-mapozy-redesign-design.md. Do not introduce parallel
 * colour palettes or a light theme — the Adriatic blue *is* the identity.
 */

import type { DominantMode, Mode } from '../types';

export const colors = {
  ground: '#163A57',
  surface: '#FFFFFF',
  surfaceMuted: '#F5F2EC',
  ink: '#1A2230',
  inkSoft: '#5C6470',
  inkOnGround: '#EAE3D0',
  inkOnGroundSoft: 'rgba(234, 227, 208, 0.65)',
  divider: '#ECEEF1',
  accent: '#C97A4A',
  accentSoft: '#EAD7C5',
  danger: '#A14037',
  mode: {
    walk: '#688A6D',
    bike: '#D9A24A',
    car: '#C97A4A',
    run: '#B85451',
    mixed: '#7C8FA4',
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
