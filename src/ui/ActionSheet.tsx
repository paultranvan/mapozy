import { Modal, View, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors, radii, space } from '@/theme/tokens';

export interface SheetAction {
  label: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  destructive?: boolean;
  onPress: () => void;
}

/**
 * Custom bottom action sheet matching the app's editorial aesthetic — replaces
 * the OS Alert. Title in the mono ribbon style, rows with a leading icon.
 */
export function ActionSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.grab} />
          <Text variant="ribbon" soft style={styles.title}>
            {title}
          </Text>
          {actions.map((a, i) => (
            <Pressable
              key={i}
              style={styles.row}
              android_ripple={{ color: colors.surfaceMuted }}
              onPress={() => {
                onClose();
                a.onPress();
              }}
            >
              {a.icon ? (
                <MaterialCommunityIcons
                  name={a.icon}
                  size={20}
                  color={a.destructive ? colors.danger : colors.ink}
                />
              ) : (
                <View style={styles.iconSpacer} />
              )}
              <Text variant="body" style={a.destructive ? styles.destructive : styles.label}>
                {a.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={[styles.row, styles.cancelRow]}
            android_ripple={{ color: colors.surfaceMuted }}
            onPress={onClose}
          >
            <View style={styles.iconSpacer} />
            <Text variant="body" soft style={styles.label}>
              Cancel
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,30,50,0.32)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: space[3],
    paddingTop: space[2],
    paddingBottom: space[6],
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: space[3],
  },
  title: {
    paddingHorizontal: space[2],
    marginBottom: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[2],
    borderRadius: radii.chip,
  },
  iconSpacer: { width: 20 },
  label: { color: colors.ink },
  destructive: { color: colors.danger },
  cancelRow: {
    marginTop: space[1],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
});
