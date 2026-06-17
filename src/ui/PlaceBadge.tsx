import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { categoryMeta } from './placeCategories';
import type { PlaceCategory } from '../types';

export function PlaceBadge({
  category,
  size = 32,
}: {
  category: PlaceCategory | null;
  size?: number;
}) {
  const meta = categoryMeta(category);
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, backgroundColor: meta.color, borderRadius: size / 2 },
      ]}
    >
      <MaterialCommunityIcons name={meta.icon} size={size * 0.55} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
});
