import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, space } from '@/theme/tokens';
import { useI18n, type TranslationKey } from '@/i18n';
import type { PeriodKey } from '@/lib/time';

interface Props {
  value: PeriodKey;
  onChange: (v: PeriodKey) => void;
}

const OPTIONS: { value: PeriodKey; labelKey: TranslationKey }[] = [
  { value: 'today', labelKey: 'periodTabs.today' },
  { value: 'week', labelKey: 'periodTabs.week' },
  { value: 'month', labelKey: 'periodTabs.month' },
  { value: 'year', labelKey: 'periodTabs.year' },
  { value: 'all', labelKey: 'periodTabs.all' },
];

export function PeriodTabs({ value, onChange }: Props) {
  const { t } = useI18n();
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
              {t(o.labelKey)}
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
