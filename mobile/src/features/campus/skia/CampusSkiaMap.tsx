import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Canvas, Circle, Fill, Group, Image, Path, Picture, Skia, useImage } from 'react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { CampusMapCanvasProps } from '../CampusMapCanvas.types';
import type { CampusSceneElement } from '../../../../../packages/contracts/src/campus-scenes/types';
import { projectScenePoint, sceneElementHeight, sceneElementWidth, scenePaintOrder, scenePointBounds, sceneUnitScale, unprojectScenePoint, type SceneViewport } from '../../../../../packages/contracts/src/campus-scenes/sceneGeometry';
import { placeSceneMarkers } from '../../../../../packages/contracts/src/campus-scenes/sceneEvidencePlacement';
import { isSceneIndoorAssetKey, sceneIndoorFootprint } from '../../../../../packages/contracts/src/campus-scenes/sceneIndoorAssets';
import { DEFAULT_SCENE_SUNLIGHT } from '../../../../../packages/contracts/src/campus-scenes/sceneSunlight';
import { nativeEditorVisibleElements } from '../../../lib/campus-scene-editor-view';
import { nativeCampusFramingBounds } from '../../../lib/campus-camera';
import { useTheme } from '../../../ui/theme';
import { compileCampusSceneDrawing, pickCampusDrawing } from './compileCampusSceneDrawing';
import { createCampusSceneRetainedPictures } from './createCampusScenePicture';
import { useCampusSkiaCamera } from './useCampusSkiaCamera';
import { CampusSkiaPeople } from './CampusSkiaPeople';
import { CampusSkiaLabels } from './CampusSkiaLabels';

/** A native display list, UI-runtime camera and independent DT overlays. Scene
 * geometry is recorded only when its source/lighting/resource condition changes. */
