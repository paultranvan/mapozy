import { StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, radii } from '@/theme/tokens';
import { useI18n } from '@/i18n';

/** Small letterpress-style "EDITED" pill — ink outline, mono, used by the ribbon. */
export function EditedPill() {
  const { t } = useI18n();
  return (
    <Text variant="ribbon" style={styles.pill}>
      {t('timeline.edited')}
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
