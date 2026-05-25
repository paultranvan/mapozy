import { View, StyleSheet, Text } from 'react-native';
import MapLibreGL, {
  MapView,
  ShapeSource,
  LineLayer,
  PointAnnotation,
  Camera,
} from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { MODE_COLORS } from '../theme/colors';
import type { Trip } from '../types';

MapLibreGL.setAccessToken(null);

const OSM_STYLE = {
  version: 8,
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm-raster' }],
};

export function TripMap({ trip }: { trip: Trip }) {
  const allCoords = useMemo<Array<[number, number]>>(() => {
    try {
      const g = JSON.parse(trip.geojson);
      return Array.isArray(g.coordinates) ? g.coordinates : [];
    } catch {
      return [];
    }
  }, [trip.geojson]);

  if (allCoords.length === 0) {
    return (
      <View style={[styles.container, styles.empty]}>
        <Text>No GPS trace available for this trip</Text>
      </View>
    );
  }

  const lons = allCoords.map((c) => c[0]);
  const lats = allCoords.map((c) => c[1]);
  const sw: [number, number] = [Math.min(...lons), Math.min(...lats)];
  const ne: [number, number] = [Math.max(...lons), Math.max(...lats)];

  return (
    <MapView style={styles.container} mapStyle={OSM_STYLE as unknown as string}>
      <Camera
        bounds={{
          ne,
          sw,
          paddingLeft: 40,
          paddingRight: 40,
          paddingTop: 60,
          paddingBottom: 280,
        }}
        animationMode="moveTo"
        animationDuration={0}
      />
      {trip.sections.map((s, i) => {
        let coords: Array<[number, number]> = [];
        try {
          const g = JSON.parse(s.geojson);
          if (Array.isArray(g.coordinates)) coords = g.coordinates;
        } catch {
          // ignore
        }
        if (coords.length < 2) return null;
        return (
          <ShapeSource
            key={i}
            id={`section-${i}`}
            shape={{
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: coords },
              properties: {},
            }}
          >
            <LineLayer
              id={`line-${i}`}
              style={{
                lineColor: MODE_COLORS[s.mode],
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: 0.9,
              }}
            />
          </ShapeSource>
        );
      })}
      <PointAnnotation id="start" coordinate={allCoords[0]!}>
        <View style={styles.startDot} />
      </PointAnnotation>
      <PointAnnotation
        id="end"
        coordinate={allCoords[allCoords.length - 1]!}
      >
        <View style={styles.endDot} />
      </PointAnnotation>
    </MapView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  startDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2A9D8F',
    borderWidth: 3,
    borderColor: 'white',
  },
  endDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E76F51',
    borderWidth: 3,
    borderColor: 'white',
  },
});
