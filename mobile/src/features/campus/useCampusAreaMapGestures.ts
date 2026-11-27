import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Platform, View } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import type { DepartureMapViewport } from '../DepartureMapPolicy';
import { campusAreaPointAt, campusAreaZoom, campusAreaZoomPreview, panCampusArea, type CampusAreaPixel, type CampusAreaPoint } from './CampusAreaMapPolicy';

const resting = { x: 0, y: 0, scale: 1 };

export function useCampusAreaMapGestures(options: {
  viewport: DepartureMapViewport;
  width: number;
  height: number;
  disabled: boolean;
  drawing: boolean;
  wheelZoom: boolean;
  onViewport: (viewport: DepartureMapViewport) => void;
  onPoint: (point: CampusAreaPoint) => void;
}) {
  const target = useRef<ComponentRef<typeof View>>(null);
  const current = useRef(options);
  current.current = options;
  const [preview, setPreview] = useState(resting);
  const pinchAnchor = useRef<CampusAreaPixel | null>(null);
  const lastPinch = useRef<{ destination: CampusAreaPixel; scale: number } | null>(null);
  const pinchUsed = useRef(false);
  const { disabled, wheelZoom } = options;
  const gesture = useMemo(() => {
    const pan = Gesture.Pan().runOnJS(true).enabled(!disabled).minDistance(7).maxPointers(1)
      .onBegin(() => { if (!pinchAnchor.current) pinchUsed.current = false; })
      .onUpdate(({ translationX: x, translationY: y }) => {
        if (!pinchUsed.current) setPreview({ x, y, scale: 1 });
      })
      .onEnd(({ translationX, translationY }, success) => {
        const latest = current.current;
        if (success && !pinchUsed.current) {
          latest.onViewport(panCampusArea(latest.viewport, -translationX, -translationY));
        }
      })
      .onFinalize(() => { if (!pinchUsed.current) setPreview(resting); });
    const pinch = Gesture.Pinch().runOnJS(true).enabled(!disabled)
      .onStart(({ focalX, focalY }) => {
        pinchUsed.current = true;
        pinchAnchor.current = { x: focalX, y: focalY };
        lastPinch.current = null;
      })
      .onUpdate(({ focalX, focalY, scale }) => {
        const anchor = pinchAnchor.current;
        const latest = current.current;
        if (anchor && scale > 0) {
          const destination = { x: focalX, y: focalY };
          lastPinch.current = { destination, scale };
          setPreview(campusAreaZoomPreview(latest.viewport, scale, latest.width, latest.height, anchor, destination));
        }
      })
      .onEnd((_, success) => {
        const anchor = pinchAnchor.current, final = lastPinch.current;
        const latest = current.current;
        if (success && anchor && final) {
          latest.onViewport(campusAreaZoom(latest.viewport, Math.log2(final.scale), latest.width, latest.height, anchor, final.destination));
        }
      })
      .onFinalize(() => { pinchAnchor.current = null; lastPinch.current = null; setPreview(resting); });
    const tap = Gesture.Tap().runOnJS(true).enabled(!disabled).maxDistance(6).numberOfTaps(1)
      .onEnd(({ x, y }, success) => {
        const latest = current.current;
        if (success && latest.drawing && x >= 0 && x <= latest.width && y >= 0 && y <= latest.height) {
          latest.onPoint(campusAreaPointAt(latest.viewport, latest.width, latest.height, x, y));
        }
      });
    return Gesture.Race(Gesture.Simultaneous(pan, pinch), tap);
  }, [disabled]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !wheelZoom || disabled) return;
    // React Native Web exposes its host DOM node through the View ref.
    const node = target.current as unknown as HTMLDivElement | null;
    if (!node?.addEventListener) return;
    let delta = 0, updatedAt = 0, lastEvent = 0;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const latest = current.current;
      if (event.timeStamp - lastEvent > 180) delta = 0;
      lastEvent = event.timeStamp;
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? latest.height : 1;
      delta += event.deltaY * units * (event.ctrlKey ? 2 : 1);
      if (Math.abs(delta) < 36 || event.timeStamp - updatedAt < 100) return;
      const box = node.getBoundingClientRect();
      latest.onViewport(campusAreaZoom(latest.viewport, delta < 0 ? 1 : -1, latest.width, latest.height,
        { x: event.clientX - box.left, y: event.clientY - box.top }));
      delta = 0;
      updatedAt = event.timeStamp;
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [wheelZoom, disabled]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = target.current as unknown as HTMLDivElement | null;
    if (node?.style) node.style.cursor = disabled ? 'default' : options.drawing ? 'crosshair' : 'grab';
  }, [options.drawing, disabled]);
  return { gesture, target, preview };
}