export default function CampusSkiaMap(props: CampusMapCanvasProps) {
  const { scene, contextKey = '', draftPreview = false, floor, mode, selected, camera, onCameraChange,
    onSelect, onPoint, route, people, sourceImageUrl, sourceImageBounds, drawingPoints,
    bottomOverlap = 0, markers = [], selectedMarkerId, onSelectMarker, assetStates = [] } = props;
  const { colors, dark } = useTheme();
  const editorInterior = draftPreview ? props.editorInterior : undefined;
  const interior = !!floor || !!editorInterior;
  const lighting = props.lighting ?? (dark ? 'night' : 'day'), night = lighting === 'night';
  const sunlight = props.sunlight ?? DEFAULT_SCENE_SUNLIGHT;
  const effectiveSunlight = useMemo(() => night ? { ...sunlight, strength: 0 } : sunlight, [sunlight, night]);
  const activeOutline = props.outline ?? (editorInterior ? scene.elements.find(element => element.id === editorInterior.buildingElementId && element.kind === 'building')?.geometry.points : undefined);
  const activeBounds = props.viewBounds ?? (editorInterior && activeOutline?.length ? scenePointBounds(activeOutline.map(point => projectScenePoint(point, 0, mode))) : undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const elements = useMemo(() => {
    const ordered = scenePaintOrder(nativeEditorVisibleElements(scene, floor, editorInterior?.elementIds)
      .filter(element => draftPreview || element.review_state === 'reviewed'));
    return mode === '2d' ? [...ordered.filter(element => element.kind === 'room'), ...ordered.filter(element => element.kind !== 'room')] : ordered;
  }, [scene, floor, mode, draftPreview, editorInterior]);
  const unit = useMemo(() => sceneUnitScale(scene), [scene]);
  const bounds = useMemo(() => nativeCampusFramingBounds(scene, elements, mode, { publishedInterior: !draftPreview && !!floor, outline: activeOutline, viewBounds: activeBounds }),
    [scene, elements, mode, draftPreview, floor, activeOutline, activeBounds?.x, activeBounds?.y, activeBounds?.width, activeBounds?.height]);
  const viewportSize = useMemo(() => ({ width: Math.max(1, size.width), height: Math.max(1, size.height), topInset: props.viewportInsets?.top ?? (interior ? 120 : 72), bottomInset: (props.viewportInsets?.bottom ?? 76) + bottomOverlap }), [size.width, size.height, interior, bottomOverlap, props.viewportInsets?.top, props.viewportInsets?.bottom]);
  const unavailableKey = JSON.stringify([...new Set([...props.unavailable, ...assetStates.filter(state => state.suppressNightGlow).map(state => state.elementId)])].sort());
  const unavailable = useMemo(() => new Set<string>(JSON.parse(unavailableKey)), [unavailableKey]);
  const drawing = useMemo(() => compileCampusSceneDrawing(scene, { elements, floorId: floor, mode, lighting, sunlight: effectiveSunlight,
    interiorOutline: activeOutline ?? undefined, includeSurroundings: !interior,
    detail: 'full', interiorGroundColor: night ? '#202a31' : colors.row }),
  [scene, elements, floor, mode, lighting, effectiveSunlight, activeOutline, interior, colors.row, night]);
  const mutableElements = useMemo(() => new Map(elements.filter(element => element.kind === 'fixture' && element.holding_id).map(element => [element.id, element])), [elements]);
  const retained = useMemo(() => createCampusSceneRetainedPictures(drawing, { mutableElementIds: new Set(mutableElements.keys()) }), [drawing, mutableElements]);
  const layers = useMemo(() => retained.resolve(unavailable, (id, isUnavailable) => compileCampusSceneDrawing(scene, {
    elements: [mutableElements.get(id)!], floorId: floor, mode, lighting, sunlight: effectiveSunlight,
    unavailableIds: isUnavailable ? [id] : [], includeBase: false, includeSurroundings: false, detail: 'full',
  })), [retained, unavailable, scene, mutableElements, floor, mode, lighting, effectiveSunlight]);
  const focusBounds = props.focus && 'bounds' in props.focus ? props.focus.bounds : props.focus;
  const focusKey = props.focus && 'key' in props.focus ? props.focus.key : null;
  const frameKey = JSON.stringify([contextKey, floor, mode, editorInterior?.buildingElementId, editorInterior?.floorId, focusKey, bounds, focusBounds]);
  const controller = useCampusSkiaCamera({ key: frameKey, size: viewportSize, bounds, camera, focus: focusBounds, overview: !interior,
    onChange: onCameraChange, onTap: (x, y, viewport) => {
      if (onPoint) { onPoint(unprojectScenePoint({ x: (x - viewport.x) / viewport.scale, y: (y - viewport.y) / viewport.scale }, mode)); return; }
      if (!draftPreview && onSelectMarker) {
        const hit = placeSceneMarkers(markers.slice(0, 64), elements, mode, unit, viewport, viewportSize, selectedMarkerId)
          .reverse().find(item => Math.abs(x - item.x) <= item.width / 2 && Math.abs(y - item.y) <= 22);
        if (hit) { onSelectMarker(hit.marker.id); return; }
      }
      const id = pickCampusDrawing(drawing, { x: (x - viewport.x) / viewport.scale, y: (y - viewport.y) / viewport.scale }, { tolerance: 7 / viewport.scale, draftPreview });
      if (id) onSelect(id);
    } });
  const highlights = useMemo(() => elements.flatMap(element => {
    const highlight = props.placeHighlights?.find(row => row.elementId === element.id);
    return highlight ? [{ element, tone: highlight.tone }] : [];
  }), [elements, props.placeHighlights]);
  const selectionTone = props.placeHighlights?.find(row => row.elementId === selected)?.tone;
  const selectionColor = selectionTone ? colors[selectionTone] : colors.action;
  const selectedElement = useMemo(() => elements.find(element => element.id === selected), [elements, selected]);
  const routePaths = useMemo(() => route?.status === 'available' ? route.segments.filter(segment => segment.floorId === floor)
    .map(segment => Skia.Path.Polygon(segment.points.map(point => projectScenePoint(point, unit * .15, mode)), false)) : [], [route, floor, unit, mode]);
  const points = useMemo(() => drawingPoints?.map(point => projectScenePoint(point, 0, mode)) ?? [], [drawingPoints, mode]);
  const drawingPath = useMemo(() => points.length ? Skia.Path.Polygon(points, false) : null, [points]);
  const pointRadius = useDerivedValue(() => 5 / controller.viewport.value.scale);
  const lineWidth = useDerivedValue(() => 2 / controller.viewport.value.scale);
  return <GestureHandlerRootView style={{ flex: 1, minWidth: 0, minHeight: 0, alignSelf: 'stretch' }}>
    <GestureDetector gesture={controller.gesture} touchAction="none" userSelect="none">
      <View collapsable={false} onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize(previous => previous.width === width && previous.height === height ? previous : { width, height }); }}
        style={{ flex: 1, overflow: 'hidden', backgroundColor: drawing.groundColor }} accessible={false}>
        {size.width > 0 && size.height > 0 ? <Canvas style={{ flex: 1 }} opaque colorSpace="srgb" android={{ surfaceType: draftPreview ? 'TextureView' : 'SurfaceView' }} accessible accessibilityRole="image"
          accessibilityLabel={`${draftPreview ? 'Editable' : 'Published'} campus ${interior ? 'floor plan' : 'map'}. Use Find a place or the building details to explore places and resources.`}>
          <Fill color={drawing.groundColor} />
          <Group transform={controller.transform}>
            {layers.filter(layer => layer.base).map(layer => <Picture key={layer.key} picture={layer.picture} />)}
            {sourceImageUrl ? <SourcePlan uri={sourceImageUrl} bounds={sourceImageBounds ?? { x: 0, y: 0, width: scene.bounds.width, height: scene.bounds.height }} /> : null}
            {layers.filter(layer => !layer.base).map(layer => <Picture key={layer.key} picture={layer.picture} />)}
            {routePaths.map((path, index) => <Path key={index} path={path} color={colors.action} style="stroke" strokeWidth={unit * 1.5} strokeCap="round" strokeJoin="round" />)}
            {highlights.map(({element,tone}) => <SelectedOutline key={`place-status:${element.id}`} element={element} {...{mode,unit}} camera={controller.viewport} color={colors[tone]} fill />)}
            {selectedElement ? <SelectedOutline element={selectedElement} {...{ mode, unit }} camera={controller.viewport} color={selectionColor} /> : null}
            {drawingPath ? <Path path={drawingPath} color={colors.action} style="stroke" strokeWidth={lineWidth} /> : null}
            {points.map((point, index) => <Circle key={index} cx={point.x} cy={point.y} r={pointRadius} color={colors.action} />)}
          </Group>
          {!draftPreview && people ? <CampusSkiaPeople {...people} {...{ scene, mode, unit, night }} camera={controller.viewport} viewport={size} /> : null}
          <CampusSkiaLabels {...{ elements, mode, unit, selected, markers, selectedMarkerId, interior, assetStates, night }} selectionColor={selectionColor} selectionTextColor={selectionTone ? colors.canvas : colors.onAction} size={viewportSize} viewport={controller.settledViewport} camera={controller.viewport} />
        </Canvas> : null}
      </View>
    </GestureDetector>
  </GestureHandlerRootView>;
}

