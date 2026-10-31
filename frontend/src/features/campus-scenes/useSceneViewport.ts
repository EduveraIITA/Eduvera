import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { clampSceneViewport, fitSceneViewport, sceneViewportInsets, zoomSceneViewport, type SceneBounds, type SceneSize, type SceneViewMode, type SceneViewport } from "./sceneGeometry";
import type { CampusScenePoint } from "./types";
import { fitFocusedSceneViewport, resizeSceneViewport, type SceneViewportFocus } from "./sceneViewportFocus";

export function useSceneViewport(bounds: SceneBounds, mode: SceneViewMode, resetKey?: string, topInset = 0, focus?: SceneViewportFocus | null, bottomInset = 0, overview = false) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<SceneSize>({ width: 800, height: 600, topInset, bottomInset });
  const [viewport, setViewportState] = useState<SceneViewport>(() => focus ? fitFocusedSceneViewport(size, focus.bounds, bounds) : fitSceneViewport(size, bounds));
  const viewportRef = useRef(viewport);
  const animationFrame = useRef<number | null>(null);
  const cancelFrame = useCallback(() => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
  }, []);
  const commitViewport = useCallback<Dispatch<SetStateAction<SceneViewport>>>((next) => {
    cancelFrame();
    const value = typeof next === "function" ? next(viewportRef.current) : next;
    viewportRef.current = value;
    setViewportState(value);
  }, [cancelFrame]);
  const frame = useRef<{ identity: string; size: SceneSize } | null>(null);
  const target = useRef<"focus" | "campus" | "fit" | "manual">(focus ? "focus" : "campus");
  const setViewport = useCallback<Dispatch<SetStateAction<SceneViewport>>>((next) => {
    target.current = "manual"; commitViewport(next);
  }, [commitViewport]);
  // Input can arrive several times per display frame. Keep every delta, but paint only the latest camera.
  const scheduleViewport = useCallback<Dispatch<SetStateAction<SceneViewport>>>((next) => {
    target.current = "manual";
    viewportRef.current = typeof next === "function" ? next(viewportRef.current) : next;
    if (animationFrame.current === null) animationFrame.current = requestAnimationFrame(() => {
      animationFrame.current = null;
      setViewportState(viewportRef.current);
    });
  }, []);
  const flushViewport = useCallback(() => commitViewport(viewportRef.current), [commitViewport]);
  useEffect(() => cancelFrame, [cancelFrame]);

  const campusViewport = useCallback(() => {
    const fitted = fitSceneViewport(size, bounds);
    // A phone opens at a readable campus overview; the full extent remains available through Fit campus.
    return overview && size.width < 600 && size.height > size.width
      ? zoomSceneViewport(fitted, { x: size.width / 2, y: sceneViewportInsets(size).top + sceneViewportInsets(size).height / 2 }, 2.85, size, bounds)
      : fitted;
  }, [bounds, overview, size]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const styledInset = Number.parseFloat(getComputedStyle(host).getPropertyValue("--campus-map-bottom-inset"));
      const reservedBottom = Number.isFinite(styledInset) ? Math.max(0, styledInset) : bottomInset;
      if (rect.width > 0 && rect.height > 0) setSize((current) => current.width === rect.width && current.height === rect.height && current.topInset === topInset && current.bottomInset === reservedBottom ? current : { width: rect.width, height: rect.height, topInset, bottomInset: reservedBottom });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [topInset, bottomInset]);

  useEffect(() => {
    const identity = `${mode}:${resetKey ?? ""}:${focus?.key ?? "campus"}`;
    const previous = frame.current;
    frame.current = { identity, size };
    if (previous?.identity !== identity) {
      target.current = focus ? "focus" : "campus";
      commitViewport(focus ? fitFocusedSceneViewport(size, focus.bounds, bounds) : campusViewport());
    } else if (previous.size.width !== size.width || previous.size.height !== size.height || previous.size.topInset !== size.topInset || previous.size.bottomInset !== size.bottomInset) {
      commitViewport(current => target.current === "focus" && focus ? fitFocusedSceneViewport(size, focus.bounds, bounds)
        : target.current === "campus" ? campusViewport() : target.current === "fit" ? fitSceneViewport(size, bounds) : resizeSceneViewport(current, previous.size, size, bounds));
    } else {
      commitViewport((current) => {
        const next = clampSceneViewport(current, size, bounds);
        return next.x === current.x && next.y === current.y && next.scale === current.scale ? current : next;
      });
    }
  }, [bounds, focus, mode, resetKey, size, campusViewport, commitViewport]);

  const fit = () => { target.current = "fit"; commitViewport(fitSceneViewport(size, bounds)); };
  const fitFocus = () => { if (focus) { target.current = "focus"; commitViewport(fitFocusedSceneViewport(size, focus.bounds, bounds)); } };
  const inset = sceneViewportInsets(size);
  const zoom = (factor: number, point: CampusScenePoint = { x: size.width / 2, y: inset.top + inset.height / 2 }) => setViewport((current) => zoomSceneViewport(current, point, factor, size, bounds));
  return { hostRef, size, viewport, viewportRef, setViewport, scheduleViewport, flushViewport, fit, fitFocus, zoom };
}
