import { View, StyleSheet } from 'react-native';
import { colors } from '@/theme/tokens';
import type { DominantMode } from '@/types';

interface Segment {
  mode: DominantMode;
  distanceM: number;
}

export function ModeBar({
  segments,
  height = 4,
  radius = 2,
  gap = 2,
}: {
  segments: Segment[];
  height?: number;
  radius?: number;
  gap?: number;
}) {
  const total = segments.reduce((a, s) => a + s.distanceM, 0);
  if (total <= 0 || segments.length === 0) return null;

  return (
    <View style={[styles.bar, { height, borderRadius: radius, gap }]}>
      {segments.map((s, i) => {
        const color = colors.mode[s.mode] ?? colors.mode.mixed;
        return (
          <View
            key={i}
            style={{
              flex: Math.max(s.distanceM, 1),
              backgroundColor: color,
              height: '100%',
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    width: '100%',
    overflow: 'hidden',
  },
});
