import { View, StyleSheet, Text, useWindowDimensions } from 'react-native';
import MapLibreGL, {
  MapView,
  ShapeSource,
  LineLayer,
  PointAnnotation,
  Camera,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { colors as themeColors, MODE_COLORS } from '../theme/tokens';
import { OSM_STYLE } from './mapStyle';
import { effectiveMode } from '../pipeline/effectiveMode';
import {
  trimLineFromStart,
  trimLineFromEnd,
  pathLengthMeters,
} from '../lib/distance';
import type { Trip } from '../types';

// Distance, in screen pixels, between the geographic trace endpoint and the
// marker center. The marker's coloured fill has a 15 px radius — using 16
// makes the line endpoint sit right at the outer edge of the fill so the
// trace visually "touches" the icon without overlapping it.
const TARGET_GAP_PX = 16;
// Never trim more than this fraction of a section length — keeps short
// sections visible when zoomed out where TARGET_GAP_PX would otherwise
// translate to a huge geographic distance.
const MAX_TRIM_FRACTION = 0.45;
// Camera bounds padding, in dp. Must match the values passed to
// `<Camera bounds={...}>` below — used twice (camera config + initial-zoom
// estimate) so keep them as a single source of truth.
const PAD = { left: 40, right: 40, top: 60, bottom: 280 };

function metersPerPixel(zoom: number, latDeg: number): number {
  const cosLat = Math.cos((latDeg * Math.PI) / 180);
  // MapLibre uses 512-px world tiles, so the world is 512 × 2^z pixels wide
  // at zoom z — half the meters-per-pixel of the classic 256-tile (OSM-style)
  // formula. The OSM raster source rendered here is upscaled accordingly.
  return (78271.517 * cosLat) / Math.pow(2, zoom);
}

// Approximate the zoom MapLibre will pick to fit `bounds` inside the padded
// viewport. Used so the FIRST paint already trims the trace correctly; without
// it the trace visibly snaps to the marker edge once onRegionDidChange fires
// with the post-fitBounds zoom.
function estimateFitZoom(
  sw: [number, number],
  ne: [number, number],
  viewW: number,
  viewH: number
): number {
  if (viewW <= 0 || viewH <= 0) return 14;
  const lonSpan = Math.max(1e-9, ne[0] - sw[0]);
  // Mercator y in [-π, π]; world height = 2π.
  const mercY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const latSpanMerc = Math.max(1e-9, Math.abs(mercY(ne[1]) - mercY(sw[1])));
  // World width / height at zoom z is 512 × 2^z. Lon span occupies
  // (lonSpan/360) of the world, lat span occupies (latSpanMerc/2π).
  const zoomLon = Math.log2((viewW * 360) / (lonSpan * 512));
  const zoomLat = Math.log2((viewH * 2 * Math.PI) / (latSpanMerc * 512));
  // Clamp to plausible range to avoid weird first paints on degenerate input.
  return Math.max(2, Math.min(20, Math.min(zoomLon, zoomLat)));
}

MapLibreGL.setAccessToken(null);

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

  const { width: winW, height: winH } = useWindowDimensions();

  // Bounds + ref lat are derived from the trip, not from zoom — memoize them
  // so the Camera's `bounds` prop has a stable reference and isn't re-applied
  // every time `zoom` state changes (which would snap the camera back over
  // the user's pinch / pan).
  const { bounds, refLat, initialZoom } = useMemo(() => {
    const lons = allCoords.map((c) => c[0]);
    const lats = allCoords.map((c) => c[1]);
    const sw: [number, number] = [Math.min(...lons), Math.min(...lats)];
    const ne: [number, number] = [Math.max(...lons), Math.max(...lats)];
    const viewW = Math.max(1, winW - PAD.left - PAD.right);
    const viewH = Math.max(1, winH - PAD.top - PAD.bottom);
    return {
      bounds: {
        ne,
        sw,
        paddingLeft: PAD.left,
        paddingRight: PAD.right,
        paddingTop: PAD.top,
        paddingBottom: PAD.bottom,
      },
      refLat: (sw[1] + ne[1]) / 2,
      initialZoom: estimateFitZoom(sw, ne, viewW, viewH),
    };
  }, [allCoords, winW, winH]);

  // Seed the zoom from the fit estimate so the very first render already
  // computes the right trim — avoids the visible "trace snaps to edge" once
  // onRegionDidChange fires with the post-fitBounds zoom.
  const [zoom, setZoom] = useState<number>(initialZoom);
  const trimM = TARGET_GAP_PX * metersPerPixel(zoom, refLat);

  return (
    <MapView
      style={styles.container}
      mapStyle={OSM_STYLE as unknown as string}
      onRegionDidChange={(e) => setZoom(e.properties.zoomLevel)}
    >
      <Camera
        bounds={bounds}
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
        const isFirst = i === 0;
        const isLast = i === trip.sections.length - 1;
        if (isFirst || isLast) {
          const cap = pathLengthMeters(coords) * MAX_TRIM_FRACTION;
          const trim = Math.min(trimM, cap);
          if (isFirst) coords = trimLineFromStart(coords, trim);
          if (isLast) coords = trimLineFromEnd(coords, trim);
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
                lineColor: MODE_COLORS[effectiveMode(s)],
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: 0.9,
              }}
            />
          </ShapeSource>
        );
      })}
      <PointAnnotation id="start" coordinate={allCoords[0]!} anchor={{ x: 0.5, y: 0.5 }}>
        <View style={[styles.marker, styles.startMarker]}>
          <MaterialCommunityIcons name="play" size={18} color={themeColors.surface} />
        </View>
      </PointAnnotation>
      <PointAnnotation
        id="end"
        coordinate={allCoords[allCoords.length - 1]!}
        anchor={{ x: 0.5, y: 0.5 }}
      >
        <View style={[styles.marker, styles.endMarker]}>
          <MaterialCommunityIcons
            name="flag-checkered"
            size={16}
            color={themeColors.surface}
          />
        </View>
      </PointAnnotation>
    </MapView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  marker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: themeColors.surface,
    // Subtle shadow so markers pop above the trace.
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 3,
  },
  startMarker: {
    backgroundColor: themeColors.start,
  },
  endMarker: {
    backgroundColor: themeColors.end,
  },
});