const SourcePlan = memo(function SourcePlan({ uri, bounds }: { uri: string; bounds: { x: number; y: number; width: number; height: number; rotationDeg?: number } }) {
  const image = useImage(uri);
  const origin = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  return <Group origin={origin} transform={[{ rotate: (bounds.rotationDeg ?? 0) * Math.PI / 180 }]} opacity={.6}>
    <Image image={image} {...bounds} fit="fill" />
  </Group>;
});

function SelectedOutline({ element, mode, unit, camera, color, fill = false }: { element: CampusSceneElement; mode: CampusMapCanvasProps['mode']; unit: number; camera: SharedValue<SceneViewport>; color: string; fill?: boolean }) {
  const path = useMemo(() => {
    if (element.kind === 'fixture' && isSceneIndoorAssetKey(element.asset_key)) return Skia.Path.Polygon(sceneIndoorFootprint(element, unit).map(point => projectScenePoint(point, 0, mode)), true);
    if (element.geometry.type !== 'point') return Skia.Path.Polygon(element.geometry.points.map(point => projectScenePoint(point, element.geometry.type === 'polygon' ? sceneElementHeight(element, unit) : 0, mode)), element.geometry.type === 'polygon');
    const center = projectScenePoint(element.geometry.points[0]!, mode === '2.5d' ? sceneElementHeight(element, unit) * .7 : 0, mode), width = sceneElementWidth(element, unit);
    return Skia.Path.Oval(Skia.XYWHRect(center.x - width * .65, center.y - width * .55, width * 1.3, width * 1.1));
  }, [element, mode, unit]);
  const baseWidth = element.geometry.type === 'polyline' ? sceneElementWidth(element, unit) : 0;
  const width = useDerivedValue(() => baseWidth + 2.5 / camera.value.scale);
  return <>
    {fill && element.geometry.type === 'polygon' ? <Path path={path} color={color} opacity={.24} /> : null}
    <Path path={path} color={color} style="stroke" strokeWidth={width} strokeJoin="round" strokeCap="round" opacity={element.geometry.type === 'polyline' ? .65 : 1} />
  </>;
}
