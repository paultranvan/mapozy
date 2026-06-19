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
import { categoryMeta } from '@/ui/placeCategories';
import { useUserPlaces, useUserPoiVisits, useHomeWorkSuggestion, useUnnamedClusters, useDismissSuggestion } from '@/queries/usePlaces';
import { haversineMeters } from '@/lib/distance';
import type { HomeWorkSuggestion } from '@/stats/homeWorkDetection';
import type { Place } from '@/types';

MapLibreGL.setAccessToken(null);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[3], paddingBottom: space[2] },
  toggle: { flexDirection: 'row', backgroundColor: colors.accentSoft, borderRadius: 18, padding: 2 },
  tg: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: 16 },
  tgOn: { backgroundColor: colors.accent },
  banner: { margin: space[3], padding: space[2], backgroundColor: colors.accentSoft, borderRadius: 10 },
  map: { flex: 1 },
  empty: { textAlign: 'center', marginTop: space[6], paddingHorizontal: space[4] },
  fab: { position: 'absolute', right: space[4], width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  sugLabel: { paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[1], letterSpacing: 0.5 },
  sugRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[3], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, backgroundColor: colors.accentSoft },
  sugMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  sugInfo: { flex: 1, gap: 2 },
  sugAdd: { padding: space[1] },
  sugDismiss: { padding: space[1], marginLeft: space[1] },
  sugMore: { paddingHorizontal: space[3], paddingVertical: space[2] },
  ghostBadge: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.inkSoft, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});

function EmptyPlaces() {
  return <Text variant="body" color={colors.inkSoft} style={styles.empty}>Aucun lieu. Touchez ＋ pour en créer un.</Text>;
}

function GhostBadge() {
  return (
    <View style={styles.ghostBadge}>
      <MaterialCommunityIcons name="map-marker-plus-outline" size={18} color={colors.inkSoft} />
    </View>
  );
}

export default function PlacesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const places = useUserPlaces();
  const visits = useUserPoiVisits(view === 'list');
  const suggestion = useHomeWorkSuggestion();
  const clusters = useUnnamedClusters(20);
  const dismiss = useDismissSuggestion();

  const suggestions = [suggestion.data?.home, suggestion.data?.work].filter(Boolean) as HomeWorkSuggestion[];

  const hwCoords = [suggestion.data?.home, suggestion.data?.work].filter(Boolean) as { latitude: number; longitude: number }[];
  const freqSuggestions = (clusters.data ?? []).filter(
    (c: Place) => !hwCoords.some((h) => haversineMeters(c.latitude, c.longitude, h.latitude, h.longitude) < 60)
  );
  const visibleSuggestions = showAllSuggestions ? freqSuggestions : freqSuggestions.slice(0, 3);

  const nameCluster = (c: { latitude: number; longitude: number }) =>
    router.push({ pathname: '/place/[id]', params: { id: 'new', lat: String(c.latitude), lon: String(c.longitude) } });

  const suggestionsBlock = freqSuggestions.length > 0 ? (
    <View>
      <Text variant="label" color={colors.inkSoft} style={styles.sugLabel}>💡 SUGGESTIONS</Text>
      {visibleSuggestions.map((c: Place) => (
        <View key={c.id} style={styles.sugRow}>
          <Pressable style={styles.sugMain} onPress={() => nameCluster(c)}>
            <GhostBadge />
            <View style={styles.sugInfo}>
              <Text variant="body" color={colors.ink} numberOfLines={1}>{c.displayName ?? 'Lieu fréquent'}</Text>
              <Text variant="label" color={colors.inkSoft}>{c.visitCount} visites</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => nameCluster(c)} hitSlop={6} style={styles.sugAdd}>
            <MaterialCommunityIcons name="plus" size={18} color={colors.accent} />
          </Pressable>
          <Pressable onPress={() => dismiss.mutate(c.id)} hitSlop={6} style={styles.sugDismiss}>
            <MaterialCommunityIcons name="close" size={16} color={colors.inkSoft} />
          </Pressable>
        </View>
      ))}
      {freqSuggestions.length > 3 && !showAllSuggestions && (
        <Pressable onPress={() => setShowAllSuggestions(true)} style={styles.sugMore}>
          <Text variant="label" color={colors.accent}>Voir plus de suggestions ({freqSuggestions.length - 3})</Text>
        </Pressable>
      )}
      <Text variant="label" color={colors.inkSoft} style={styles.sugLabel}>MES LIEUX</Text>
    </View>
  ) : null;

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

      {suggestions.map((s) => (
        <Pressable
          key={s.category}
          style={styles.banner}
          onPress={() => router.push({ pathname: '/place/[id]', params: {
            id: 'new', lat: String(s.latitude), lon: String(s.longitude),
            category: s.category, name: categoryMeta(s.category).labelFr,
          } })}
        >
          <Text variant="label" color={colors.ink}>
            💡 {s.category === 'home' ? 'Maison' : s.category === 'work' ? 'Travail' : s.category} probable détecté — valider ?
          </Text>
        </Pressable>
      ))}

      {view === 'list' ? (
        <FlatList
          data={places.data ?? []}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={{ paddingBottom: 96 }}
          ListHeaderComponent={suggestionsBlock}
          renderItem={({ item }) => (
            <PlaceListItem
              place={item}
              visitCount={visits.data?.get(item.id)?.visitCount ?? 0}
              onPress={() => router.push({ pathname: '/place/[id]', params: { id: String(item.id) } })}
            />
          )}
          ListEmptyComponent={EmptyPlaces}
        />
      ) : (
        <MapView style={styles.map} mapStyle={OSM_STYLE as unknown as string}>
          <Camera
            defaultSettings={{
              centerCoordinate: places.data?.[0] ? [places.data[0].longitude, places.data[0].latitude] : [4.85, 45.75],
              zoomLevel: 11,
            }}
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
          {freqSuggestions.map((c: Place) => (
            <PointAnnotation key={`sug-${c.id}`} id={`sug-${c.id}`} coordinate={[c.longitude, c.latitude]} onSelected={() => nameCluster(c)}>
              <GhostBadge />
            </PointAnnotation>
          ))}
        </MapView>
      )}

      <Pressable style={[styles.fab, { bottom: insets.bottom + space[4] }]} onPress={() => router.push({ pathname: '/place/[id]', params: { id: 'new' } })}>
        <MaterialCommunityIcons name="plus" size={28} color={colors.ground} />
      </Pressable>
    </View>
  );
}
