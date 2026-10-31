import { memo, useEffect, useMemo } from 'react';
import { Atlas, Group, ImageSVG, PathOp, Skia, useColorBuffer, useTexture, useRSXformBuffer, useRectBuffer, type SkImage, type SkPath } from 'react-native-skia';
import { useAnimatedReaction, useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { CampusSceneDocument } from '../../../../../packages/contracts/src/campus-scenes/types';
import type { ScenePeopleClock, ScenePeopleCompiled } from '../../../../../packages/contracts/src/campus-scenes/scenePeopleTracks.types';
import { scenePeopleOccluders } from '../../../../../packages/contracts/src/campus-scenes/scenePeopleOcclusionGeometry';
import type { SceneViewMode } from '../../../../../packages/contracts/src/campus-scenes/sceneGeometry';
import type { CampusPeopleVisibility } from '../../../lib/campus-people';
import { useTheme } from '../../../ui/theme';
import { campusSkiaPeopleAnimateAt, compileCampusSkiaPeoplePacket, sampleCampusSkiaPeoplePacket, type CampusSkiaCamera, type CampusSkiaPeopleFrame, type CampusSkiaPersonSample } from './campusSkiaPeoplePackets';
import { campusPeopleAtlasSvg, PEOPLE_ATLAS, peopleAtlasCell } from './campusSkiaPeopleSprites';

export interface CampusSkiaPeopleProps {
  compiled: ScenePeopleCompiled | null; clock: ScenePeopleClock; visibility: CampusPeopleVisibility;
  mode: SceneViewMode; unit: number; camera: SharedValue<CampusSkiaCamera>;
  viewport: { width: number; height: number }; night: boolean; scene: CampusSceneDocument;
}
type PeopleFrame = CampusSkiaPeopleFrame & { batch: CampusSkiaPersonSample[]; clipped: CampusSkiaPersonSample[] };

function compileClips(scene: CampusSceneDocument, floor: string | null, mode: SceneViewMode, unit: number) {
  const occluders = scenePeopleOccluders(scene, floor, mode, unit);
  const paths = occluders.map(occluder => {
    let result: SkPath | null = null;
    for (const mask of occluder.masks) {
      let path = Skia.Path.MakeFromSVGString(mask.path);
      if (!path) continue;
      if (!mask.fill) path = Skia.Path.Stroke(path, { width: mask.strokeWidth ?? unit * .1 });
      if (!path) continue;
      if (mask.transform) {
        const transform = Skia.Matrix().translate(mask.transform.x, mask.transform.y).scale(mask.transform.scaleX, mask.transform.scaleY);
        path = Skia.PathBuilder.Make().addPath(path, transform).detach();
      }
      const combined: SkPath | null = result ? Skia.Path.MakeFromOp(result, path, PathOp.Union) : path;
      if (!combined) return Skia.Path.Rect(Skia.XYWHRect(occluder.bounds.x, occluder.bounds.y, occluder.bounds.width, occluder.bounds.height));
      result = combined;
    }
    // A native path allocation failure is conservative: never expose a walker through known geometry.
    return result ?? Skia.Path.Rect(Skia.XYWHRect(occluder.bounds.x, occluder.bounds.y, occluder.bounds.width, occluder.bounds.height));
  });
  return { occluders, paths };
}

/** Same Canvas as the scene. The complete frame loop stays on the UI runtime;
 * JS only compiles authorized plans and immutable silhouettes when inputs change. */
export const CampusSkiaPeople = memo(function CampusSkiaPeople(props: CampusSkiaPeopleProps) {
  const { visibility, clock, compiled } = props;
  if (!compiled || clock.instant === null || !visibility.enabled || !visibility.active || !visibility.focused) return null;
  // Epoch keys discard native buffers across actor/world/publication changes.
  // Confirmed Simulation clock steps reuse the atlas; numeric sampling is stateless on seeks.
  return <PeopleLayer key={`${clock.epoch}:${visibility.floorId ?? 'outdoors'}`} {...props} />;
});

function PeopleLayer({ compiled, clock, visibility, mode, unit, camera, viewport, night, scene }: CampusSkiaPeopleProps) {
  const { colors } = useTheme();
  const floor = visibility.floorId ?? null;
  const clips = useMemo(() => compileClips(scene, floor, mode, unit), [scene, floor, mode, unit]);
  const packet = useMemo(() => compileCampusSkiaPeoplePacket(compiled, { floorId: floor, mode, unit, maxPeople: visibility.maxPeople,
    wide: viewport.width >= 768, occluders: clips.occluders }), [compiled, floor, mode, unit, visibility.maxPeople, viewport.width >= 768, clips]);
  const instant = useSharedValue(clock.instant);
  const moving = clock.live && clock.running && !visibility.reducedMotion;
  const callback = useFrameCallback(() => {
    'worklet'; const now = Date.now();
    if (instant.value === null || now - instant.value >= 1000 || campusSkiaPeopleAnimateAt(packet, now)) instant.value = now;
  }, false);
  const hasFigures = packet.tracks.length > 0 || packet.pulses.length > 0;
  useEffect(() => { instant.value = clock.instant; callback.setActive(moving && hasFigures); return () => callback.setActive(false); }, [clock.instant, moving, hasFigures, callback, instant]);
  const frame = useDerivedValue<PeopleFrame>(() => {
    const sampled = sampleCampusSkiaPeoplePacket(packet, instant.value, camera.value, viewport, moving);
    return { ...sampled, batch: sampled.people.filter(person => !person.clips.length), clipped: sampled.people.filter(person => person.clips.length) };
  }, [packet, instant, camera, viewport.width, viewport.height, moving]);
  const svg = useMemo(() => Skia.SVG.MakeFromString(campusPeopleAtlasSvg(night, colors.action)), [night, colors.action]);
  return <PeopleTexture {...{ svg, frame, camera, packet, paths: clips.paths }} />;
}

function PeopleTexture({ svg, frame, camera, packet, paths }: {
  svg: ReturnType<typeof Skia.SVG.MakeFromString>; frame: SharedValue<PeopleFrame>; camera: SharedValue<CampusSkiaCamera>;
  packet: ReturnType<typeof compileCampusSkiaPeoplePacket>; paths: readonly SkPath[];
}) {
  // The public hook creates/upload this one vector atlas on the UI thread.
  const texture = usePeopleTexture(svg);
  return <>
    <PeopleAtlas frame={frame} image={texture} camera={camera} count={packet.maximum} />
    {Array.from({ length: packet.clippedMaximum }, (_, index) => <ClippedPerson key={index} {...{ frame, image: texture, camera, paths, index }} />)}
    <PulseAtlas frame={frame} image={texture} />
  </>;
}

function usePeopleTexture(svg: ReturnType<typeof Skia.SVG.MakeFromString>) {
  return useTexture(<ImageSVG svg={svg} x={0} y={0} width={PEOPLE_ATLAS.width} height={PEOPLE_ATLAS.height} />,
    { width: PEOPLE_ATLAS.width, height: PEOPLE_ATLAS.height }, [svg]);
}

function PeopleAtlas({ frame, image, camera, count }: { frame: SharedValue<PeopleFrame>; image: SharedValue<SkImage | null>; camera: SharedValue<CampusSkiaCamera>; count: number }) {
  const sprites = useRectBuffer(count, (rect, index) => {
    'worklet'; const person = frame.value.batch[index];
    const cell = person ? peopleAtlasCell(person.wardrobe, person.direction, person.step) : { x: 0, y: 0 };
    rect.setXYWH(cell.x, cell.y, PEOPLE_ATLAS.cellWidth, PEOPLE_ATLAS.cellHeight);
  });
  const transforms = useRSXformBuffer(count, (transform, index) => {
    'worklet'; const person = frame.value.batch[index];
    if (!person) { transform.set(0, 0, -100, -100); return; }
    const scale = person.height / PEOPLE_ATLAS.cellHeight, view = camera.value;
    transform.set(scale, 0, person.x * view.scale + view.x - PEOPLE_ATLAS.cellWidth * scale / 2, person.y * view.scale + view.y - PEOPLE_ATLAS.feetY * scale);
  });
  const colors = useColorBuffer(count, (color, index) => { 'worklet'; color[0] = 1; color[1] = 1; color[2] = 1; color[3] = frame.value.batch[index]?.alpha ?? 0; });
  return <Atlas image={image} sprites={sprites} transforms={transforms} colors={colors} colorBlendMode="modulate" />;
}

function ClippedPerson({ frame, image, camera, paths, index }: { frame: SharedValue<PeopleFrame>; image: SharedValue<SkImage | null>; camera: SharedValue<CampusSkiaCamera>; paths: readonly SkPath[]; index: number }) {
  const hidden = useMemo(() => Skia.Path.Rect(Skia.XYWHRect(-1000000, -1000000, 2000000, 2000000)), []);
  const clip = useSharedValue(hidden);
  // The union changes only at a silhouette boundary. Camera gestures reuse world paths.
  useAnimatedReaction(() => frame.value.clipped[index]?.clipKey ?? '', key => {
    if (!key) { clip.value = hidden; return; }
    const indices = frame.value.clipped[index]?.clips ?? [];
    let combined: SkPath | null = null;
    for (const candidate of indices) {
      combined = combined ? Skia.Path.MakeFromOp(combined, paths[candidate]!, PathOp.Union) : paths[candidate]!;
      if (!combined) break;
    }
    clip.value = combined ?? hidden;
  }, [paths, index, frame, hidden]);
  const cameraTransform = useDerivedValue(() => [{ translateX: camera.value.x }, { translateY: camera.value.y }, { scale: camera.value.scale }]);
  const sprites = useRectBuffer(1, rect => {
    'worklet'; const person = frame.value.clipped[index], cell = person ? peopleAtlasCell(person.wardrobe, person.direction, person.step) : { x: 0, y: 0 };
    rect.setXYWH(cell.x, cell.y, PEOPLE_ATLAS.cellWidth, PEOPLE_ATLAS.cellHeight);
  });
  const transforms = useRSXformBuffer(1, transform => {
    'worklet'; const person = frame.value.clipped[index];
    if (!person) { transform.set(0, 0, -100, -100); return; }
    const scale = person.height / PEOPLE_ATLAS.cellHeight / camera.value.scale;
    transform.set(scale, 0, person.x - PEOPLE_ATLAS.cellWidth * scale / 2, person.y - PEOPLE_ATLAS.feetY * scale);
  });
  const opacity = useDerivedValue(() => frame.value.clipped[index]?.alpha ?? 0);
  return <Group transform={cameraTransform}><Group clip={clip} invertClip opacity={opacity}><Atlas image={image} sprites={sprites} transforms={transforms} /></Group></Group>;
}

function PulseAtlas({ frame, image }: { frame: SharedValue<PeopleFrame>; image: SharedValue<SkImage | null> }) {
  const sprites = useRectBuffer(128, (rect, index) => {
    'worklet'; const pulse = frame.value.pulses[index % 64], cell = peopleAtlasCell(6, (pulse?.accepted ? 1 : 0) + (index >= 64 ? 2 : 0), 0);
    rect.setXYWH(cell.x, cell.y, PEOPLE_ATLAS.cellWidth, PEOPLE_ATLAS.cellHeight);
  });
  const transforms = useRSXformBuffer(128, (transform, index) => {
    'worklet'; const pulse = frame.value.pulses[index % 64], wave = index >= 64;
    if (!pulse || wave && pulse.progress >= 1) { transform.set(0, 0, -100, -100); return; }
    const diameter = wave ? 12 + pulse.progress * 20 : 12, scale = diameter / PEOPLE_ATLAS.cellWidth;
    transform.set(scale, 0, pulse.x - diameter / 2, pulse.y - PEOPLE_ATLAS.cellHeight * scale / 2);
  });
  const colors = useColorBuffer(128, (color, index) => {
    'worklet'; const pulse = frame.value.pulses[index % 64];
    color[0] = 1; color[1] = 1; color[2] = 1; color[3] = pulse ? index >= 64 ? (1 - pulse.progress) * .5 : .85 : 0;
  });
  return <Atlas image={image} sprites={sprites} transforms={transforms} colors={colors} colorBlendMode="modulate" />;
}
