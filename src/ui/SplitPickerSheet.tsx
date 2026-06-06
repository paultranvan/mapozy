import { Modal, View, StyleSheet, Pressable } from 'react-native';
import MapLibreGL, {
  MapView,
  ShapeSource,
  LineLayer,
  PointAnnotation,
  Camera,
} from '@maplibre/maplibre-react-native';
import { useMemo, useState } from 'react';
import { Text } from './Text';
import { colors, space, radii } from '@/theme/tokens';
import { parseCoords } from '@/pipeline/edits/sectionGeometry';
import { haversineMeters } from '@/lib/distance';

MapLibreGL.setAccessToken(null);
const OSM_STYLE = {
  version: 8,
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm-raster' }],
};

function nearestVertex(coords: Array<[number, number]>, p: [number, number]): number {
  let best = 1;
  let bestD = Infinity;
  for (let i = 1; i < coords.length - 1; i++) {
    const c = coords[i]!;
    const d = haversineMeters(p[1], p[0], c[1], c[0]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function SplitPickerSheet({
  visible,
  title,
  geojsons,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  geojsons: string[];
  onConfirm: (point: [number, number]) => void;
  onClose: () => void;
}) {
  const lines = useMemo(
    () => geojsons.map(parseCoords).filter((c) => c.length >= 2),
    [geojsons]
  );
  const allCoords = useMemo(() => lines.flat(), [lines]);
  const interior = useMemo(
    () => allCoords.filter((_, i) => i > 0 && i < allCoords.length - 1),
    [allCoords]
  );
  const [handle, setHandle] = useState<[number, number] | null>(null);
  const current =
    handle ?? interior[Math.floor(interior.length / 2)] ?? allCoords[0] ?? null;

  const bounds = useMemo(() => {
    if (allCoords.length === 0) return null;
    const lons = allCoords.map((c) => c[0]);
    const lats = allCoords.map((c) => c[1]);
    return {
      sw: [Math.min(...lons), Math.min(...lats)] as [number, number],
      ne: [Math.max(...lons), Math.max(...lats)] as [number, number],
      paddingLeft: 40,
      paddingRight: 40,
      paddingTop: 80,
      paddingBottom: 140,
    };
  }, [allCoords]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {bounds && current ? (
          <MapView style={StyleSheet.absoluteFill} mapStyle={OSM_STYLE as unknown as string}>
            <Camera bounds={bounds} animationDuration={0} />
            {lines.map((coords, i) => (
              <ShapeSource
                key={i}
                id={`split-line-${i}`}
                shape={{
                  type: 'Feature',
                  geometry: { type: 'LineString', coordinates: coords },
                  properties: {},
                }}
              >
                <LineLayer
                  id={`split-layer-${i}`}
                  style={{
                    lineColor: colors.accent,
                    lineWidth: 5,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </ShapeSource>
            ))}
            <PointAnnotation
              id="split-handle"
              coordinate={current}
              draggable
              anchor={{ x: 0.5, y: 0.5 }}
              onDragEnd={(e) => {
                const c = e.geometry.coordinates as [number, number];
                const idx = nearestVertex(allCoords, c);
                setHandle(allCoords[idx] ?? c);
              }}
            >
              <View style={styles.handle} />
            </PointAnnotation>
          </MapView>
        ) : (
          <View style={styles.center}>
            <Text>No trace to split</Text>
          </View>
        )}
        <View style={styles.bar}>
          <Text variant="title" style={styles.title}>
            {title}
          </Text>
          <View style={styles.buttons}>
            <Pressable style={[styles.btn, styles.cancel]} onPress={onClose}>
              <Text variant="title">Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.confirm]}
              onPress={() => current && onConfirm(current)}
            >
              <Text variant="title" style={{ color: colors.surface }}>
                Cut here
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  handle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surface,
    borderWidth: 4,
    borderColor: colors.ink,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space[4],
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    gap: space[3],
  },
  title: { textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: space[3] },
  btn: { flex: 1, paddingVertical: space[3], borderRadius: radii.pill, alignItems: 'center' },
  cancel: { backgroundColor: colors.surfaceMuted },
  confirm: { backgroundColor: colors.accent },
});
