import { useEffect, useState } from 'react';
import { View, TextInput, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MapLibreGL, {
  MapView,
  Camera,
  PointAnnotation,
} from '@maplibre/maplibre-react-native';
import { colors, space } from '@/theme/tokens';
import { OSM_STYLE } from '@/ui/mapStyle';
import { Text } from '@/ui/Text';
import { PlaceBadge } from '@/ui/PlaceBadge';
import { PLACE_CATEGORIES } from '@/ui/placeCategories';
import { externalApiAllowed } from '@/lib/net';
import { searchAddress, type AddressHit } from '@/lib/geocodeSearch';
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
    }
  }, [existing.data]);

  useEffect(() => {
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

  const onSave = async () => {
    const input = {
      name: name.trim() || 'Sans nom',
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
      Alert.alert('Erreur', "Impossible de supprimer le lieu.");
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: space[6] }}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()}>
          <Text variant="body" color={colors.inkSoft}>
            Annuler
          </Text>
        </Pressable>
        <Pressable onPress={onSave}>
          <Text variant="body" color={colors.accent}>
            Enregistrer
          </Text>
        </Pressable>
      </View>

      <Text variant="label" color={colors.inkSoft} style={styles.lbl}>
        NOM
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="ex. Basic-Fit"
        style={styles.input}
      />

      <Text variant="label" color={colors.inkSoft} style={styles.lbl}>
        CATÉGORIE
      </Text>
      <View style={styles.grid}>
        {PLACE_CATEGORIES.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => setCategory(c.key)}
            style={[styles.cell, category === c.key && styles.cellOn]}
          >
            <PlaceBadge category={c.key} size={36} />
          </Pressable>
        ))}
      </View>

      {externalApiAllowed() && (
        <>
          <Text variant="label" color={colors.inkSoft} style={styles.lbl}>
            ADRESSE
          </Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher une adresse"
            style={styles.input}
          />
          {hits.map((h, i) => (
            <Pressable
              key={i}
              style={styles.hit}
              onPress={() => {
                setCoord([h.lon, h.lat]);
                setQuery(h.label);
                setHits([]);
              }}
            >
              <Text variant="label" color={colors.ink} numberOfLines={1}>
                {h.label}
              </Text>
            </Pressable>
          ))}
        </>
      )}

      <Text variant="label" color={colors.inkSoft} style={styles.lbl}>
        POSITION &amp; RAYON
      </Text>
      <View style={styles.mapBox}>
        <MapView style={{ flex: 1 }} mapStyle={OSM_STYLE as unknown as string}>
          <Camera centerCoordinate={coord} zoomLevel={15} animationDuration={0} />
          <PointAnnotation
            id="pin"
            coordinate={coord}
            draggable
            onDragEnd={(e) => setCoord(e.geometry.coordinates as [number, number])}
          >
            <PlaceBadge category={category} />
          </PointAnnotation>
        </MapView>
      </View>
      <View style={styles.sliderRow}>
        <Pressable
          style={styles.step}
          onPress={() => setRadius((r) => Math.max(30, r - 10))}
        >
          <Text variant="body" color={colors.ink}>
            −
          </Text>
        </Pressable>
        <Text variant="label" color={colors.accent} style={styles.radiusVal}>
          {Math.round(radius)} m
        </Text>
        <Pressable
          style={styles.step}
          onPress={() => setRadius((r) => Math.min(500, r + 10))}
        >
          <Text variant="body" color={colors.ink}>
            ＋
          </Text>
        </Pressable>
      </View>

      {clusters.data && clusters.data.length > 0 && (
        <>
          <Text variant="label" color={colors.inkSoft} style={styles.lbl}>
            DEPUIS UN ARRÊT FRÉQUENT
          </Text>
          {clusters.data.map((c: Place) => (
            <Pressable
              key={c.id}
              style={styles.hit}
              onPress={() => setCoord([c.longitude, c.latitude])}
            >
              <Text variant="label" color={colors.ink} numberOfLines={1}>
                {c.displayName ?? `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`} ·{' '}
                {c.visitCount}×
              </Text>
            </Pressable>
          ))}
        </>
      )}

      {!isNew && (
        <Pressable onPress={onDelete} style={styles.del}>
          <Text variant="body" color="#b04632">
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
    padding: space[3],
  },
  lbl: {
    marginTop: space[3],
    marginHorizontal: space[3],
    marginBottom: space[1],
  },
  input: {
    marginHorizontal: space[3],
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    color: colors.ink,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    paddingHorizontal: space[3],
  },
  cell: { padding: 4, borderRadius: 12 },
  cellOn: { backgroundColor: colors.accentSoft },
  hit: {
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  mapBox: {
    height: 200,
    marginHorizontal: space[3],
    borderRadius: 12,
    overflow: 'hidden',
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[4],
    paddingHorizontal: space[3],
    marginTop: space[2],
  },
  step: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radiusVal: { minWidth: 56, textAlign: 'center' },
  del: { alignItems: 'center', marginTop: space[5] },
});
