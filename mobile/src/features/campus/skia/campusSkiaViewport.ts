import type { SceneBounds, SceneSize, SceneViewport } from '../../../../../packages/contracts/src/campus-scenes/sceneGeometry';

export interface CampusViewportConstraints {
  width: number; height: number; top: number; availableHeight: number;
  bounds: SceneBounds; minimumScale: number; maximumScale: number;
}
/** Precomputed outside the gesture loop; matches the shared camera's inset rules. */
export function campusViewportConstraints(size: SceneSize, bounds: SceneBounds, minimumScale: number): CampusViewportConstraints {
  const top = Math.max(0, Math.min(size.height / 3, size.topInset ?? 0));
  const bottom = Math.max(0, Math.min(Math.max(0, size.height - top - 1), size.bottomInset ?? 0));
  return { width: size.width, height: size.height, top, availableHeight: Math.max(1, size.height - top - bottom),
    bounds, minimumScale, maximumScale: minimumScale * 8 };
}
function axis(value: number, length: number, origin: number, extent: number, scale: number) {
  'worklet';
  const rendered = extent * scale;
  if (rendered <= length - 48) return (length - rendered) / 2 - origin * scale;
  return Math.max(length - (origin + extent) * scale - 24, Math.min(24 - origin * scale, value));
}
/** Numeric-only UI-thread equivalent of clampSceneViewport, covered against it. */
export function constrainCampusSkiaViewport(value: SceneViewport, limits: CampusViewportConstraints): SceneViewport {
  'worklet';
  const scale = Math.max(limits.minimumScale, Math.min(limits.maximumScale, value.scale));
  return { scale, x: axis(value.x, limits.width, limits.bounds.x, limits.bounds.width, scale),
    y: limits.top + axis(value.y - limits.top, limits.availableHeight, limits.bounds.y, limits.bounds.height, scale) };
}
export function zoomCampusSkiaViewport(value: SceneViewport, x: number, y: number, multiplier: number, limits: CampusViewportConstraints): SceneViewport {
  'worklet';
  const scale = Math.max(limits.minimumScale, Math.min(limits.maximumScale, value.scale * multiplier));
  return constrainCampusSkiaViewport({ scale, x: x - (x - value.x) * scale / value.scale,
    y: y - (y - value.y) * scale / value.scale }, limits);
}
