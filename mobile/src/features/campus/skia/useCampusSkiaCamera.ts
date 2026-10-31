import { useLayoutEffect, useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { nativeCampusCameraFromViewport, resolveNativeCampusCamera, type CampusCamera, type NativeCampusCameraFrame } from '../../../lib/campus-camera';
import { fitSceneViewport, type SceneBounds, type SceneSize, type SceneViewport } from '../../../../../packages/contracts/src/campus-scenes/sceneGeometry';
import { campusViewportConstraints, constrainCampusSkiaViewport, zoomCampusSkiaViewport } from './campusSkiaViewport';

export function useCampusSkiaCamera(input: { key: string; size: SceneSize; bounds: SceneBounds; camera: CampusCamera;
  focus?: SceneBounds | null; overview: boolean; onChange(camera: CampusCamera): void;
  onTap(x: number, y: number, viewport: SceneViewport): void }) {
  const frame = useRef<NativeCampusCameraFrame | null>(null);
  const resolved = resolveNativeCampusCamera(frame.current, input);
  const viewport = useSharedValue<SceneViewport>(resolved.frame.viewport);
  const currentEpoch = useRef({ key: input.key, value: 0 });
  if (currentEpoch.current.key !== input.key) currentEpoch.current = { key: input.key, value: currentEpoch.current.value + 1 };
  const epoch = useSharedValue(currentEpoch.current.value), panEpoch = useSharedValue(-1), pinchEpoch = useSharedValue(-1), tapEpoch = useSharedValue(-1);
  const latest = useRef(input); latest.current = input;
  const external = useRef('');
  const externalKey = JSON.stringify([input.key, resolved.frame.viewport]);
  useLayoutEffect(() => {
    frame.current = resolved.frame;
    if (external.current !== externalKey) {
      external.current = externalKey;
      epoch.value = currentEpoch.current.value;
      viewport.value = resolved.frame.viewport;
    }
    if (resolved.changed) latest.current.onChange(resolved.camera);
  });
  const minimumScale = fitSceneViewport(input.size, input.bounds).scale;
  const limits = useMemo(() => campusViewportConstraints(input.size, input.bounds, minimumScale),
    [input.size.width, input.size.height, input.size.topInset, input.size.bottomInset, input.bounds.x, input.bounds.y, input.bounds.width, input.bounds.height, minimumScale]);
  const commit = (value: SceneViewport, sampleEpoch: number) => {
    if (sampleEpoch !== currentEpoch.current.value) return;
    const next = latest.current;
    next.onChange(nativeCampusCameraFromViewport(value, next.size, next.bounds));
  };
  const tap = (x: number, y: number, value: SceneViewport, sampleEpoch: number) => {
    if (sampleEpoch === currentEpoch.current.value) latest.current.onTap(x, y, value);
  };
  const gesture = useMemo(() => {
    const pan = Gesture.Pan().minDistance(4).averageTouches(true)
      .onBegin(() => { panEpoch.value = epoch.value; })
      .onChange(event => {
        if (panEpoch.value !== epoch.value) return;
        const previous = viewport.value;
        viewport.value = constrainCampusSkiaViewport({ ...previous, x: previous.x + event.changeX, y: previous.y + event.changeY }, limits);
      })
      .onEnd(() => { if (panEpoch.value === epoch.value) scheduleOnRN(commit, viewport.value, epoch.value); });
    const pinch = Gesture.Pinch()
      .onBegin(() => { pinchEpoch.value = epoch.value; })
      .onChange(event => {
        if (pinchEpoch.value !== epoch.value) return;
        viewport.value = zoomCampusSkiaViewport(viewport.value, event.focalX, event.focalY, event.scaleChange, limits);
      })
      .onEnd(() => { if (pinchEpoch.value === epoch.value) scheduleOnRN(commit, viewport.value, epoch.value); });
    const press = Gesture.Tap().maxDistance(6)
      .onBegin(() => { tapEpoch.value = epoch.value; })
      .onEnd((event, success) => {
        if (success && tapEpoch.value === epoch.value) scheduleOnRN(tap, event.x, event.y, viewport.value, tapEpoch.value);
      });
    return Gesture.Race(Gesture.Simultaneous(pan, pinch), press);
  }, [limits, viewport, epoch, panEpoch, pinchEpoch, tapEpoch]);
  const transform = useDerivedValue(() => [{ translateX: viewport.value.x }, { translateY: viewport.value.y }, { scale: viewport.value.scale }]);
  return { viewport, transform, gesture, settledViewport: resolved.frame.viewport };
}
