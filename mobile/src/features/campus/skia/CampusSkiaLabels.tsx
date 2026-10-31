import { memo, useMemo } from 'react';
import { Circle, Group, Line, Path, RoundedRect, Text, useFont, type SkFont } from 'react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { CampusSceneElement } from '../../../../../packages/contracts/src/campus-scenes/types';
import type { SceneEvidenceMarker } from '../../../../../packages/contracts/src/campus-scenes/sceneEvidence.types';
import { placeSceneMarkers, sceneEvidenceAnchor } from '../../../../../packages/contracts/src/campus-scenes/sceneEvidencePlacement';
import { projectScenePoint, sceneElementHeight, type SceneSize, type SceneViewport, type SceneViewMode } from '../../../../../packages/contracts/src/campus-scenes/sceneGeometry';
import { layoutSceneLabels, type SceneFloatingLabel } from '../../../../../packages/contracts/src/campus-scenes/sceneLabels';
import { layoutSceneInteriorLabels } from '../CampusSceneInteriorLabels';
import type { NativeCampusAssetRenderState } from '../../../lib/campus-asset-render-state';
import { useTheme } from '../../../ui/theme';

export interface CampusSkiaLabelsProps {
  elements: readonly CampusSceneElement[]; mode: SceneViewMode; unit: number; size: SceneSize;
  /** Collision/room-name layout updates at gesture settlement, never on every frame. */
  viewport: SceneViewport; camera: SharedValue<SceneViewport>; selected?: string | null;
  markers?: readonly SceneEvidenceMarker[]; selectedMarkerId?: string | null;
  selectionColor?: string; selectionTextColor?: string;
  interior?: boolean; night?: boolean; assetStates?: readonly NativeCampusAssetRenderState[];
}
const fontSource = require('../../../../assets/fonts/DejaVuSans.ttf');

function worldAnchor(x: number, y: number, viewport: SceneViewport) {
  return { x: (x - viewport.x) / viewport.scale, y: (y - viewport.y) / viewport.scale };
}
function useAnchor(camera: SharedValue<SceneViewport>, point: { x: number; y: number }, offset = { x: 0, y: 0 }) {
  return useDerivedValue(() => [{ translateX: point.x * camera.value.scale + camera.value.x + offset.x },
    { translateY: point.y * camera.value.scale + camera.value.y + offset.y }], [point.x, point.y, offset.x, offset.y, camera]);
}
function centerText(font: SkFont, text: string) { return -font.measureText(text).width / 2; }
function fitText(font: SkFont, text: string, width: number) {
  if (font.measureText(text).width <= width) return text;
  let kept = text;
  while (kept.length > 1 && font.measureText(`${kept}…`).width > width) kept = kept.slice(0, -1);
  return `${kept.trimEnd()}…`;
}

/** Screen-space UI with exact source anchors: text stays readable during GPU camera
 * gestures while settled collision layout remains the same as the owning map helpers. */
export const CampusSkiaLabels = memo(function CampusSkiaLabels({ elements, mode, unit, size, viewport, camera, selected,
  markers = [], selectedMarkerId, selectionColor, selectionTextColor, interior = false, night, assetStates = [] }: CampusSkiaLabelsProps) {
  const { colors, dark } = useTheme(), isNight = night ?? dark;
  const smallFont = useFont(fontSource, 11), labelFont = useFont(fontSource, 11.5), countFont = useFont(fontSource, 12);
  const selectedLabels = useMemo(() => layoutSceneLabels(elements, mode, unit, viewport, size, selected), [elements, mode, unit, viewport, size, selected]);
  const roomLabels = useMemo(() => interior && mode === '2d' ? layoutSceneInteriorLabels({ elements, viewport, size, unit, selectedId: selected }).slice(0, 80) : [],
    [interior, mode, elements, viewport, size, unit, selected]);
  const placements = useMemo(() => placeSceneMarkers(markers.slice(0, 64), elements, mode, unit, viewport, size, selectedMarkerId),
    [markers, elements, mode, unit, viewport, size, selectedMarkerId]);
  const assetDots = useMemo(() => {
    const byId = new Map(elements.map(element => [element.id, element]));
    return assetStates.filter(state => ['reported_fault', 'awaiting_verification'].includes(state.reportState) || ['unavailable', 'retired'].includes(state.availability)).slice(0, 64).flatMap(state => {
      const element = byId.get(state.elementId), anchor = element ? sceneEvidenceAnchor(element) : null;
      if (!element || !anchor) return [];
      return [{ state, anchor: projectScenePoint(anchor, sceneElementHeight(element, unit), mode) }];
    });
  }, [assetStates, elements, unit, mode]);
  if (!smallFont || !labelFont || !countFont || !Number.isFinite(viewport.scale) || viewport.scale <= 0) return null;
  return <>
    {roomLabels.map(label => <RoomLabel key={label.id} label={label} font={smallFont} camera={camera} viewport={viewport} size={size}
      color={isNight ? '#edf0f2' : colors.ink} halo={isNight ? '#202a31' : '#ffffff'} />)}
    {placements.map(placement => <EvidenceMarker key={placement.marker.id} {...{ placement, camera, viewport, size, font: countFont,
      color: placement.marker.tone === 'fault' ? colors.danger : placement.marker.tone === 'attention' ? colors.warning : colors.action,
      surface: colors.surface, selected: selectedMarkerId === placement.marker.id }} />)}
    {assetDots.map(({ state, anchor }) => <AssetDot key={state.elementId} {...{ state, anchor, camera, size,
      color: state.impact === 'not_working' || state.availability === 'unavailable' ? colors.danger : colors.warning,
      surface: colors.surface }} />)}
    {selectedLabels.map(label => <SelectedLabel key={label.id} {...{ label, font: labelFont, camera, viewport, size, color: selectionColor ?? colors.action, textColor: selectionTextColor ?? colors.onAction }} />)}
  </>;
});

