import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useIsFocused } from 'expo-router';
import { Button, Notice } from '../../ui/components';
import { ControlButton, Disclosure } from '../../ui/DomainControls';
import { useTheme } from '../../ui/theme';
import { CampusAreaMapFind, type CampusAreaSearchResult } from './CampusAreaMapFind';
import {
  CAMPUS_AREA_MAX_POINTS, CAMPUS_AREA_MIN_ZOOM, CAMPUS_AREA_SIMULATION_CENTER, CAMPUS_AREA_WORLD_VIEW,
  campusAreaBoundaryIssue, campusAreaPointAt, campusAreaView, panCampusArea, type CampusAreaPoint,
} from './CampusAreaMapPolicy';
import { CampusAreaMapSurface } from './CampusAreaMapSurface';
import { fitDepartureMap } from '../DepartureMapPolicy';

export type { CampusAreaPoint } from './CampusAreaMapPolicy';

type CampusAreaMapProps = {
  onAreaSelected: (boundary: CampusAreaPoint[]) => void;
  busy?: boolean;
  initialCenter?: CampusAreaPoint;
  initialBoundary?: readonly CampusAreaPoint[];
  simulation?: boolean;
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

export function CampusAreaMap({ onAreaSelected, busy = false, initialCenter, initialBoundary = [], simulation = false, onSearch }: CampusAreaMapProps) {
  const { colors } = useTheme();
  const focused = useIsFocused();
  const [viewport, setViewport] = useState(() => fitDepartureMap(initialBoundary, 320, 320) ?? (simulation
    ? campusAreaView(CAMPUS_AREA_SIMULATION_CENTER) : initialCenter ? campusAreaView(initialCenter) : CAMPUS_AREA_WORLD_VIEW));
  const [boundary, setBoundary] = useState<CampusAreaPoint[]>(() => [...initialBoundary]);
  const [marker, setMarker] = useState<CampusAreaPoint>();
  const [mapReady, setMapReady] = useState(simulation);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState('');
  const [findOpen, setFindOpen] = useState(false);
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
    if (!focused || simulation || busy || locatingNow.current) return;
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
      if (request.current === ticket) setNotice('Device location is unavailable. Search by campus name or enter coordinates.');
    } finally {
      locatingNow.current = false;
      setLocating(false);
    }
  }
  function addPoint(point: CampusAreaPoint) {
    if (!canDraw || busy) return;
    setBoundary(previous => {
      if (previous.length >= CAMPUS_AREA_MAX_POINTS ||
        previous.some(item => item.latitude === point.latitude && item.longitude === point.longitude)) return previous;
      return [...previous, point];
    });
  }
  const zoom = (step: number) => setViewport(previous => ({ ...previous, zoom: Math.max(1, Math.min(19, previous.zoom + step)) }));
  const nudge = (dx: number, dy: number) => setViewport(previous => panCampusArea(previous, dx, dy));

  return <View style={styles.region}>
    {!simulation ? <>
      <View style={styles.controls}>
        <ControlButton title="Use my location" disabled={busy} busy={locating} onPress={() => void findDevice()} />
        <ControlButton title={findOpen ? 'Hide campus search' : 'Find campus'} disabled={busy} onPress={() => setFindOpen(previous => !previous)} />
      </View>
      {locating ? <Text accessibilityLiveRegion="polite" style={[styles.copy, { color: colors.muted }]}>Finding your device location…</Text> : null}
      {notice ? <Notice tone="warning" message={notice} /> : null}
      {findOpen ? <CampusAreaMapFind onSearch={onSearch} disabled={busy} onSelect={point => {
        center(point);
        setFindOpen(false);
        setNotice('');
      }} /> : null}
    </> : null}
    <Text style={[styles.copy, { color: colors.muted }]}>
      {viewport.zoom < CAMPUS_AREA_MIN_ZOOM
        ? 'Find your campus or zoom in to draw its boundary.'
        : 'Tap around the campus to draw its boundary. Drag the map to look around.'}
    </Text>
    {focused ? <CampusAreaMapSurface viewport={viewport} boundary={boundary} point={marker} simulation={simulation}
      disabled={busy} drawing={canDraw} onViewport={setViewport} onPoint={addPoint} onReady={setMapReady} /> : null}
    <View style={styles.controls}>
      <ControlButton title="Zoom in" disabled={busy || viewport.zoom >= 19} onPress={() => zoom(1)} />
      <ControlButton title="Zoom out" disabled={busy || viewport.zoom <= 1} onPress={() => zoom(-1)} />
      {simulation ? <ControlButton title="Recenter map" disabled={busy} onPress={() => center(CAMPUS_AREA_SIMULATION_CENTER)} /> : null}
      {boundary.length ? <ControlButton title="Undo point" disabled={busy} onPress={() => setBoundary(previous => previous.slice(0, -1))} /> : null}
      {boundary.length > 1 ? <ControlButton title="Clear outline" disabled={busy} onPress={() => setBoundary([])} /> : null}
    </View>
    <Disclosure title="Move map and add points with buttons">
      <View style={styles.controls}>
        <ControlButton title="Move north" disabled={busy} onPress={() => nudge(0, -40)} />
        <ControlButton title="Move south" disabled={busy} onPress={() => nudge(0, 40)} />
        <ControlButton title="Move west" disabled={busy} onPress={() => nudge(-40, 0)} />
        <ControlButton title="Move east" disabled={busy} onPress={() => nudge(40, 0)} />
        <ControlButton title="Add point at map center" disabled={busy || !canDraw || boundary.length >= CAMPUS_AREA_MAX_POINTS}
          onPress={() => addPoint(campusAreaPointAt(viewport, 0, 0, 0, 0))} />
      </View>
    </Disclosure>
    {boundary.length ? <Text accessibilityLiveRegion="polite" style={[styles.copy, { color: colors.ink }]}>
      {boundary.length === 1 ? '1 point added' : `${boundary.length} points added`}
      {boundaryIssue ? ` · ${boundaryIssue}` : ''}
    </Text> : null}
    {boundary.length === CAMPUS_AREA_MAX_POINTS ? <Notice message="The outline has reached 48 points. Use it as drawn or undo a point." /> : null}
    <Button title={busy ? 'Preparing your layout…' : 'Generate campus layout'} disabled={!!boundaryIssue} busy={busy}
      onPress={() => { if (!boundaryIssue && !busy) onAreaSelected(boundary); }} />
  </View>;
}

const styles = StyleSheet.create({
  region: { gap: 8 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  copy: { fontSize: 14, lineHeight: 21 },
});
