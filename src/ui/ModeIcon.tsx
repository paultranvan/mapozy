import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DOMINANT_MODE_ICONS, MODE_COLORS } from '../theme/colors';
import type { DominantMode } from '../types';

export function ModeIcon({
  mode,
  size = 20,
  color,
}: {
  mode: DominantMode;
  size?: number;
  color?: string;
}) {
  const name = DOMINANT_MODE_ICONS[mode];
  return (
    <MaterialCommunityIcons
      name={name as keyof typeof MaterialCommunityIcons.glyphMap}
      size={size}
      color={color ?? MODE_COLORS[mode]}
    />
  );
}
