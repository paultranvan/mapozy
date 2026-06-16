import { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, space, radii } from '@/theme/tokens';
import { Text } from './Text';
import { ModeIcon } from './ModeIcon';
import { effectiveMode } from '@/pipeline/effectiveMode';
import { formatDistance, formatDuration, formatSpeed, formatTime, capitalize } from '@/lib/format';
import type { Mode, Section, TripBreak } from '@/types';

const MODES: Mode[] = ['walk', 'run', 'bike', 'car', 'bus', 'tram', 'subway', 'train', 'plane'];

interface Props {
  startLabel: string;
  endLabel: string;
  startTimeMs: number;
  endTimeMs: number;
  sections: Section[];
  breaks?: TripBreak[];
  midLabels?: (string | null)[];
  editable?: boolean;
  onChangeMode?: (section: Section, mode: Mode) => void;
  onSplitLeg?: (section: Section, index: number) => void;
  onMergeUp?: (index: number) => void;
  onMergeDown?: (index: number) => void;
}

function vertexCount(s: Section): number {
  try {
    return (JSON.parse(s.geojson).coordinates as unknown[]).length;
  } catch {
    return 0;
  }
}

export function Timeline({
  startLabel,
  endLabel,
  startTimeMs,
  endTimeMs,
  sections,
  breaks,
  midLabels,
  editable = false,
  onChangeMode,
  onSplitLeg,
  onMergeUp,
  onMergeDown,
}: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const breaksByOrdering = new Map<number, TripBreak>();
  for (const b of breaks ?? []) breaksByOrdering.set(b.ordering, b);

  return (
    <View style={styles.root}>
      <Stop kind="start" label={startLabel} time={startTimeMs} connectColor={
        sections[0] ? colors.mode[effectiveMode(sections[0])] : colors.deep
      } />
      {sections.map((s, i) => {
        const isLast = i === sections.length - 1;
        const next = sections[i + 1];
        const midLabel = midLabels?.[i] ?? null;
        const midTime = next ? next.startTimeMs : null;
        const brk = breaksByOrdering.get(i);
        const open = editable && openIndex === i;
        return (
          <View key={i}>
            <Leg
              section={s}
              index={i}
              count={sections.length}
              open={open}
              editable={editable}
              onToggle={() => setOpenIndex(open ? null : i)}
              onChangeMode={onChangeMode}
              onSplitLeg={onSplitLeg}
              onMergeUp={onMergeUp}
              onMergeDown={onMergeDown}
            />
            {!isLast ? (
              brk ? (
                <MidRow
                  kind="break"
                  label={`Break · ${formatDuration(
                    Math.max(1, Math.round((brk.endTimeMs - brk.startTimeMs) / 1000))
                  )}`}
                  time={null}
                />
              ) : (
                <MidRow kind="transit" label={midLabel ?? 'Transit point'} time={midTime} />
              )
            ) : null}
          </View>
        );
      })}
      <Stop kind="end" label={endLabel} time={endTimeMs} connectColor={null} />
    </View>
  );
}

function Stop({
  kind,
  label,
  time,
  connectColor,
}: {
  kind: 'start' | 'end';
  label: string;
  time: number;
  connectColor: string | null;
}) {
  const ring = kind === 'start' ? colors.start : colors.end;
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={[styles.stopDot, { borderColor: ring }]}>
          <View style={[styles.stopDotInner, { backgroundColor: ring }]} />
        </View>
        {connectColor ? (
          <View style={[styles.connector, { backgroundColor: connectColor }]} />
        ) : null}
      </View>
      <View style={styles.stopBody}>
        <Text variant="title">{label}</Text>
        <Text variant="ribbon" soft style={styles.mono}>
          {formatTime(time)}
        </Text>
      </View>
    </View>
  );
}

function Leg({
  section,
  index,
  count,
  open,
  editable,
  onToggle,
  onChangeMode,
  onSplitLeg,
  onMergeUp,
  onMergeDown,
}: {
  section: Section;
  index: number;
  count: number;
  open: boolean;
  editable: boolean;
  onToggle: () => void;
  onChangeMode?: (section: Section, mode: Mode) => void;
  onSplitLeg?: (section: Section, index: number) => void;
  onMergeUp?: (index: number) => void;
  onMergeDown?: (index: number) => void;
}) {
  const mode = effectiveMode(section);
  const color = colors.mode[mode];
  const edited = section.userMode != null;

  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={[styles.token, { backgroundColor: color }]}>
          <ModeIcon mode={mode} size={15} color={colors.surface} />
        </View>
        <View style={[styles.connector, { backgroundColor: color }]} />
      </View>
      <View style={[styles.legBody, open && styles.legBodyOpen, open && { borderLeftColor: color }]}>
        <Pressable
          onPress={editable ? onToggle : undefined}
          android_ripple={editable ? { color: colors.surfaceMuted } : undefined}
          style={styles.legHead}
        >
          <View style={styles.legTitleRow}>
            <Text variant="title" style={styles.legTitle}>
              {capitalize(mode)}
            </Text>
            {edited ? (
              <Text variant="ribbon" soft style={styles.editedTag}>
                EDITED
              </Text>
            ) : null}
            {editable ? (
              <MaterialCommunityIcons
                name={open ? 'chevron-up' : 'pencil-outline'}
                size={18}
                color={colors.inkSoft}
                style={styles.chevron}
              />
            ) : null}
          </View>
          <Text variant="ribbon" soft style={styles.mono}>
            {formatDuration(section.durationS)} · {formatDistance(section.distanceM)} · avg{' '}
            {formatSpeed(section.avgSpeedMps)}
          </Text>
        </Pressable>

        {open ? (
          <LegEditor
            section={section}
            index={index}
            count={count}
            current={mode}
            onChangeMode={onChangeMode}
            onSplitLeg={onSplitLeg}
            onMergeUp={onMergeUp}
            onMergeDown={onMergeDown}
          />
        ) : null}
      </View>
    </View>
  );
}

