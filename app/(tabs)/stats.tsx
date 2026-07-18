import { useEffect, useMemo, useState } from 'react';
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
import { colors, radii, space } from '@/theme/tokens';
import { formatDistance, formatDate } from '@/lib/format';
import { useI18n } from '@/i18n';
import { modeLabel } from '@/i18n/labels';
import { navigablePeriodRange } from '@/lib/time';
import { bucketGranularityFor } from '@/stats/periodStats';
import type { PeriodKey } from '@/lib/time';
import type { DominantMode, Mode } from '@/types';
import type { ModeBucket } from '@/stats/modeBreakdown';

export default function StatsScreen() {
  const { t } = useI18n();
  const [period, setPeriod] = useState<PeriodKey>('week');
  // 0 = current period; negative pages into the past. Reset whenever the period
  // granularity changes so we always land on the current week/month/etc.
  const [offset, setOffset] = useState(0);
  // Tapping a "By mode" row filters the hero total + distance chart to that
  // mode (tester: "le détail par mode de transport aussi"). null = all modes.
  const [modeFilter, setModeFilter] = useState<Mode | null>(null);

  const changePeriod = (p: PeriodKey) => {
    setPeriod(p);
    setOffset(0);
  };

  const range = navigablePeriodRange(period, offset);
  const navigable = period !== 'all';

  const kpiQ = usePeriodKpi(period, offset, modeFilter);
  const modeQ = useModeBreakdown(period, offset);
  const dailyQ = useDailyDistances(period, offset, modeFilter);
  const recordsQ = useRecords();

  // Navigating to a period with no data for the filtered mode would leave an
  // active filter with no visible row to clear it — drop the filter instead.
  useEffect(() => {
    if (
      modeFilter &&
      modeQ.data &&
      !modeQ.data.some((r: ModeBucket) => r.mode === modeFilter)
    ) {
      setModeFilter(null);
    }
  }, [modeFilter, modeQ.data]);

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
    hour: t('stats.byHour'),
    day: t('stats.byDay'),
    week: t('stats.byWeek'),
    month: t('stats.byMonth'),
    year: t('stats.byYear'),
  };
  const distanceBreakdownTitle =
    BUCKET_TITLES[bucketGranularityFor(period)] ?? t('stats.byDay');
  const filterSuffix = modeFilter ? ` · ${modeLabel(modeFilter)}` : '';

  return (
    <View style={styles.root}>
      <TopBar title={t('stats.title')} />
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
            {t('stats.distance').toUpperCase()} {range.label.toUpperCase()}
            {modeFilter ? ` · ${modeLabel(modeFilter).toUpperCase()}` : ''}
          </Text>
          <View style={styles.heroRow}>
            <Text variant="displayXL">{distValue}</Text>
            <Text variant="display" soft style={styles.heroUnit}>
              {distUnit}
            </Text>
          </View>
          <Text variant="meta" soft>
            {t('stats.acrossTrips', { count: tripCount })}
          </Text>
        </Card>

        {/* By mode */}
        <Text variant="display" onGround style={styles.sectionTitle}>
          {t('stats.byMode')}
        </Text>
        <Card style={styles.section}>
          {modeRows.length === 0 ? (
            <Text variant="body" soft>
              {t('stats.noData')}
            </Text>
          ) : (
            <>
              <ModeBar segments={modeBarSegments} height={10} radius={5} gap={2} />
              <View style={styles.legend}>
                {modeRows.map((r: ModeBucket & { pct: number }) => {
                  const active = modeFilter === r.mode;
                  return (
                    <Pressable
                      key={r.mode}
                      onPress={() =>
                        setModeFilter((cur) => (cur === r.mode ? null : (r.mode as Mode)))
                      }
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityHint={t('stats.filterHint')}
                      style={[
                        styles.legendRow,
                        active && styles.legendRowActive,
                        modeFilter !== null && !active && styles.legendRowDimmed,
                      ]}
                    >
                      <View
                        style={[
                          styles.legendDot,
                          { backgroundColor: colors.mode[r.mode as Mode] ?? colors.mode.mixed },
                        ]}
                      />
                      <Text variant="body" style={styles.legendLabel}>
                        {modeLabel(r.mode)}
                      </Text>
                      <Text variant="numberS" style={styles.legendValue}>
                        {formatDistance(r.distanceM)}
                      </Text>
                      <Text variant="meta" soft style={styles.legendPct}>
                        {r.pct}%
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {modeFilter !== null ? (
                <Text variant="meta" soft style={styles.legendHint}>
                  {t('stats.showingOnly', { mode: modeLabel(modeFilter) })}
                </Text>
              ) : null}
            </>
          )}
        </Card>

        {/* Distance breakdown — granularity follows the selected period. */}
        <Text variant="display" onGround style={styles.sectionTitle}>
          {distanceBreakdownTitle}
          {filterSuffix}
        </Text>
        <Card style={styles.section}>
          {dailyData.length === 0 ? (
            <Text variant="body" soft>
              {t('stats.noData')}
            </Text>
          ) : (
            <AreaChart data={dailyData} height={160} yLabelSuffix=" km" />
          )}
        </Card>

        {/* Records */}
        <Text variant="display" onGround style={styles.sectionTitle}>
          {t('stats.records')}
        </Text>
        <Card style={styles.section}>
          <RecordRow
            title={t('stats.longestTrip')}
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
            title={t('stats.bestDay')}
            value={
              recordsQ.data?.bestDayMs
                ? formatDistance(recordsQ.data.bestDayDistanceM)
                : '—'
            }
            sub={recordsQ.data?.bestDayMs ? formatDate(recordsQ.data.bestDayMs) : null}
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
    gap: space[1],
  },
  // Rows always carry the chip padding/radius so toggling the filter only
  // changes the background — no layout shift.
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[1],
    paddingHorizontal: space[2],
    marginHorizontal: -space[2],
    borderRadius: radii.chip,
  },
  legendRowActive: {
    backgroundColor: colors.accentSoft,
  },
  legendRowDimmed: {
    opacity: 0.45,
  },
  legendHint: {
    marginTop: space[2],
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
