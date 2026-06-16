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

  // Distance-weighting alone hides a short leg behind a long one: a 137 m walk
  // to the car next to a 22 km drive renders as a 0.6% sliver — invisible, so
  // the trip reads as car-only. Floor each segment at a fraction of the total
  // so every distinct mode stays visible (a balanced bus+subway trip is
  // unaffected — its legs already clear the floor).
  const floor = total * MIN_VISIBLE_FRACTION;

  return (
    <View style={[styles.bar, { height, borderRadius: radius, gap }]}>
      {segments.map((s, i) => {
        const color = colors.mode[s.mode] ?? colors.mode.mixed;
        return (
          <View
            key={i}
            style={{
              flex: Math.max(s.distanceM, floor),
              backgroundColor: color,
              height: '100%',
            }}
          />
        );
      })}
    </View>
  );
}

const MIN_VISIBLE_FRACTION = 0.05;

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    width: '100%',
    overflow: 'hidden',
  },
});
