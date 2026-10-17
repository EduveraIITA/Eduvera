import Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Stage as KonvaStage } from "konva/lib/Stage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAMPUS_VIEW_BOX } from "./geometry";
import {
  clampMapScale,
  constrainMapViewport,
  fitMapViewport,
  pinchMapViewport,
  preserveMapCenter,
  zoomMapAtPoint,
  type MapPoint,
  type MapBounds,
  type MapSize,
  type MapViewport,
} from "./mapViewport";

const INITIAL_SIZE = { width: 390, height: 640 };

function distance(first: MapPoint, second: MapPoint) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function center(first: MapPoint, second: MapPoint) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function fitPadding(size: MapSize) {
  return size.width < 680 ? 24 : 48;
}

export function useCampusMapViewport(resetKey: string, bounds: MapBounds = CAMPUS_VIEW_BOX) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<KonvaStage>(null);
  const [size, setSize] = useState<MapSize>(INITIAL_SIZE);
  const initial = useMemo(() => fitMapViewport(INITIAL_SIZE, bounds, fitPadding(INITIAL_SIZE)), [bounds]);
  const [viewport, setViewport] = useState<MapViewport>(initial);
  const [ready, setReady] = useState(false);
  const fittedKey = useRef("");
  const measured = useRef(false);
  const previousPinch = useRef<{ center: MapPoint; distance: number } | null>(null);

  const fitScale = useMemo(() => fitMapViewport(size, bounds, fitPadding(size)).scale, [bounds, size]);
  const fit = useCallback(() => {
    setViewport(fitMapViewport(size, bounds, fitPadding(size)));
  }, [bounds, size]);

  useEffect(() => {
    const previous = Konva.hitOnDragEnabled;
    Konva.hitOnDragEnabled = true;
    return () => { Konva.hitOnDragEnabled = previous; };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const rect = host.getBoundingClientRect();
      const next = { width: Math.max(280, Math.round(rect.width)), height: Math.max(360, Math.round(rect.height)) };
      if (!measured.current) {
        measured.current = true;
        setReady(true);
        setSize(next);
        setViewport(fitMapViewport(next, bounds, fitPadding(next)));
        return;
      }
      setSize((current) => {
        if (current.width === next.width && current.height === next.height) return current;
        setViewport((view) => constrainMapViewport(preserveMapCenter(view, current, next), next, bounds));
        return next;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [bounds]);

  useEffect(() => {
    if (!ready || !resetKey || fittedKey.current === resetKey) return;
    fittedKey.current = resetKey;
    fit();
  }, [fit, ready, resetKey]);

  const updateViewport = useCallback((next: MapViewport) => {
    setViewport(constrainMapViewport(next, size, bounds));
  }, [bounds, size]);

  const zoomBy = useCallback((factor: number, point: MapPoint = { x: size.width / 2, y: size.height / 2 }) => {
    setViewport((current) => constrainMapViewport(
      zoomMapAtPoint(current, point, clampMapScale(current.scale * factor, fitScale)),
      size,
      bounds,
    ));
  }, [bounds, fitScale, size]);

  const onWheel = useCallback((event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    const point = stage?.getPointerPosition();
    if (!point) return;
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    zoomBy(direction > 0 ? 1.08 : 1 / 1.08, point);
  }, [zoomBy]);

  const onDragEnd = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    updateViewport({ x: stage.x(), y: stage.y(), scale: stage.scaleX() });
  }, [updateViewport]);

  const dragBound = useCallback((position: MapPoint) => {
    const constrained = constrainMapViewport({ ...position, scale: viewport.scale }, size, bounds);
    return { x: constrained.x, y: constrained.y };
  }, [bounds, size, viewport.scale]);

  const onTouchMove = useCallback((event: KonvaEventObject<TouchEvent>) => {
    if (event.evt.touches.length !== 2) return;
    event.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    if (stage.isDragging()) stage.stopDrag();
    const rect = stage.container().getBoundingClientRect();
    const points = Array.from(event.evt.touches).map((touch) => ({ x: touch.clientX - rect.left, y: touch.clientY - rect.top }));
    const first = points[0];
    const second = points[1];
    if (!first || !second) return;
    const nextCenter = center(first, second);
    const nextDistance = distance(first, second);
    const previous = previousPinch.current;
    if (previous) {
      setViewport((current) => constrainMapViewport(
        pinchMapViewport(current, previous.center, previous.distance, nextCenter, nextDistance, fitScale),
        size,
        bounds,
      ));
    }
    previousPinch.current = { center: nextCenter, distance: nextDistance };
  }, [bounds, fitScale, size]);

  const onTouchEnd = useCallback(() => {
    previousPinch.current = null;
  }, []);

  return {
    hostRef,
    stageRef,
    size,
    viewport,
    fit,
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(1 / 1.25),
    onWheel,
    onDragEnd,
    dragBound,
    onTouchMove,
    onTouchEnd,
  };
}