function RoomLabel({ label, font, camera, viewport, size, color, halo }: {
  label: ReturnType<typeof layoutSceneInteriorLabels>[number]; font: SkFont; camera: SharedValue<SceneViewport>;
  viewport: SceneViewport; size: SceneSize; color: string; halo: string;
}) {
  const anchor = worldAnchor(label.x, label.y, viewport), transform = useAnchor(camera, anchor);
  const opacity = useDerivedValue(() => {
    const view = camera.value, x = anchor.x * view.scale + view.x, y = anchor.y * view.scale + view.y;
    return view.scale >= viewport.scale * .7 && x > label.width / 2 && x < size.width - label.width / 2
      && y > (size.topInset ?? 0) + label.height / 2 && y < size.height - (size.bottomInset ?? 0) - label.height / 2 ? 1 : 0;
  }, [anchor.x, anchor.y, viewport.scale, size, label.width, label.height]);
  return <Group {...{ transform, opacity }}>{label.lines.map((line, index) => {
    const text = fitText(font, line, label.width), x = centerText(font, text), y = -(label.lines.length - 1) * 13 / 2 + index * 13 + 4;
    return <Group key={index}><Text {...{ text, font, x, y }} color={halo} style="stroke" strokeWidth={2.5} strokeJoin="round" />
      <Text {...{ text, font, x, y }} color={color} /></Group>;
  })}</Group>;
}

function SelectedLabel({ label, font, camera, viewport, size, color, textColor }: {
  label: SceneFloatingLabel; font: SkFont; camera: SharedValue<SceneViewport>; viewport: SceneViewport;
  size: SceneSize; color: string; textColor: string;
}) {
  const anchor = worldAnchor(label.anchorX, label.anchorY, viewport), dx = label.x - label.anchorX, dy = label.y - label.anchorY;
  const position = useDerivedValue(() => {
    const view = camera.value, top = (size.topInset ?? 0) + 8;
    return { x: Math.max(8, Math.min(size.width - label.width - 8, anchor.x * view.scale + view.x + dx)),
      y: Math.max(top, Math.min(Math.max(top, size.height - (size.bottomInset ?? 0) - 90 - label.height), anchor.y * view.scale + view.y + dy)) };
  }, [anchor.x, anchor.y, dx, dy, size, label.width, label.height]);
  const transform = useDerivedValue(() => [{ translateX: position.value.x }, { translateY: position.value.y }]);
  const from = useDerivedValue(() => ({ x: anchor.x * camera.value.scale + camera.value.x, y: anchor.y * camera.value.scale + camera.value.y }));
  const to = useDerivedValue(() => ({ x: Math.max(position.value.x + 10, Math.min(position.value.x + label.width - 10, from.value.x)),
    y: from.value.y >= position.value.y + label.height ? position.value.y + label.height : position.value.y }));
  const opacity = useDerivedValue(() => from.value.x >= -20 && from.value.x <= size.width + 20 && from.value.y >= -40 && from.value.y <= size.height + 20 ? 1 : 0);
  return <Group opacity={opacity}><Line p1={from} p2={to} color={color} strokeWidth={1.2} opacity={.62} />
    <Group transform={transform}><RoundedRect x={0} y={0} width={label.width} height={label.height} r={8} color={color} />
      {label.lines.map((line, index) => {
        const text = fitText(font, line, label.width - 22);
        return <Text key={index} text={text} font={font} x={label.width / 2 + centerText(font, text)} y={17 + index * 15} color={textColor} />;
      })}</Group>
  </Group>;
}

