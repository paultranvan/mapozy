import { useEffect, useMemo, useRef, useState } from 'react';
import { View, TextInput, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MapLibreGL, {
  MapView,
  Camera,
  PointAnnotation,
  ShapeSource,
  FillLayer,
  LineLayer,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, space } from '@/theme/tokens';
import { OSM_STYLE } from '@/ui/mapStyle';
import { Text } from '@/ui/Text';
import { PlaceBadge } from '@/ui/PlaceBadge';
import { PLACE_CATEGORIES, categoryMeta } from '@/ui/placeCategories';
import { circlePolygon } from '@/lib/circle';
import { externalApiAllowed } from '@/lib/net';
import { searchAddress, type AddressHit } from '@/lib/geocodeSearch';
import { reverseGeocode } from '@/pipeline/geocoding';
import {
  useUserPlace,
  useCreateUserPlace,
  useUpdateUserPlace,
  useDeleteUserPlace,
  useUnnamedClusters,
} from '@/queries/usePlaces';
import type { Place, PlaceCategory } from '@/types';

MapLibreGL.setAccessToken(null);
const DEFAULT_RADIUS = 100;

export default function PlaceEditor() {
  const params = useLocalSearchParams<{
    id: string;
    lat?: string;
    lon?: string;
    category?: string;
    name?: string;
  }>();
  const router = useRouter();
  const isNew = params.id === 'new';
  const editId = isNew ? null : Number(params.id);
  const existing = useUserPlace(editId);

  const [name, setName] = useState(params.name ?? '');
  const [category, setCategory] = useState<PlaceCategory>(
    (params.category as PlaceCategory) ?? 'home',
  );
  const [coord, setCoord] = useState<[number, number]>([
    params.lon ? Number(params.lon) : 4.85,
    params.lat ? Number(params.lat) : 45.75,
  ]);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [focused, setFocused] = useState(false);
  const [showRadiusHelp, setShowRadiusHelp] = useState(false);
  const dragSeqRef = useRef(0);
  const skipSearchRef = useRef(false);

  const clusters = useUnnamedClusters();
  const create = useCreateUserPlace();
  const update = useUpdateUserPlace();
  const remove = useDeleteUserPlace();

  useEffect(() => {
    if (existing.data) {
      setName(existing.data.name ?? '');
      setCategory(existing.data.category ?? 'home');
      setCoord([existing.data.longitude, existing.data.latitude]);
      setRadius(existing.data.radiusM);
      if (existing.data.displayName) setQuery(existing.data.displayName);
    }
  }, [existing.data]);

  useEffect(() => {
    if (skipSearchRef.current) { skipSearchRef.current = false; setHits([]); return; }
    if (!externalApiAllowed() || query.trim().length < 3) {
      setHits([]);
      return;
    }
    // Intentionally depends only on `query`: fires debounced search on every
    // keystroke; externalApiAllowed() is a sync read of a module-level flag
    // and does not need to be in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const t = setTimeout(async () => setHits(await searchAddress(query)), 400);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!isNew || !params.lat || !params.lon) return;
    let cancelled = false;
    (async () => {
      const addr = await reverseGeocode(Number(params.lat), Number(params.lon));
      if (!cancelled && addr) {
        skipSearchRef.current = true; // don't trigger autocomplete from this programmatic set
        setQuery(addr);
      }
    })();
    return () => { cancelled = true; };
  }, [isNew, params.lat, params.lon]);

  const ring = useMemo(() => circlePolygon(coord[0], coord[1], radius), [coord, radius]);
  const meta = categoryMeta(category);
  const showFrequent = focused && query.trim().length < 3 && (clusters.data?.length ?? 0) > 0;
  const showHits = focused && hits.length > 0;

  const moveTo = (lon: number, lat: number, label: string) => {
    setCoord([lon, lat]);
    setQuery(label);
    setHits([]);
    setFocused(false);
  };

  const onDragEnd = async (e: GeoJSON.Feature<GeoJSON.Point>) => {
    setFocused(false);
    const seq = ++dragSeqRef.current;
    const lon = e.geometry.coordinates[0]!;
    const lat = e.geometry.coordinates[1]!;
    setCoord([lon, lat]);
    const addr = await reverseGeocode(lat, lon);
    if (addr && seq === dragSeqRef.current) {
      skipSearchRef.current = true;
      setQuery(addr);
    }
  };

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Nom requis', "Donne un nom à ce lieu avant d'enregistrer.");
      return;
    }
    const input = {
      name: trimmed,
      category,
      latitude: coord[1],
      longitude: coord[0],
      radiusM: Math.round(radius),
    };
    try {
      if (isNew) await create.mutateAsync(input);
      else if (editId !== null) await update.mutateAsync({ id: editId, input });
      router.back();
    } catch {
      Alert.alert('Erreur', "Impossible d'enregistrer le lieu.");
    }
  };

  const onDelete = async () => {
    if (editId === null) return;
    try {
      await remove.mutateAsync(editId);
      router.back();
    } catch {
      Alert.alert('Erreur', 'Impossible de supprimer le lieu.');
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: space[6] }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()}>
          <Text variant="body" color={colors.inkSoft}>
            Annuler
          </Text>
        </Pressable>
        <Text variant="body" color={colors.ink}>
          {isNew ? 'Nouveau lieu' : 'Modifier'}
        </Text>
        <Pressable onPress={onSave}>
          <Text variant="body" color={name.trim() ? colors.accent : colors.inkSoft}>
            Enregistrer
          </Text>
        </Pressable>
      </View>

      <Text variant="label" color={colors.inkSoft} style={styles.sec}>
        NOM
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Nom du lieu (ex. Basic-Fit)"
        placeholderTextColor={colors.inkSoft}
        style={styles.input}
      />

      <Text variant="label" color={colors.inkSoft} style={styles.sec}>
        EMPLACEMENT
      </Text>

      <View style={styles.searchBar}>
        <MaterialCommunityIcons name="magnify" size={16} color={colors.inkSoft} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          placeholder="Rechercher une adresse"
          placeholderTextColor={colors.inkSoft}
          style={styles.searchInput}
        />
      </View>

      {(showHits || showFrequent) && (
        <View style={styles.dropdown}>
          {showHits
            ? hits.map((h, i) => (
                <Pressable
                  key={i}
                  style={styles.drow}
                  onPress={() => moveTo(h.lon, h.lat, h.label)}
                >
                  <MaterialCommunityIcons
                    name="map-marker-outline"
                    size={14}
                    color={colors.inkSoft}
                  />
                  <Text variant="label" color={colors.ink} numberOfLines={1}>
                    {h.label}
                  </Text>
                </Pressable>
              ))
            : (clusters.data ?? []).map((c: Place) => {
                const label =
                  c.displayName ?? `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`;
                return (
                  <Pressable
                    key={c.id}
                    style={styles.drow}
                    onPress={() => moveTo(c.longitude, c.latitude, label)}
                  >
                    <MaterialCommunityIcons name="history" size={14} color={colors.inkSoft} />
                    <Text variant="label" color={colors.ink} numberOfLines={1}>
                      {label} · {c.visitCount}×
                    </Text>
                  </Pressable>
                );
              })}
        </View>
      )}

      <View style={styles.mapBox}>
        <MapView style={{ flex: 1 }} mapStyle={OSM_STYLE as unknown as string}>
          <Camera centerCoordinate={coord} zoomLevel={15} animationDuration={0} />
          <ShapeSource id="radiusRing" shape={ring}>
            <FillLayer id="radiusFill" style={{ fillColor: meta.color, fillOpacity: 0.15 }} />
            <LineLayer
              id="radiusLine"
              style={{ lineColor: meta.color, lineWidth: 2, lineOpacity: 0.85 }}
            />
          </ShapeSource>
          <PointAnnotation
            id="pin"
            coordinate={coord}
            draggable
            onDragEnd={onDragEnd}
          >
            <PlaceBadge category={category} />
          </PointAnnotation>
        </MapView>
      </View>

      <View style={styles.radiusRow}>
        <View style={styles.radiusLabel}>
          <Text variant="label" color={colors.inkSoft}>Rayon</Text>
          <Pressable onPress={() => setShowRadiusHelp((v) => !v)} hitSlop={8}>
            <MaterialCommunityIcons name="information-outline" size={15} color={colors.inkSoft} />
          </Pressable>
        </View>
        <Pressable style={styles.step} onPress={() => setRadius((r) => Math.max(30, r - 10))}>
          <Text variant="body" color={colors.ink}>
            −
          </Text>
        </Pressable>
        <Text variant="label" color={colors.accent} style={styles.radiusVal}>
          {Math.round(radius)} m
        </Text>
        <Pressable style={styles.step} onPress={() => setRadius((r) => Math.min(500, r + 10))}>
          <Text variant="body" color={colors.ink}>
            ＋
          </Text>
        </Pressable>
      </View>
      {showRadiusHelp && (
        <Text variant="label" color={colors.inkSoft} style={styles.radiusCaption}>
          Un trajet qui démarre ou se termine dans ce rayon est rattaché à ce lieu.
        </Text>
      )}

      <Text variant="label" color={colors.inkSoft} style={styles.sec}>
        CATÉGORIE
      </Text>
      <View style={styles.grid}>
        {PLACE_CATEGORIES.map((c) => {
          const on = category === c.key;
          return (
            <Pressable key={c.key} onPress={() => setCategory(c.key)} style={[styles.chip, on ? { backgroundColor: c.color, borderColor: c.color } : null]}>
              <MaterialCommunityIcons name={c.icon} size={20} color={on ? '#fff' : c.color} />
              <Text variant="label" color={on ? '#fff' : colors.ink}>{c.labelFr}</Text>
            </Pressable>
          );
        })}
      </View>

      {!isNew && (
        <Pressable onPress={onDelete} style={styles.del}>
          <Text variant="body" color={colors.danger}>
            Supprimer ce lieu
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: space[3],
  },
  sec: {
    marginTop: space[3],
    marginHorizontal: space[3],
    marginBottom: space[1],
    letterSpacing: 0.5,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginHorizontal: space[3],
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  searchInput: { flex: 1, color: colors.ink, padding: 0 },
  dropdown: {
    marginHorizontal: space[3],
    marginTop: 2,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  drow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  mapBox: {
    height: 220,
    marginHorizontal: space[3],
    marginTop: space[2],
    borderRadius: 12,
    overflow: 'hidden',
  },
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    marginTop: space[2],
  },
  radiusLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[1] },
  step: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radiusVal: { minWidth: 48, textAlign: 'center' },
  radiusCaption: { marginHorizontal: space[3], marginTop: space[1] },
  input: {
    marginHorizontal: space[3],
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    color: colors.ink,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], paddingHorizontal: space[3], paddingTop: space[2] },
  chip: { flexBasis: '22%', flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: space[2], paddingHorizontal: space[1], borderRadius: 14, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
  del: { alignItems: 'center', marginTop: space[5] },
});
