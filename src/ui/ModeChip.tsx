import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radii, DOMINANT_MODE_ICONS } from '@/theme/tokens';
import type { DominantMode } from '@/types';

export function ModeChip({
  mode,
  size = 38,
}: {
  mode: DominantMode;
  size?: number;
}) {
  const iconName = DOMINANT_MODE_ICONS[mode];
  return (
    <View
      style={[
        styles.chip,
        { width: size, height: size, backgroundColor: colors.mode[mode] },
      ]}
    >
      <MaterialCommunityIcons
        name={iconName as keyof typeof MaterialCommunityIcons.glyphMap}
        size={size * 0.55}
        color={colors.surface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radii.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
