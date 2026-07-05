import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Text } from '@/ui/Text';
import { t } from '@/i18n';
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
  haversineMeters,
} from '../lib/distance';
import type { Trip, Place } from '../types';

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
// Endpoint anchoring to the resolved start/end place. The trace routinely
// starts or ends tens-to-hundreds of metres from the actual door: GPS cold
// start after leaving a geofenced stay, or stop detection ending the trip a
// noise-bound short of the place. When a place is resolved, the marker sits
// on the place itself; if the trace endpoint is farther than
// ANCHOR_CONNECT_MIN_M a dashed connector bridges trace and marker — the same
// visual language as gap connectors (no GPS along it, but the endpoints are
// known). Past ANCHOR_MAX_M the place is no longer credibly the visual
// endpoint (e.g. a stale carried-over seed place) and we fall back to the
// trace endpoint.
const ANCHOR_MAX_M = 2000;
const ANCHOR_CONNECT_MIN_M = 30;

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

function parseLineCoords(geojson: string): Array<[number, number]> {
  try {
    const g = JSON.parse(geojson);
    return Array.isArray(g.coordinates) ? g.coordinates : [];
  } catch {
    return [];
  }
}

// Where an endpoint marker should sit, and whether a dashed connector to the
// trace endpoint is needed. `at` is the trace endpoint when no place anchors.
function anchorEndpoint(
  place: Place | null | undefined,
  traceEnd: [number, number] | undefined
): { at: [number, number]; connector: [[number, number], [number, number]] | null } | null {
  if (!traceEnd) return null;
  if (!place) return { at: traceEnd, connector: null };
  const placeCoord: [number, number] = [place.longitude, place.latitude];
  const d = haversineMeters(place.latitude, place.longitude, traceEnd[1], traceEnd[0]);
  if (d > ANCHOR_MAX_M) return { at: traceEnd, connector: null };
  return {
    at: placeCoord,
    connector: d > ANCHOR_CONNECT_MIN_M ? [traceEnd, placeCoord] : null,
  };
}

export function TripMap({
  trip,
  startPlace,
  endPlace,
}: {
  trip: Trip;
  startPlace?: Place | null;
  endPlace?: Place | null;
}) {
  const allCoords = useMemo<Array<[number, number]>>(
    () => parseLineCoords(trip.geojson),
    [trip.geojson]
  );

  const { width: winW, height: winH } = useWindowDimensions();

  const startAnchor = useMemo(
    () => anchorEndpoint(startPlace, allCoords[0]),
    [startPlace, allCoords]
  );
  const endAnchor = useMemo(
    () => anchorEndpoint(endPlace, allCoords[allCoords.length - 1]),
    [endPlace, allCoords]
  );

  // Bounds + ref lat are derived from the trip, not from zoom — memoize them
  // so the Camera's `bounds` prop has a stable reference and isn't re-applied
  // every time `zoom` state changes (which would snap the camera back over
  // the user's pinch / pan).
  const { bounds, refLat, initialZoom } = useMemo(() => {
    const anchorCoords = [startAnchor?.at, endAnchor?.at].filter(
      (c): c is [number, number] => c != null
    );
    const boundCoords = [...allCoords, ...anchorCoords];
    const lons = boundCoords.map((c) => c[0]);
    const lats = boundCoords.map((c) => c[1]);
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
  }, [allCoords, startAnchor, endAnchor, winW, winH]);

  // Dashed connectors across data gaps. A break with `ordering === k` and
  // `gap` set sits between sections[k] and sections[k+1] (see assemble.ts);
  // the GPS was suspended/lost, so we bridge the last point of the preceding
  // section to the first point of the following one with a dashed line — the
  // trace reads as continuous instead of silently broken.
  const gapConnectors = useMemo<Array<[[number, number], [number, number]]>>(() => {
    const out: Array<[[number, number], [number, number]]> = [];
    for (const b of trip.breaks) {
      if (!b.gap) continue;
      const prev = trip.sections.find((s) => s.ordering === b.ordering);
      const next = trip.sections.find((s) => s.ordering === b.ordering + 1);
      if (!prev || !next) continue;
      const pc = parseLineCoords(prev.geojson);
      const nc = parseLineCoords(next.geojson);
      if (pc.length === 0 || nc.length === 0) continue;
      out.push([pc[pc.length - 1]!, nc[0]!]);
    }
    return out;
  }, [trip.breaks, trip.sections]);

  // Seed the zoom from the fit estimate so the very first render already
  // computes the right trim — avoids the visible "trace snaps to edge" once
  // onRegionDidChange fires with the post-fitBounds zoom.
  const [zoom, setZoom] = useState<number>(initialZoom);
  const trimM = TARGET_GAP_PX * metersPerPixel(zoom, refLat);

  // Early return AFTER all hooks so hook order stays stable across renders.
  if (allCoords.length === 0) {
    return (
      <View style={[styles.container, styles.empty]}>
        <Text>{t('map.noTraceTrip')}</Text>
      </View>
    );
  }

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
        // Prefer the road-snapped geometry when map-matching produced one;
        // fall back to the raw trace otherwise.
        let coords = parseLineCoords(s.matchedGeojson ?? s.geojson);
        if (coords.length < 2) return null;
        // Trim only when the marker actually sits on the trace endpoint —
        // an anchored marker is on the place, away from the trace, and
        // trimming there would leave the line floating short of nothing.
        const isFirst = i === 0 && startAnchor?.connector == null;
        const isLast =
          i === trip.sections.length - 1 && endAnchor?.connector == null;
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
      {[
        ...gapConnectors,
        ...(startAnchor?.connector ? [startAnchor.connector] : []),
        ...(endAnchor?.connector ? [endAnchor.connector] : []),
      ].map(([from, to], i) => (
        <ShapeSource
          key={`gap-${i}`}
          id={`gap-${i}`}
          shape={{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [from, to] },
            properties: {},
          }}
        >
          <LineLayer
            id={`gap-line-${i}`}
            style={{
              lineColor: themeColors.inkSoft,
              lineWidth: 3,
              lineCap: 'round',
              lineDasharray: [1.5, 2.5],
              lineOpacity: 0.55,
            }}
          />
        </ShapeSource>
      ))}
      <PointAnnotation
        id="start"
        coordinate={startAnchor?.at ?? allCoords[0]!}
        anchor={{ x: 0.5, y: 0.5 }}
      >
        <View style={[styles.marker, styles.startMarker]}>
          <MaterialCommunityIcons name="play" size={18} color={themeColors.surface} />
        </View>
      </PointAnnotation>
      <PointAnnotation
        id="end"
        coordinate={endAnchor?.at ?? allCoords[allCoords.length - 1]!}
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
