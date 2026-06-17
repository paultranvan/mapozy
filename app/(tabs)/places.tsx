import { useState } from 'react';
import { View, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapLibreGL, { MapView, Camera, PointAnnotation } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, space } from '@/theme/tokens';
import { OSM_STYLE } from '@/ui/mapStyle';
import { Text } from '@/ui/Text';
import { PlaceListItem } from '@/ui/PlaceListItem';
import { PlaceBadge } from '@/ui/PlaceBadge';
import { useUserPlaces, useUserPoiVisits, useHomeWorkSuggestion } from '@/queries/usePlaces';
import type { Place } from '@/types';

MapLibreGL.setAccessToken(null);

export default function PlacesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [view, setView] = useState<'list' | 'map'>('list');
  const places = useUserPlaces();
  const visits = useUserPoiVisits();
  const suggestion = useHomeWorkSuggestion();

  const sugg = suggestion.data?.home ?? suggestion.data?.work ?? null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[2] }]}>
      <View style={styles.header}>
        <Text variant="title" color={colors.ink}>Mes lieux</Text>
        <View style={styles.toggle}>
          {(['list', 'map'] as const).map((v) => (
            <Pressable key={v} onPress={() => setView(v)} style={[styles.tg, view === v && styles.tgOn]}>
              <Text variant="label" color={view === v ? colors.ground : colors.inkSoft}>{v === 'list' ? 'Liste' : 'Carte'}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {sugg && (
        <Pressable
          style={styles.banner}
          onPress={() => router.push({
            pathname: '/place/[id]',
            params: {
              id: 'new',
              lat: String(sugg.latitude),
              lon: String(sugg.longitude),
              category: sugg.category,
              name: sugg.displayName ?? '',
            },
          })}
        >
          <Text variant="label" color={colors.ink}>
            💡 {sugg.category === 'home' ? 'Maison' : 'Travail'} probable détecté — valider ?
          </Text>
        </Pressable>
      )}

      {view === 'list' ? (
        <FlatList
          data={places.data ?? []}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => (
            <PlaceListItem
              place={item}
              visitCount={visits.data?.get(item.id)?.visitCount ?? 0}
              onPress={() => router.push({ pathname: '/place/[id]', params: { id: String(item.id) } })}
            />
          )}
          ListEmptyComponent={<Text variant="body" color={colors.inkSoft} style={styles.empty}>Aucun lieu. Touchez ＋ pour en créer un.</Text>}
        />
      ) : (
        <MapView style={styles.map} mapStyle={OSM_STYLE as unknown as string}>
          <Camera
            centerCoordinate={places.data?.[0] ? [places.data[0].longitude, places.data[0].latitude] : [4.85, 45.75]}
            zoomLevel={11}
            animationDuration={0}
          />
          {(places.data ?? []).map((p: Place) => (
            <PointAnnotation
              key={String(p.id)}
              id={String(p.id)}
              coordinate={[p.longitude, p.latitude]}
              onSelected={(_feat) => router.push({ pathname: '/place/[id]', params: { id: String(p.id) } })}
            >
              <PlaceBadge category={p.category} />
            </PointAnnotation>
          ))}
        </MapView>
      )}

      <Pressable style={styles.fab} onPress={() => router.push({ pathname: '/place/[id]', params: { id: 'new' } })}>
        <MaterialCommunityIcons name="plus" size={28} color={colors.ground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[3], paddingBottom: space[2] },
  toggle: { flexDirection: 'row', backgroundColor: colors.accentSoft, borderRadius: 18, padding: 2 },
  tg: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: 16 },
  tgOn: { backgroundColor: colors.accent },
  banner: { margin: space[3], padding: space[2], backgroundColor: colors.accentSoft, borderRadius: 10 },
  map: { flex: 1 },
  empty: { textAlign: 'center', marginTop: space[6], paddingHorizontal: space[4] },
  fab: { position: 'absolute', right: space[4], bottom: space[5], width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 4 },
});
