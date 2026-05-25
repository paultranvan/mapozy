import { View, StyleSheet } from 'react-native';
import { colors, space } from '@/theme/tokens';
import { Text } from './Text';
import { ModeIcon } from './ModeIcon';
import { formatDistance, formatDuration, formatSpeed, formatTime } from '@/lib/format';
import type { Mode, Section } from '@/types';

interface Props {
  startLabel: string;
  endLabel: string;
  startTimeMs: number;
  endTimeMs: number;
  sections: Section[];
  midLabels?: (string | null)[]; // length = sections.length - 1, may include nulls
}

export function Timeline({
  startLabel,
  endLabel,
  startTimeMs,
  endTimeMs,
  sections,
  midLabels,
}: Props) {
  return (
    <View style={styles.root}>
      <Stop kind="start" label={startLabel} time={startTimeMs} />
      {sections.map((s, i) => {
        const isLast = i === sections.length - 1;
        const next = sections[i + 1];
        const midLabel = midLabels?.[i] ?? null;
        const midTime = next ? next.startTimeMs : null;
        return (
          <View key={i}>
            <Segment section={s} />
            {!isLast ? (
              <MidStop label={midLabel ?? 'Transit point'} time={midTime} />
            ) : null}
          </View>
        );
      })}
      <Stop kind="end" label={endLabel} time={endTimeMs} />
    </View>
  );
}

function Stop({
  kind,
  label,
  time,
}: {
  kind: 'start' | 'end';
  label: string;
  time: number;
}) {
  const inner =
    kind === 'start' ? colors.mode.walk : colors.mode.run;
  return (
    <View style={styles.stopRow}>
      <View style={styles.pinCol}>
        <View style={[styles.pin, { backgroundColor: colors.inkOnGround }]}>
          <View style={[styles.pinInner, { backgroundColor: inner }]} />
        </View>
      </View>
      <View style={styles.stopBody}>
        <Text variant="title">{label}</Text>
        <Text variant="meta" soft>
          {formatTime(time)}
        </Text>
      </View>
    </View>
  );
}

function MidStop({ label, time }: { label: string; time: number | null }) {
  return (
    <View style={styles.midRow}>
      <View style={styles.pinCol}>
        <View style={[styles.pin, styles.midPin]}>
          <View style={[styles.pinInner, styles.midInner]} />
        </View>
      </View>
      <View style={styles.stopBody}>
        <Text variant="body" numberOfLines={1}>
          {label}
        </Text>
        {time !== null ? (
          <Text variant="meta" soft>
            {formatTime(time)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Segment({ section }: { section: Section }) {
  const color = colors.mode[section.mode as Mode];
  return (
    <View style={styles.segmentRow}>
      <View style={styles.pinCol}>
        <View style={[styles.line, { backgroundColor: color }]} />
      </View>
      <View style={styles.segmentBody}>
        <View style={styles.segmentTitle}>
          <ModeIcon mode={section.mode} size={16} color={color} />
          <Text variant="title" style={styles.segmentLabel}>
            {capitalize(section.mode)}
          </Text>
        </View>
        <Text variant="meta" soft>
          {formatDuration(section.durationS)} · {formatDistance(section.distanceM)} · avg{' '}
          {formatSpeed(section.avgSpeedMps)}
        </Text>
      </View>
    </View>
  );
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const styles = StyleSheet.create({
  root: {
    gap: 0,
  },
  pinCol: {
    width: 22,
    alignItems: 'center',
  },
  stopRow: {
    flexDirection: 'row',
    gap: space[3],
    alignItems: 'flex-start',
    paddingVertical: space[1],
  },
  midRow: {
    flexDirection: 'row',
    gap: space[3],
    alignItems: 'flex-start',
    paddingVertical: space[1],
  },
  segmentRow: {
    flexDirection: 'row',
    gap: space[3],
    alignItems: 'stretch',
  },
  pin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  pinInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  midPin: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.ink,
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 6,
  },
  midInner: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface,
  },
  line: {
    width: 3,
    flex: 1,
    minHeight: 28,
    borderRadius: 2,
    marginVertical: 2,
  },
  stopBody: {
    flex: 1,
    gap: 1,
    paddingVertical: 2,
  },
  segmentBody: {
    flex: 1,
    paddingVertical: space[2],
    gap: 2,
  },
  segmentTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  segmentLabel: {
    color: colors.ink,
  },
});
