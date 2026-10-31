import type { CampusSceneElement } from "./types";
import { projectScenePoint, sceneElementHeight, scenePolygonCenter, type SceneSize, type SceneViewMode, type SceneViewport } from "./sceneGeometry";

export interface SceneFloatingLabel { id: string; name: string; lines: string[]; selected: boolean; x: number; y: number; width: number; height: number; anchorX: number; anchorY: number }
function wrap(text: string, length: number): string[] {
  const words = text.trim().split(/\s+/u), lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + word.length + 1 > length) { lines.push(line); line = ""; }
    if (word.length > length) {
      if (line) { lines.push(line); line = ""; }
      for (let offset = 0; offset < word.length; offset += length) lines.push(word.slice(offset, offset + length));
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
/** Only the selected entity receives a floating name; all objects retain accessible names. */
export function layoutSceneLabels(elements: readonly CampusSceneElement[], mode: SceneViewMode, unit: number, viewport: SceneViewport, size: SceneSize, selectedId?: string | null): SceneFloatingLabel[] {
  const element = elements.find(item => item.id === selectedId && item.label.trim());
  if (!element) return [];
  const narrow = size.width < 600, top = (size.topInset ?? 0) + 8;
  const center = element.geometry.type === "polygon" ? scenePolygonCenter(element.geometry.points) : element.geometry.points[Math.floor(element.geometry.points.length / 2)]!;
  const anchor = projectScenePoint(center, sceneElementHeight(element, unit), mode), anchorX = viewport.x + anchor.x * viewport.scale, anchorY = viewport.y + anchor.y * viewport.scale;
  if (anchorX < -20 || anchorX > size.width + 20 || anchorY < -40 || anchorY > size.height + 20) return [];
  const lines = wrap(element.label, narrow ? 29 : 40);
  const width = Math.min(size.width - 24, Math.max(76, Math.max(...lines.map(line => line.length)) * 6.6 + 22)), height = lines.length * 15 + 12;
  return [{ id: element.id, name: element.label, selected: true, lines, width, height, anchorX, anchorY,
    x: Math.max(8, Math.min(size.width - width - 8, anchorX - width / 2)),
    y: Math.max(top, Math.min(Math.max(top, size.height - 90 - height), anchorY - height - 14)) }];
}
