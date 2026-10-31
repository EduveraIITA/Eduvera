import { clampSceneViewport, fitSceneViewport, sceneViewportInsets, type SceneBounds, type SceneSize, type SceneViewport } from "./sceneGeometry";

export interface SceneViewportFocus { key: string; bounds: SceneBounds }

/** Centre the requested context at the renderer's supported zoom, then keep the camera inside the campus. */
export function fitFocusedSceneViewport(size: SceneSize, focus: SceneBounds, campus: SceneBounds): SceneViewport {
  const full = fitSceneViewport(size, campus), requested = fitSceneViewport(size, focus);
  const scale = Math.max(full.scale, Math.min(full.scale * 8, requested.scale));
  const { top, height } = sceneViewportInsets(size);
  return clampSceneViewport({ scale, x: size.width / 2 - (focus.x + focus.width / 2) * scale,
    y: top + height / 2 - (focus.y + focus.height / 2) * scale }, size, campus);
}

/** Preserve a person's chosen world centre and zoom when the mobile map changes size. */
export function resizeSceneViewport(viewport: SceneViewport, previous: SceneSize, next: SceneSize, campus: SceneBounds): SceneViewport {
  const previousInsets = sceneViewportInsets(previous), nextInsets = sceneViewportInsets(next);
  const worldX = (previous.width / 2 - viewport.x) / viewport.scale;
  const worldY = (previousInsets.top + previousInsets.height / 2 - viewport.y) / viewport.scale;
  const fit = fitSceneViewport(next, campus), scale = Math.max(fit.scale, Math.min(fit.scale * 8, viewport.scale));
  return clampSceneViewport({ scale, x: next.width / 2 - worldX * scale,
    y: nextInsets.top + nextInsets.height / 2 - worldY * scale }, next, campus);
}
