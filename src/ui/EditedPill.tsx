import { StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, radii } from '@/theme/tokens';

/** Small letterpress-style "EDITED" pill — ink outline, mono, used by the ribbon. */
export function EditedPill() {
  return (
    <Text variant="ribbon" style={styles.pill}>
      EDITED
    </Text>
  );
}

const styles = StyleSheet.create({
  pill: {
    color: colors.deep,
    borderWidth: 1,
    borderColor: colors.deep,
    borderRadius: radii.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    opacity: 0.85,
    overflow: 'hidden',
  },
});
