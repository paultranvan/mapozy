import { Pressable, View, StyleSheet } from 'react-native';
import { colors, space } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { Text } from './Text';
import { PlaceBadge } from './PlaceBadge';
import type { Place } from '@/types';

export function PlaceListItem({
  place,
  visitCount,
  onPress,
}: {
  place: Place;
  visitCount: number;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const address = place.displayName ?? t('placeItem.noAddress');
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <PlaceBadge category={place.category} />
      <View style={styles.info}>
        <Text variant="body" color={colors.ink}>
          {place.name ?? t('placeItem.unnamed')}
        </Text>
        <Text variant="label" color={colors.inkSoft} numberOfLines={1}>
          {address}
        </Text>
      </View>
      <Text variant="label" color={colors.accent}>
        {visitCount}×
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  info: { flex: 1, gap: 2 },
});
