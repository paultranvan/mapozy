import { useMemo, useState } from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import {
  usePeriodKpi,
  useModeBreakdown,
  useDailyDistances,
  useRecords,
} from '@/queries/useTrips';
import { TopBar } from '@/ui/TopBar';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { ModeBar } from '@/ui/ModeBar';
import { PeriodTabs } from '@/ui/PeriodTabs';
import { AreaChart } from '@/ui/AreaChart';
import { colors, space } from '@/theme/tokens';
import { formatDistance, formatDate } from '@/lib/format';
import type { PeriodKey } from '@/lib/time';
import type { DominantMode, Mode } from '@/types';
import type { ModeBucket } from '@/stats/modeBreakdown';

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'today',
  week: 'this week',
  month: 'this month',
  year: 'this year',
  all: 'all time',
};

export default function StatsScreen() {
  const [period, setPeriod] = useState<PeriodKey>('week');

  const kpiQ = usePeriodKpi(period);
  const modeQ = useModeBreakdown(period);
  const dailyQ = useDailyDistances(period);
  const recordsQ = useRecords();

  const totalDistance = kpiQ.data?.totalDistanceM ?? 0;
  const tripCount = kpiQ.data?.tripsCount ?? 0;
  const [distValue, distUnit] = formatDistance(totalDistance).split(' ');

  const modeRows = useMemo(() => {
    const rows: ModeBucket[] = modeQ.data ?? [];
    const total = rows.reduce((a, r) => a + r.distanceM, 0);
    return rows
      .slice()
      .sort((a, b) => b.distanceM - a.distanceM)
      .map((r) => ({
        ...r,
        pct: total > 0 ? Math.round((r.distanceM / total) * 100) : 0,
      }));
  }, [modeQ.data]);

  const modeBarSegments = useMemo(
    () =>
      (modeQ.data ?? []).map((r: ModeBucket) => ({
        mode: r.mode as DominantMode,
        distanceM: r.distanceM,
      })),
    [modeQ.data]
  );

  const dailyData = useMemo(() => {
    const d = dailyQ.data ?? [];
    return d.map((p: { dayKey: string; distanceM: number }) => ({
      label: p.dayKey.slice(5),
      value: p.distanceM / 1000,
    }));
  }, [dailyQ.data]);

  return (
    <View style={styles.root}>
      <TopBar title="Stats" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <PeriodTabs value={period} onChange={setPeriod} />

        {/* Hero KPI */}
        <Card padded="lg" style={styles.section}>
          <Text variant="ribbon" soft>
            DISTANCE {PERIOD_LABELS[period].toUpperCase()}
          </Text>
          <View style={styles.heroRow}>
            <Text variant="displayXL">{distValue}</Text>
            <Text variant="display" soft style={styles.heroUnit}>
              {distUnit}
            </Text>
          </View>
          <Text variant="meta" soft>
            across {tripCount} {tripCount === 1 ? 'trip' : 'trips'}
          </Text>
        </Card>

        {/* By mode */}
        <Text variant="display" onGround style={styles.sectionTitle}>
          By mode
        </Text>
        <Card style={styles.section}>
          {modeRows.length === 0 ? (
            <Text variant="body" soft>
              No data yet.
            </Text>
          ) : (
            <>
              <ModeBar segments={modeBarSegments} height={10} radius={5} gap={2} />
              <View style={styles.legend}>
                {modeRows.map((r: ModeBucket & { pct: number }) => (
                  <View key={r.mode} style={styles.legendRow}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: colors.mode[r.mode as Mode] ?? colors.mode.mixed },
                      ]}
                    />
                    <Text variant="body" style={styles.legendLabel}>
                      {capitalize(r.mode)}
                    </Text>
                    <Text variant="numberS" style={styles.legendValue}>
                      {formatDistance(r.distanceM)}
                    </Text>
                    <Text variant="meta" soft style={styles.legendPct}>
                      {r.pct}%
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </Card>

        {/* Daily */}
        <Text variant="display" onGround style={styles.sectionTitle}>
          Daily
        </Text>
        <Card style={styles.section}>
          {dailyData.length === 0 ? (
            <Text variant="body" soft>
              No data yet.
            </Text>
          ) : (
            <AreaChart data={dailyData} height={160} yLabelSuffix=" km" />
          )}
        </Card>

        {/* Records */}
        <Text variant="display" onGround style={styles.sectionTitle}>
          Records
        </Text>
        <Card style={styles.section}>
          <RecordRow
            title="Longest trip"
            value={
              recordsQ.data?.longestTripDateMs
                ? formatDistance(recordsQ.data.longestTripDistanceM)
                : '—'
            }
            sub={
              recordsQ.data?.longestTripDateMs
                ? formatDate(recordsQ.data.longestTripDateMs)
                : null
            }
          />
          <Divider />
          <RecordRow
            title="Best day"
            value={
              recordsQ.data?.bestDayMs
                ? formatDistance(recordsQ.data.bestDayDistanceM)
                : '—'
            }
            sub={recordsQ.data?.bestDayMs ? formatDate(recordsQ.data.bestDayMs) : null}
          />
          <Divider />
          <RecordRow
            title="Current streak"
            value={`${recordsQ.data?.currentStreakDays ?? 0} ${
              (recordsQ.data?.currentStreakDays ?? 0) === 1 ? 'day' : 'days'
            }`}
            sub={null}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

function RecordRow({
  title,
  value,
  sub,
}: {
  title: string;
  value: string;
  sub: string | null;
}) {
  return (
    <View style={styles.recordRow}>
      <View style={{ flex: 1 }}>
        <Text variant="body">{title}</Text>
        {sub ? (
          <Text variant="meta" soft>
            {sub}
          </Text>
        ) : null}
      </View>
      <Text variant="numberM">{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ground,
  },
  scroll: {
    paddingBottom: space[6],
  },
  section: {
    marginHorizontal: space[4],
    marginTop: space[2],
  },
  sectionTitle: {
    marginTop: space[5],
    marginHorizontal: space[4],
    marginBottom: 0,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: space[2],
  },
  heroUnit: {
    marginLeft: space[2],
  },
  legend: {
    marginTop: space[3],
    gap: space[2],
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendLabel: {
    flex: 1,
  },
  legendValue: {
    minWidth: 72,
    textAlign: 'right',
  },
  legendPct: {
    minWidth: 36,
    textAlign: 'right',
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space[2],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
});
