import { useState } from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Appbar,
  Text,
  SegmentedButtons,
  useTheme,
  List,
} from 'react-native-paper';
import { BarChart } from 'react-native-gifted-charts';
import {
  usePeriodKpi,
  useModeBreakdown,
  useDailyDistances,
  useRecords,
} from '@/queries/useTrips';
import { KpiCard } from '@/ui/KpiCard';
import { MODE_COLORS } from '@/theme/colors';
import {
  formatDistance,
  formatCo2,
  formatDate,
} from '@/lib/format';
import type { PeriodKey } from '@/lib/time';

const PERIOD_OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: 'today', label: 'D' },
  { value: 'week', label: 'W' },
  { value: 'month', label: 'M' },
  { value: 'year', label: 'Y' },
  { value: 'all', label: 'All' },
];

export default function StatsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [period, setPeriod] = useState<PeriodKey>('week');

  const kpiQ = usePeriodKpi(period);
  const modeQ = useModeBreakdown(period);
  const dailyQ = useDailyDistances(period);
  const recordsQ = useRecords();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header style={{ paddingTop: insets.top }}>
        <Appbar.Content title="Stats" />
      </Appbar.Header>
      <ScrollView contentContainerStyle={styles.container}>
        <SegmentedButtons
          value={period}
          onValueChange={(v) => setPeriod(v as PeriodKey)}
          buttons={PERIOD_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
        />

        <View style={styles.kpiRow}>
          <KpiCard
            label="Distance"
            value={formatDistance(kpiQ.data?.totalDistanceM ?? 0)}
          />
          <KpiCard
            label="Trips"
            value={String(kpiQ.data?.tripsCount ?? 0)}
          />
          <KpiCard
            label="CO₂"
            value={formatCo2(kpiQ.data?.totalCo2G ?? 0)}
          />
        </View>

        <Text variant="titleMedium" style={styles.sectionTitle}>
          By mode
        </Text>
        <View style={styles.modeList}>
          {(modeQ.data ?? []).map((b: { mode: string; distanceM: number }) => {
            const color = MODE_COLORS[b.mode as keyof typeof MODE_COLORS] ?? '#888';
            return (
              <View key={b.mode} style={styles.modeRow}>
                <View style={[styles.modeDot, { backgroundColor: color }]} />
                <Text variant="bodyMedium" style={styles.modeLabel}>
                  {b.mode}
                </Text>
                <Text variant="bodyMedium" style={styles.modeValue}>
                  {formatDistance(b.distanceM)}
                </Text>
              </View>
            );
          })}
          {(!modeQ.data || modeQ.data.length === 0) && (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              No data yet.
            </Text>
          )}
        </View>

        <Text variant="titleMedium" style={styles.sectionTitle}>
          Daily
        </Text>
        {dailyQ.data && dailyQ.data.length > 0 ? (
          <BarChart
            data={dailyQ.data.map((d: { dayKey: string; distanceM: number }) => ({
              value: d.distanceM / 1000,
              label: d.dayKey.slice(5),
              frontColor: theme.colors.primary,
            }))}
            yAxisLabelSuffix=" km"
            barWidth={Math.max(12, 280 / Math.max(dailyQ.data.length, 1))}
            spacing={4}
            initialSpacing={4}
            yAxisColor={theme.colors.outline}
            xAxisColor={theme.colors.outline}
            yAxisTextStyle={{ color: theme.colors.onSurface, fontSize: 10 }}
            xAxisLabelTextStyle={{ color: theme.colors.onSurface, fontSize: 9 }}
            noOfSections={4}
          />
        ) : (
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            No data yet.
          </Text>
        )}

        <Text variant="titleMedium" style={styles.sectionTitle}>
          Records
        </Text>
        <List.Item
          title="Longest trip"
          description={
            recordsQ.data?.longestTripDateMs
              ? `${formatDistance(recordsQ.data.longestTripDistanceM)} on ${formatDate(recordsQ.data.longestTripDateMs)}`
              : '—'
          }
          left={(props) => <List.Icon {...props} icon="ruler" />}
        />
        <List.Item
          title="Best day"
          description={
            recordsQ.data?.bestDayMs
              ? `${formatDistance(recordsQ.data.bestDayDistanceM)} on ${formatDate(recordsQ.data.bestDayMs)}`
              : '—'
          }
          left={(props) => <List.Icon {...props} icon="calendar-star" />}
        />
        <List.Item
          title="Current streak"
          description={`${recordsQ.data?.currentStreakDays ?? 0} day${
            (recordsQ.data?.currentStreakDays ?? 0) === 1 ? '' : 's'
          }`}
          left={(props) => <List.Icon {...props} icon="fire" />}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 12,
  },
  sectionTitle: {
    marginTop: 8,
  },
  modeList: {
    gap: 8,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modeDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  modeLabel: {
    flex: 1,
    textTransform: 'capitalize',
  },
  modeValue: {
    fontVariant: ['tabular-nums'],
  },
});
