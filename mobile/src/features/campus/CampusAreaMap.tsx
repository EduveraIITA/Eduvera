import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useIsFocused } from 'expo-router';
import { CrosshairIcon } from 'phosphor-react-native/src/icons/Crosshair';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { MinusIcon } from 'phosphor-react-native/src/icons/Minus';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { Button, Notice } from '../../ui/components';
import { ControlButton, Disclosure } from '../../ui/DomainControls';
import { useTheme } from '../../ui/theme';
import { themeRadii } from '../../ui/theme-tokens';
import { fitDepartureMap } from '../DepartureMapPolicy';
import { CampusAreaMapFind, type CampusAreaSearchResult } from './CampusAreaMapFind';
import {
  CAMPUS_AREA_MAX_POINTS, CAMPUS_AREA_MAX_VIEW_ZOOM, CAMPUS_AREA_MIN_VIEW_ZOOM,
  CAMPUS_AREA_MIN_ZOOM, CAMPUS_AREA_SIMULATION_CENTER, CAMPUS_AREA_WORLD_VIEW,
  campusAreaBoundaryIssue, campusAreaPointAt, campusAreaView, campusAreaZoom, panCampusArea, type CampusAreaPoint,
} from './CampusAreaMapPolicy';
import { CampusAreaMapSurface } from './CampusAreaMapSurface';

export type { CampusAreaPoint } from './CampusAreaMapPolicy';

type CampusAreaMapProps = {
  onAreaSelected: (boundary: CampusAreaPoint[]) => void;
  busy?: boolean;
  disabled?: boolean;
  initialCenter?: CampusAreaPoint;
  initialBoundary?: readonly CampusAreaPoint[];
  simulation?: boolean;
  fullscreen?: boolean;
  onSearch?: (query: string) => Promise<readonly CampusAreaSearchResult[]>;
};

async function getDevicePosition(): Promise<CampusAreaPoint> {
  if (Platform.OS === 'web') {
    if (!globalThis.navigator?.geolocation) throw new Error('Location is unavailable.');
    return new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(position => resolve(position.coords), reject, {
        enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000,
      })
    );
  }
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location access was denied.');
  return (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: false })).coords;
}

