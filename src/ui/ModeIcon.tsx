import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, DOMINANT_MODE_ICONS } from '@/theme/tokens';
import type { DominantMode } from '@/types';

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
      color={color ?? colors.mode[mode]}
    />
  );
}
