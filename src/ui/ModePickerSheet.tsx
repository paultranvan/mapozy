import { Modal, StyleSheet, Pressable } from 'react-native';
import { Text } from './Text';
import { ModeIcon } from './ModeIcon';
import { colors, radii, space } from '@/theme/tokens';
import type { Mode } from '@/types';

const MODES: Mode[] = ['walk', 'run', 'bike', 'car', 'bus', 'tram', 'subway', 'train'];

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ModePickerSheet({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (mode: Mode) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text variant="title" style={styles.heading}>
            Change mode
          </Text>
          {MODES.map((m) => (
            <Pressable
              key={m}
              style={styles.row}
              android_ripple={{ color: colors.surfaceMuted }}
              onPress={() => onPick(m)}
            >
              <ModeIcon mode={m} size={20} color={colors.mode[m]} />
              <Text variant="body" style={styles.label}>
                {capitalize(m)}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: space[4],
  },
  card: { backgroundColor: colors.surface, borderRadius: radii.sheet, padding: space[3] },
  heading: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  label: { color: colors.ink },
});
