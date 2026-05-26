import { MD3LightTheme, configureFonts, type MD3Theme } from 'react-native-paper';
import { colors, type as typeTokens } from './tokens';

const fontConfig = {
  displayLarge: typeTokens.displayXL,
  displayMedium: typeTokens.displayL,
  displaySmall: typeTokens.display,
  headlineLarge: typeTokens.displayL,
  headlineMedium: typeTokens.display,
  headlineSmall: typeTokens.display,
  titleLarge: { ...typeTokens.title, fontSize: 18, lineHeight: 24 },
  titleMedium: typeTokens.title,
  titleSmall: typeTokens.label,
  bodyLarge: { ...typeTokens.body, fontSize: 15, lineHeight: 22 },
  bodyMedium: typeTokens.body,
  bodySmall: typeTokens.meta,
  labelLarge: typeTokens.label,
  labelMedium: typeTokens.label,
  labelSmall: typeTokens.ribbon,
};

export const adriaticTheme: MD3Theme = {
  ...MD3LightTheme,
  dark: false,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.accent,
    onPrimary: colors.surface,
    primaryContainer: colors.accentSoft,
    onPrimaryContainer: colors.ink,
    secondary: colors.deep,
    onSecondary: colors.surface,
    background: colors.ground,
    onBackground: colors.ink,
    surface: colors.surface,
    onSurface: colors.ink,
    surfaceVariant: colors.surfaceMuted,
    onSurfaceVariant: colors.inkSoft,
    outline: colors.divider,
    outlineVariant: colors.divider,
    error: colors.danger,
    onError: colors.surface,
    elevation: {
      level0: 'transparent',
      level1: colors.surface,
      level2: colors.surface,
      level3: colors.surface,
      level4: colors.surface,
      level5: colors.surface,
    },
  },
  fonts: configureFonts({ config: fontConfig }),
};