export function CampusAreaMap({ onAreaSelected, busy = false, disabled = false, initialCenter, initialBoundary = [], simulation = false, fullscreen = false, onSearch }: CampusAreaMapProps) {
  const { colors } = useTheme();
  const locked = busy || disabled;
  const focused = useIsFocused();
  const [viewport, setViewport] = useState(() => fitDepartureMap(initialBoundary, 320, 320) ?? (simulation
    ? campusAreaView(CAMPUS_AREA_SIMULATION_CENTER) : initialCenter ? campusAreaView(initialCenter) : CAMPUS_AREA_WORLD_VIEW));
  const [boundary, setBoundary] = useState<CampusAreaPoint[]>(() => [...initialBoundary]);
  const [drawing, setDrawing] = useState(initialBoundary.length > 0);
  const [marker, setMarker] = useState<CampusAreaPoint>();
  const [mapReady, setMapReady] = useState(simulation);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [mapHeight, setMapHeight] = useState(0);
  const [trayHeight, setTrayHeight] = useState(0);
  const request = useRef(0);
  const locatingNow = useRef(false);
  useEffect(() => {
    if (!focused) { request.current++; setMapReady(simulation); }
  }, [focused, simulation]);
  const canDraw = focused && mapReady && viewport.zoom >= CAMPUS_AREA_MIN_ZOOM;
  const boundaryIssue = campusAreaBoundaryIssue(boundary);
  function center(point: CampusAreaPoint) {
    request.current++;
    setViewport(campusAreaView(point));
  }
  async function findDevice() {
    if (!focused || simulation || locked || locatingNow.current) return;
    if (marker) { center(marker); return; }
    locatingNow.current = true;
    const ticket = ++request.current;
    setLocating(true);
    setNotice('');
    try {
      const point = await getDevicePosition();
      if (request.current === ticket) {
        setMarker(point);
        center(point);
      }
    } catch {
      if (request.current === ticket) setNotice('Device location is unavailable. Find the campus by name or coordinates.');
    } finally {
      locatingNow.current = false;
      setLocating(false);
    }
  }
  function addPoint(point: CampusAreaPoint) {
    if (!drawing || !canDraw || locked) return;
    setBoundary(previous => {
      if (previous.length >= CAMPUS_AREA_MAX_POINTS ||
        previous.some(item => item.latitude === point.latitude && item.longitude === point.longitude)) return previous;
      return [...previous, point];
    });
  }
  const zoom = (step: number) => setViewport(previous => campusAreaZoom(previous, step, 0, 0));
  const nudge = (dx: number, dy: number) => setViewport(previous => panCampusArea(previous, dx, dy));
  const controlsTop = mapHeight > 0 ? Math.max(68, Math.min(Math.round(mapHeight * .40), mapHeight - trayHeight - 136)) : 112;
  const context = !drawing
    ? 'Find your campus, then draw its boundary.'
    : !canDraw
      ? 'Zoom in to start placing points around the campus.'
      : !boundary.length
        ? 'Tap each corner of the campus. Drag to move the map.'
        : boundaryIssue || 'Outline ready. You can add more points before generating.';

  const search = !simulation ? <View pointerEvents="box-none" style={[styles.search, fullscreen && styles.searchOverlay]}>
    <View style={styles.searchRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={findOpen ? 'Close campus search' : 'Find campus'}
        accessibilityState={{ expanded: findOpen, disabled: locked }} disabled={locked}
        onPress={() => setFindOpen(value => !value)} style={({ pressed }) => [styles.searchTrigger, styles.raised, {
          borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? .72 : 1,
        }]}>
        {findOpen ? <XIcon size={20} color={colors.muted} /> : <MagnifyingGlassIcon size={20} color={colors.muted} />}
        <Text numberOfLines={1} style={[styles.searchText, { color: colors.ink }]}>Find campus</Text>
      </Pressable>
      <CampusMapIconButton label={marker ? 'Recenter on your location' : 'Use my location'} icon={CrosshairIcon}
        disabled={locked || locating} loading={locating} onPress={() => void findDevice()} />
    </View>
    {findOpen ? <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      style={[styles.findPanel, styles.raised, { maxHeight: mapHeight > 0 ? Math.min(mapHeight * .47, 320) : 280, borderColor: colors.border, backgroundColor: colors.surface }]}
      contentContainerStyle={styles.findContent}>
      <CampusAreaMapFind onSearch={onSearch} disabled={locked} onSelect={point => {
        center(point);
        setFindOpen(false);
        setNotice('');
      }} />
    </ScrollView> : null}
    {notice ? <Notice tone="warning" message={notice} /> : null}
  </View> : null;

  const tools = !findOpen ? <View pointerEvents="box-none" style={[styles.mapTools, fullscreen && [styles.toolsOverlay, { top: controlsTop }]]}>
    {simulation ? <CampusMapIconButton label="Recenter map" icon={CrosshairIcon} onPress={() => center(CAMPUS_AREA_SIMULATION_CENTER)} disabled={locked} /> : null}
    <CampusMapIconButton label="Zoom in" icon={PlusIcon} onPress={() => zoom(1)} disabled={locked || viewport.zoom >= CAMPUS_AREA_MAX_VIEW_ZOOM} />
    <CampusMapIconButton label="Zoom out" icon={MinusIcon} onPress={() => zoom(-1)} disabled={locked || viewport.zoom <= CAMPUS_AREA_MIN_VIEW_ZOOM} />
  </View> : null;
  const tray = <View pointerEvents="box-none" style={fullscreen ? styles.trayOverlay : undefined}>
    <View style={[styles.tray, fullscreen && styles.raised, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onLayout={event => setTrayHeight(event.nativeEvent.layout.height)}>
      {!drawing ? <Text accessibilityRole="header" aria-level={2} style={[styles.heading, { color: colors.ink }]}>Create your virtual campus</Text> : null}
      <Text accessibilityLiveRegion="polite" style={[styles.copy, { color: colors.muted }]}>
        {drawing && boundary.length > 0 ? `${boundary.length} ${boundary.length === 1 ? 'point' : 'points'} · ` : ''}{context}
      </Text>
      {drawing ? <>
        <View style={styles.editActions}>
          {boundary.length ? <ControlButton title="Undo point" disabled={locked}
            onPress={() => setBoundary(previous => previous.slice(0, -1))} /> : null}
          {boundary.length > 1 ? <ControlButton title="Clear outline" disabled={locked} onPress={() => setBoundary([])} /> : null}
          {!boundary.length ? <ControlButton title="Stop drawing" disabled={locked} onPress={() => setDrawing(false)} /> : null}
        </View>
        <Button title={busy ? 'Preparing your layout…' : 'Generate campus layout'} disabled={locked || !!boundaryIssue} busy={busy}
          onPress={() => { if (!boundaryIssue && !locked) onAreaSelected(boundary); }} />
      </> : <Button title="Draw boundary" disabled={locked || !canDraw} onPress={() => setDrawing(true)} />}
      <Disclosure title="Map controls">
        <View style={styles.editActions}>
          <ControlButton title="Move north" disabled={locked} onPress={() => nudge(0, -40)} />
          <ControlButton title="Move south" disabled={locked} onPress={() => nudge(0, 40)} />
          <ControlButton title="Move west" disabled={locked} onPress={() => nudge(-40, 0)} />
          <ControlButton title="Move east" disabled={locked} onPress={() => nudge(40, 0)} />
          {drawing ? <ControlButton title="Add point at map center" disabled={locked || !canDraw || boundary.length >= CAMPUS_AREA_MAX_POINTS}
            onPress={() => addPoint(campusAreaPointAt(viewport, 0, 0, 0, 0))} /> : null}
        </View>
      </Disclosure>
    </View>
  </View>;
  return <View style={fullscreen ? styles.fullscreen : styles.compact} onLayout={event => setMapHeight(event.nativeEvent.layout.height)}>
    {!fullscreen ? search : null}
    {focused ? <CampusAreaMapSurface viewport={viewport} boundary={boundary} point={marker} simulation={simulation}
      disabled={locked} drawing={drawing && canDraw && !findOpen} fullscreen={fullscreen}
      onViewport={setViewport} onPoint={addPoint} onReady={setMapReady} /> : null}
    {fullscreen ? search : null}
    {tools}
    {findOpen && fullscreen ? null : tray}
  </View>;
}

function CampusMapIconButton({ label, icon: Icon, onPress, disabled, loading }: {
  label: string;
  icon: typeof PlusIcon;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy: loading }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconButton, styles.raised, {
      borderColor: colors.border, backgroundColor: colors.surface, opacity: disabled && !loading ? .55 : pressed ? .72 : 1,
    }]}>
    {loading ? <ActivityIndicator size="small" color={colors.action} /> : <Icon color={colors.ink} size={23} />}
  </Pressable>;
}

const styles = StyleSheet.create({
  fullscreen: { flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' },
  compact: { gap: 8 },
  search: { width: '100%', gap: 8 },
  searchOverlay: { position: 'absolute', top: 12, left: 12, right: 12, width: 'auto', alignSelf: 'center', maxWidth: 520, marginHorizontal: 'auto' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchTrigger: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 24 },
  searchText: { fontSize: 16, lineHeight: 22, flexShrink: 1, fontWeight: '600' },
  findPanel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: themeRadii.radiusControl, flexGrow: 0 },
  findContent: { paddingHorizontal: 12, paddingVertical: 8 },
  iconButton: { width: 48, height: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: themeRadii.radiusControl, justifyContent: 'center', alignItems: 'center' },
  mapTools: { gap: 6, flexDirection: 'row' },
  toolsOverlay: { position: 'absolute', right: 12, flexDirection: 'column' },
  trayOverlay: { position: 'absolute', bottom: 31, left: 12, right: 12, maxWidth: 520, marginHorizontal: 'auto' },
  tray: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 3, borderWidth: StyleSheet.hairlineWidth, borderRadius: themeRadii.radiusCard },
  raised: { shadowColor: '#12191d', shadowOpacity: .14, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  heading: { fontSize: 20, lineHeight: 27, fontWeight: '600' },
  copy: { fontSize: 14, lineHeight: 20 },
  editActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
});