function EvidenceMarker({ placement, camera, viewport, size, font, color, surface, selected }: {
  placement: ReturnType<typeof placeSceneMarkers>[number]; camera: SharedValue<SceneViewport>; viewport: SceneViewport;
  size: SceneSize; font: SkFont; color: string; surface: string; selected: boolean;
}) {
  const { marker, width } = placement, anchor = worldAnchor(placement.anchor.x, placement.anchor.y, viewport);
  const dx = placement.x - placement.anchor.x, dy = placement.y - placement.anchor.y;
  const position = useDerivedValue(() => ({ x: Math.max(width / 2 + 4, Math.min(size.width - width / 2 - 4, anchor.x * camera.value.scale + camera.value.x + dx)),
    y: Math.max((size.topInset ?? 0) + 24, Math.min(size.height - 100, anchor.y * camera.value.scale + camera.value.y + dy)) }));
  const transform = useDerivedValue(() => [{ translateX: position.value.x }, { translateY: position.value.y }]);
  const from = useDerivedValue(() => ({ x: anchor.x * camera.value.scale + camera.value.x, y: anchor.y * camera.value.scale + camera.value.y }));
  const to = useDerivedValue(() => ({ x: position.value.x, y: position.value.y + 12 }));
  const opacity = useDerivedValue(() => from.value.x >= 0 && from.value.x <= size.width && from.value.y >= 0 && from.value.y <= size.height ? 1 : 0);
  const count = marker.count > 99 ? '99+' : String(marker.count), countX = marker.plannedCapacityPressure ? -5 : 7;
  return <Group opacity={opacity}><Line p1={from} p2={to} color={color} strokeWidth={1.2} opacity={.65} /><Group transform={transform}>
    <RoundedRect x={-width / 2} y={-15} width={width} height={30} r={15} color={surface} />
    <RoundedRect x={-width / 2} y={-15} width={width} height={30} r={15} color={color} style="stroke" strokeWidth={selected ? 2.5 : 1.5} />
    <Group transform={[{ translateX: -width / 2 + 15 }]}><EvidenceSymbol marker={marker} color={color} /></Group>
    <Text text={count} font={font} x={countX + centerText(font, count)} y={4} color={color} />
    {marker.plannedCapacityPressure ? <Text text="!" font={font} x={width / 2 - 16} y={4} color={color} /> : null}
  </Group></Group>;
}

function EvidenceSymbol({ marker, color }: { marker: SceneEvidenceMarker; color: string }) {
  const props = { color, style: 'stroke' as const, strokeWidth: 1.6, strokeCap: 'round' as const, strokeJoin: 'round' as const };
  if (marker.tone) return <Group><Path path="M 0 -6 L 7 6 H -7 Z" {...props} /><Path path="M 0 -2 V 1 M 0 3.5 v .1" {...props} /></Group>;
  if (marker.dimension === 'expected') return <Group><Circle r={6} {...props} /><Path path="M 0 -3.5 V 0 L 2.5 1.5" {...props} /></Group>;
  if (marker.dimension === 'observed') return <Group><Path path="M -7 0 Q 0 -9 7 0 Q 0 9 -7 0 Z" {...props} /><Circle r={2} {...props} /></Group>;
  if (marker.dimension === 'accepted') return <Group><RoundedRect x={-6} y={-6} width={12} height={12} r={2} {...props} /><Path path="m -3 0 2 2 4 -4" {...props} /></Group>;
  return <Group><Circle r={6} {...props} /><Path path="M -2 -2 C -2 -5 3 -5 3 -2 Q 3 -1 0 0 V 1 M 0 3.5 v .1" {...props} /></Group>;
}

function AssetDot({ state, anchor, camera, size, color, surface }: {
  state: NativeCampusAssetRenderState; anchor: { x: number; y: number }; camera: SharedValue<SceneViewport>;
  size: SceneSize; color: string; surface: string;
}) {
  const transform = useAnchor(camera, anchor, { x: 0, y: -7 });
  const opacity = useDerivedValue(() => {
    const x = anchor.x * camera.value.scale + camera.value.x, y = anchor.y * camera.value.scale + camera.value.y;
    return x > 8 && x < size.width - 8 && y > (size.topInset ?? 0) + 8 && y < size.height - (size.bottomInset ?? 0) - 8 ? 1 : 0;
  });
  return <Group {...{ transform, opacity }}><Circle r={6} color={surface} />
    {state.reportState === 'awaiting_verification' ? <Circle r={3.7} color={color} style="stroke" strokeWidth={2} />
      : <Path path="M 0 -4.7 L 4.7 0 L 0 4.7 L -4.7 0 Z" color={color} />}
  </Group>;
}