function LegEditor({
  section,
  index,
  count,
  current,
  onChangeMode,
  onSplitLeg,
  onMergeUp,
  onMergeDown,
}: {
  section: Section;
  index: number;
  count: number;
  current: Mode;
  onChangeMode?: (section: Section, mode: Mode) => void;
  onSplitLeg?: (section: Section, index: number) => void;
  onMergeUp?: (index: number) => void;
  onMergeDown?: (index: number) => void;
}) {
  const canSplit = vertexCount(section) >= 3;
  return (
    <View style={styles.editor}>
      <Text variant="ribbon" soft style={styles.editorLabel}>
        Mode
      </Text>
      <View style={styles.modes}>
        {MODES.map((m) => {
          const sel = m === current;
          const c = colors.mode[m];
          return (
            <Pressable
              key={m}
              onPress={() => onChangeMode?.(section, m)}
              style={[styles.modeRing, sel && { borderColor: c }]}
            >
              <View
                style={[
                  styles.modeChip,
                  sel ? { backgroundColor: c, borderColor: c } : { borderColor: colors.divider },
                ]}
              >
                <ModeIcon mode={m} size={17} color={sel ? colors.surface : c} />
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.acts}>
        {canSplit ? (
          <ActionChip label="Split here" glyph="✂" onPress={() => onSplitLeg?.(section, index)} />
        ) : null}
        {index > 0 ? (
          <ActionChip label="Merge up" glyph="⤒" onPress={() => onMergeUp?.(index)} />
        ) : null}
        {index < count - 1 ? (
          <ActionChip label="Merge down" glyph="⤓" onPress={() => onMergeDown?.(index)} />
        ) : null}
      </View>
    </View>
  );
}

function ActionChip({
  label,
  glyph,
  onPress,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.surfaceMuted }}
      style={styles.actChip}
    >
      <Text variant="meta" style={styles.actGlyph}>
        {glyph}
      </Text>
      <Text variant="label" style={styles.actLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function MidRow({
  kind,
  label,
  time,
}: {
  kind: 'transit' | 'break';
  label: string;
  time: number | null;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={styles.midDot}>
          <View style={styles.midDotInner} />
        </View>
        <View style={[styles.connector, styles.connectorMuted]} />
      </View>
      <View style={styles.stopBody}>
        <Text variant={kind === 'break' ? 'meta' : 'body'} soft={kind === 'break'} numberOfLines={1}>
          {label}
        </Text>
        {time !== null ? (
          <Text variant="ribbon" soft style={styles.mono}>
            {formatTime(time)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const RAIL_W = 30;

const styles = StyleSheet.create({
  root: { gap: 0 },
  row: { flexDirection: 'row', gap: space[3], alignItems: 'stretch' },
  rail: { width: RAIL_W, alignItems: 'center', flex: 0 },
  connector: { width: 3, flex: 1, minHeight: 22, borderRadius: 2, marginVertical: 3 },
  connectorMuted: { backgroundColor: colors.divider },
  mono: { marginTop: 2 },

  // stops
  stopDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
  },
  stopDotInner: { width: 6, height: 6, borderRadius: 3 },
  stopBody: { flex: 1, paddingVertical: 2, paddingBottom: space[2] },

  // mid
  midDot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.inkSoft,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
  },
  midDotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.surface },

  // leg
  token: {
    width: RAIL_W,
    height: RAIL_W,
    borderRadius: RAIL_W / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
  },
  legBody: { flex: 1, paddingVertical: space[2] },
  legBodyOpen: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.chip,
    borderLeftWidth: 3,
    marginRight: -space[1],
    marginVertical: 2,
    paddingHorizontal: space[3],
  },
  legHead: { paddingVertical: 2 },
  legTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  legTitle: { color: colors.ink },
  editedTag: {
    color: colors.deep,
    borderWidth: 1,
    borderColor: colors.deep,
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
    opacity: 0.85,
  },
  chevron: { marginLeft: 'auto' },

  // editor
  editor: { paddingTop: space[2], paddingBottom: space[2] },
  editorLabel: { marginBottom: space[2] },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  modeRing: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: radii.pill,
    padding: 2,
  },
  modeChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acts: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] },
  actChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radii.pill,
    paddingHorizontal: space[3],
    paddingVertical: 7,
  },
  actGlyph: { color: colors.ink },
  actLabel: { color: colors.ink },
});
