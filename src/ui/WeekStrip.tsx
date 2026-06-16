import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from './Text';
import { colors, space, radii } from '@/theme/tokens';

export interface WeekDay {
  key: string; // YYYY-MM-DD
  label: string; // Mon, Tue…
  dayNum: number;
}

export function WeekStrip({
  days,
  selectedKey,
  daysWithTrips,
  onSelect,
}: {
  days: WeekDay[];
  selectedKey: string;
  daysWithTrips: Set<string>;
  onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.row}>
      {days.map((d) => {
        const selected = d.key === selectedKey;
        const hasTrips = daysWithTrips.has(d.key);
        return (
          <Pressable
            key={d.key}
            onPress={() => onSelect(d.key)}
            style={[styles.cell, selected && styles.cellSelected]}
          >
            <Text variant="meta" soft={!selected} style={selected ? styles.labelSel : undefined}>
              {d.label}
            </Text>
            <Text variant="title" style={selected ? [styles.num, styles.numSel] : styles.num}>
              {d.dayNum}
            </Text>
            <View
              style={[
                styles.dot,
                !hasTrips && styles.dotEmpty,
                selected && hasTrips && styles.dotSel,
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space[3],
    marginBottom: space[3],
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: space[2],
    marginHorizontal: 2,
    borderRadius: radii.chip,
  },
  cellSelected: { backgroundColor: colors.deep },
  labelSel: { color: colors.surface },
  num: { color: colors.ink, fontSize: 15 },
  numSel: { color: colors.surface },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  dotEmpty: { backgroundColor: 'transparent' },
  dotSel: { backgroundColor: colors.surface },
});
