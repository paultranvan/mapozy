import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, space } from '@/theme/tokens';
import type { PeriodKey } from '@/lib/time';

interface Props {
  value: PeriodKey;
  onChange: (v: PeriodKey) => void;
}

const OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All' },
];

export function PeriodTabs({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={styles.tab}
            hitSlop={6}
          >
            <Text
              variant={active ? 'numberS' : 'label'}
              onGround
              soft={!active}
              style={active ? styles.activeText : undefined}
            >
              {o.label}
            </Text>
            {active ? <View style={styles.underline} /> : <View style={styles.underlineSpacer} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    justifyContent: 'space-between',
  },
  tab: {
    alignItems: 'center',
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  activeText: {
    color: colors.inkOnGround,
  },
  underline: {
    height: 2,
    width: 22,
    backgroundColor: colors.accent,
    marginTop: 4,
    borderRadius: 1,
  },
  underlineSpacer: {
    height: 2,
    marginTop: 4,
  },
});
