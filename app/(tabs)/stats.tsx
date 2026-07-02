import { useMemo, useState } from 'react';
import { ScrollView, View, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
import { navigablePeriodRange } from '@/lib/time';
import { bucketGranularityFor } from '@/stats/periodStats';
import type { PeriodKey } from '@/lib/time';
import type { DominantMode, Mode } from '@/types';
import type { ModeBucket } from '@/stats/modeBreakdown';

export default function StatsScreen() {
  const [period, setPeriod] = useState<PeriodKey>('week');
  // 0 = current period; negative pages into the past. Reset whenever the period
  // granularity changes so we always land on the current week/month/etc.
  const [offset, setOffset] = useState(0);

  const changePeriod = (p: PeriodKey) => {
    setPeriod(p);
    setOffset(0);
  };

  const range = navigablePeriodRange(period, offset);
  const navigable = period !== 'all';

  const kpiQ = usePeriodKpi(period, offset);
  const modeQ = useModeBreakdown(period, offset);
  const dailyQ = useDailyDistances(period, offset);
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
    return d.map((p: { label: string; distanceM: number }) => ({
      label: p.label,
      value: p.distanceM / 1000,
    }));
  }, [dailyQ.data]);

  const BUCKET_TITLES: Record<string, string> = {
    hour: 'By hour',
    day: 'By day',
    week: 'By week',
    month: 'By month',
    year: 'By year',
  };
  const distanceBreakdownTitle = BUCKET_TITLES[bucketGranularityFor(period)] ?? 'By day';

  return (
    <View style={styles.root}>
      <TopBar title="Stats" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <PeriodTabs value={period} onChange={changePeriod} />

        {navigable ? (
          <View style={styles.nav}>
            <Pressable
              onPress={() => setOffset((o) => o - 1)}
              hitSlop={10}
              style={styles.navBtn}
            >
              <MaterialCommunityIcons
                name="chevron-left"
                size={26}
                color={colors.inkOnGround}
              />
            </Pressable>
            <Text variant="numberS" onGround>
              {range.label}
            </Text>
            <Pressable
              onPress={() => range.canGoForward && setOffset((o) => o + 1)}
              hitSlop={10}
              disabled={!range.canGoForward}
              style={styles.navBtn}
            >
              <MaterialCommunityIcons
                name="chevron-right"
                size={26}
                color={range.canGoForward ? colors.inkOnGround : colors.divider}
              />
            </Pressable>
          </View>
        ) : null}

        {/* Hero KPI */}
        <Card padded="lg" style={styles.section}>
          <Text variant="ribbon" soft>
            DISTANCE {range.label.toUpperCase()}
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

        {/* Distance breakdown — granularity follows the selected period. */}
        <Text variant="display" onGround style={styles.sectionTitle}>
          {distanceBreakdownTitle}
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
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: space[4],
    marginTop: space[1],
  },
  navBtn: {
    padding: space[1],
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
