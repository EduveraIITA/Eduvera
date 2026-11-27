import { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';
import { departureMapFrame, departurePointOnMap, type DepartureMapViewport } from '../DepartureMapPolicy';
import { ControlButton } from '../../ui/DomainControls';
import { themeRadii } from '../../ui/theme-tokens';
import { useTheme } from '../../ui/theme';
import { CAMPUS_AREA_SIMULATION_FEATURES, type CampusAreaPoint } from './CampusAreaMapPolicy';
import { CampusAreaMapTile } from './CampusAreaMapTile';
import { useCampusAreaMapGestures } from './useCampusAreaMapGestures';

const TILE_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function CampusAreaMapSurface({ viewport, boundary, point, simulation, disabled, drawing, fullscreen, onViewport, onPoint, onReady }: {
  viewport: DepartureMapViewport;
  boundary: readonly CampusAreaPoint[];
  point?: CampusAreaPoint;
  simulation: boolean;
  disabled: boolean;
  drawing: boolean;
  fullscreen: boolean;
  onViewport: (viewport: DepartureMapViewport) => void;
  onPoint: (point: CampusAreaPoint) => void;
  onReady: (ready: boolean) => void;
}) {
  const { colors } = useTheme();
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const [retry, setRetry] = useState(0);
  const [tileStatus, setTileStatus] = useState<Record<string, 'loaded' | 'error'>>({});
  const frame = useMemo(() => departureMapFrame(viewport, width, height, simulation ? '' : TILE_TEMPLATE), [viewport, width, height, simulation]);
  const ready = simulation || frame.tiles.some(tile => tileStatus[tile.key] === 'loaded');
  const { gesture, target, preview } = useCampusAreaMapGestures({viewport, width, height,
    drawing: drawing && ready, disabled, wheelZoom: fullscreen, onViewport, onPoint });
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
  const project = (candidate: CampusAreaPoint) => departurePointOnMap(candidate, frame);
  const asPath = (points: readonly CampusAreaPoint[]) => points.map(candidate => {
    const { x, y } = project(candidate);
    return `${x},${y}`;
  }).join(' ');
  const marker = point && !simulation ? project(point) : undefined;
  const mapLabel = simulation ? 'Campus boundary map. Fictional campus map.' : 'Campus boundary map';
  return <View style={fullscreen ? StyleSheet.absoluteFill : styles.compact}>
    <GestureHandlerRootView style={styles.gesture}>
      <GestureDetector gesture={gesture} touchAction="none" userSelect="none">
        <View ref={target} collapsable={false} accessible accessibilityRole="image" accessibilityLabel={mapLabel}
          onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize(previous => previous.width === width && previous.height === height ? previous : { width, height }); }}
          style={[styles.map, !fullscreen && styles.compactMap, { backgroundColor: colors.row, borderColor: colors.border }]}>
          {width > 0 && height > 0 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: preview.x }, { translateY: preview.y }, { scale: preview.scale }] }]}>
            {frame.tiles.map(tile => <CampusAreaMapTile key={`${retry}:${tile.key}`} tile={tile} onStatus={report} />)}
            <Svg width={width} height={height} style={StyleSheet.absoluteFill} accessible={false}>
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
          {drawing && width > 0 && height > 0 ? <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Svg width={width} height={height} accessible={false}>
              <Circle cx={width / 2} cy={height / 2} r={9} stroke={colors.surface} strokeWidth={3} fill="none" />
              <Circle cx={width / 2} cy={height / 2} r={9} stroke={colors.ink} strokeWidth={1.5} fill="none" />
              <Line x1={width / 2 - 4} x2={width / 2 + 4} y1={height / 2} y2={height / 2} stroke={colors.ink} strokeWidth={1.5} />
              <Line x1={width / 2} x2={width / 2} y1={height / 2 - 4} y2={height / 2 + 4} stroke={colors.ink} strokeWidth={1.5} />
            </Svg>
          </View> : null}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
    {simulation ? <Text style={[styles.attribution, { backgroundColor: colors.surface, color: colors.muted }]}>Fictional campus map</Text> : <Text
      accessibilityRole="link" onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {})}
      style={[styles.attribution, { backgroundColor: colors.surface, color: colors.link }]}>© OpenStreetMap contributors</Text>}
    {!simulation && !ready ? <View pointerEvents={hasError ? "box-none" : "none"} style={styles.message}>
      <Text accessibilityLiveRegion="polite" style={[styles.loading, { backgroundColor: colors.surface, color: colors.ink }]}>
        {hasError ? 'Map imagery is unavailable' : 'Loading map…'}
      </Text>
      {hasError ? <View style={[styles.retry, { backgroundColor: colors.surface }]}><ControlButton title="Retry map tiles" disabled={disabled} onPress={() => { setTileStatus({}); setRetry(value => value + 1); }} /></View> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  compact: { height: 320 },
  gesture: { flex: 1 },
  map: { flex: 1, overflow: 'hidden' },
  compactMap: { borderRadius: themeRadii.radiusControl, borderWidth: StyleSheet.hairlineWidth },
  attribution: { position: 'absolute', bottom: 4, right: 6, borderRadius: 4, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 4, fontSize: 12, lineHeight: 16 },
  message: { position: 'absolute', width: '100%', top: '42%', alignItems: 'center', gap: 4 },
  loading: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, overflow: 'hidden', fontSize: 14, lineHeight: 20 },
  retry: { borderRadius: themeRadii.radiusControl },
});
