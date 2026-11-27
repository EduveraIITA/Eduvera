import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';
import { departureMapFrame, departurePointOnMap, type DepartureMapViewport } from '../DepartureMapPolicy';
import { ControlButton } from '../../ui/DomainControls';
import { themeRadii } from '../../ui/theme-tokens';
import { useTheme } from '../../ui/theme';
import { CAMPUS_AREA_SIMULATION_FEATURES, campusAreaPointAt, panCampusArea, type CampusAreaPoint } from './CampusAreaMapPolicy';
import { CampusAreaMapTile } from './CampusAreaMapTile';

const TILE_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_HEIGHT = 320;
export function CampusAreaMapSurface({ viewport, boundary, point, simulation, disabled, drawing, onViewport, onPoint, onReady }: {
  viewport: DepartureMapViewport;
  boundary: readonly CampusAreaPoint[];
  point?: CampusAreaPoint;
  simulation: boolean;
  disabled: boolean;
  drawing: boolean;
  onViewport: (viewport: DepartureMapViewport) => void;
  onPoint: (point: CampusAreaPoint) => void;
  onReady: (ready: boolean) => void;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [retry, setRetry] = useState(0);
  const [tileStatus, setTileStatus] = useState<Record<string, 'loaded' | 'error'>>({});
  const current = useRef({ viewport, width, drawing, onViewport, onPoint });
  const frame = useMemo(() => departureMapFrame(viewport, width, MAP_HEIGHT, simulation ? '' : TILE_TEMPLATE), [viewport, width, simulation]);
  const ready = simulation || frame.tiles.some(tile => tileStatus[tile.key] === 'loaded');
  current.current = { viewport, width, drawing: drawing && ready, onViewport, onPoint };
  const hasError = frame.tiles.some(tile => tileStatus[tile.key] === 'error');
  const tileKeys = frame.tiles.map(tile => tile.key).join(',');
  useEffect(() => {
    const active = new Set(tileKeys.split(','));
    setTileStatus(previous => {
      const entries = Object.entries(previous);
      const visible = entries.filter(([key]) => active.has(key));
      return entries.length === visible.length ? previous : Object.fromEntries(visible);
    });
  }, [tileKeys]);
  useEffect(() => onReady(ready), [ready, onReady]);
  const report = useMemo(() => (key: string, state: 'loaded' | 'error') => {
    setTileStatus(previous => previous[key] === state ? previous : { ...previous, [key]: state });
  }, []);
  const gesture = useMemo(() => {
    const pan = Gesture.Pan().runOnJS(true).enabled(!disabled).minDistance(7).maxPointers(1)
      .onUpdate(({ translationX: x, translationY: y }) => setDrag({ x, y }))
      .onEnd(({ translationX, translationY }, success) => {
        if (success) current.current.onViewport(panCampusArea(current.current.viewport, -translationX, -translationY));
      })
      .onFinalize(() => setDrag({ x: 0, y: 0 }));
    const tap = Gesture.Tap().runOnJS(true).enabled(!disabled).maxDistance(6)
      .onEnd(({ x, y }, success) => {
        const latest = current.current;
        if (success && latest.drawing && x >= 0 && x <= latest.width && y >= 0 && y <= MAP_HEIGHT) {
          latest.onPoint(campusAreaPointAt(latest.viewport, latest.width, MAP_HEIGHT, x, y));
        }
      });
    return Gesture.Race(pan, tap);
  }, [disabled]);
  const project = (candidate: CampusAreaPoint) => departurePointOnMap(candidate, frame);
  const asPath = (points: readonly CampusAreaPoint[]) => points.map(candidate => {
    const { x, y } = project(candidate);
    return `${x},${y}`;
  }).join(' ');
  const marker = point && !simulation ? project(point) : undefined;
  const mapLabel = simulation ? 'Campus boundary map. Fictional campus map.' : 'Campus boundary map';
  return <View>
    <GestureHandlerRootView style={styles.gesture}>
      <GestureDetector gesture={gesture} touchAction="none" userSelect="none">
        <View collapsable={false} accessible accessibilityRole="image" accessibilityLabel={mapLabel}
          onLayout={event => setWidth(event.nativeEvent.layout.width)}
          style={[styles.map, { backgroundColor: colors.row, borderColor: colors.border }]}>
          {width > 0 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: drag.x }, { translateY: drag.y }] }]}>
            {frame.tiles.map(tile => <CampusAreaMapTile key={`${retry}:${tile.key}`} tile={tile} onStatus={report} />)}
            <Svg width={width} height={MAP_HEIGHT} style={StyleSheet.absoluteFill} accessible={false}>
              {simulation ? <>
                <Polygon points={asPath(CAMPUS_AREA_SIMULATION_FEATURES.grounds)} fill={colors.mint} stroke={colors.positive} strokeWidth={1.5} />
                <Polyline points={asPath(CAMPUS_AREA_SIMULATION_FEATURES.path)} fill="none" stroke={colors.muted} strokeWidth={4} />
                {CAMPUS_AREA_SIMULATION_FEATURES.buildings.map((building, index) =>
                  <Polygon key={index} points={asPath(building)} fill={colors.gold} stroke={colors.warning} strokeWidth={1.5} />)}
              </> : null}
              {marker ? <Circle cx={marker.x} cy={marker.y} r={7} fill={colors.link} stroke={colors.surface} strokeWidth={2} /> : null}
              {boundary.length >= 3 ? <Polygon points={asPath(boundary)} fill={colors.action} fillOpacity={.18} stroke={colors.action} strokeWidth={2.5} strokeLinejoin="round" /> : null}
              {boundary.length === 2 ? <Polyline points={asPath(boundary)} fill="none" stroke={colors.action} strokeWidth={2.5} /> : null}
              {boundary.map((candidate, index) => {
                const { x, y } = project(candidate);
                return <Circle key={index} cx={x} cy={y} r={5} fill={colors.action} stroke={colors.surface} strokeWidth={1.5} />;
              })}
            </Svg>
          </View> : null}
          {drawing && width > 0 ? <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Svg width={width} height={MAP_HEIGHT} accessible={false}>
              <Circle cx={width / 2} cy={MAP_HEIGHT / 2} r={9} stroke={colors.surface} strokeWidth={3} fill="none" />
              <Circle cx={width / 2} cy={MAP_HEIGHT / 2} r={9} stroke={colors.ink} strokeWidth={1.5} fill="none" />
              <Line x1={width / 2 - 4} x2={width / 2 + 4} y1={MAP_HEIGHT / 2} y2={MAP_HEIGHT / 2} stroke={colors.ink} strokeWidth={1.5} />
              <Line x1={width / 2} x2={width / 2} y1={MAP_HEIGHT / 2 - 4} y2={MAP_HEIGHT / 2 + 4} stroke={colors.ink} strokeWidth={1.5} />
            </Svg>
          </View> : null}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
    {simulation ? <Text style={[styles.attribution, { backgroundColor: colors.surface, color: colors.muted }]}>Fictional campus map</Text> : <Text
      accessibilityRole="link" onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {})}
      style={[styles.attribution, { backgroundColor: colors.surface, color: colors.link }]}>© OpenStreetMap contributors</Text>}
    {!simulation && !ready ? <View pointerEvents="none" style={styles.message}>
      <Text accessibilityLiveRegion="polite" style={[styles.loading, { backgroundColor: colors.surface, color: colors.ink }]}>
        {hasError ? 'Map imagery is unavailable' : 'Loading map…'}
      </Text>
    </View> : null}
    {hasError ? <View style={styles.retry}>
      <ControlButton title="Retry map tiles" disabled={disabled} onPress={() => { setTileStatus({}); setRetry(value => value + 1); }} />
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  gesture: { height: MAP_HEIGHT, flexGrow: 0 },
  map: { flex: 1, overflow: 'hidden', borderRadius: themeRadii.radiusControl, borderWidth: StyleSheet.hairlineWidth },
  attribution: { position: 'absolute', top: MAP_HEIGHT - 30, right: 6, borderRadius: 4, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 4, fontSize: 12, lineHeight: 16 },
  message: { position: 'absolute', width: '100%', top: MAP_HEIGHT / 2 - 18, alignItems: 'center' },
  loading: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, overflow: 'hidden', fontSize: 14, lineHeight: 20 },
  retry: { alignSelf: 'flex-end' },
});
