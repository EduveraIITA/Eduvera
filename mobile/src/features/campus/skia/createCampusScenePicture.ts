import { ClipOp, PaintStyle, Skia, StrokeCap, StrokeJoin, TileMode, type SkCanvas, type SkPaint, type SkPath, type SkPicture } from 'react-native-skia';
import type { CampusScenePoint } from '../../../../../packages/contracts/src/campus-scenes/types';
import type { SceneBounds } from '../../../../../packages/contracts/src/campus-scenes/sceneGeometry';
import type { CampusDrawingCommand, CampusDrawingFill, CampusDrawingPart, CompiledCampusDrawing } from './compileCampusSceneDrawing';
import { planCampusScenePictureLayers } from './compileCampusSceneDrawing';

function polygonPath(points: readonly CampusScenePoint[], closed: boolean): SkPath {
  return points.length ? Skia.Path.Polygon([...points], closed) : Skia.Path.Make();
}

/** Per-recording paint/shader cache. Pictures retain their native drawing resources. */
class RecordingPaints {
  private readonly paints = new Map<string, SkPaint>();
  private readonly svgPaths = new Map<string, SkPath | null>();
  path(source: string): SkPath | null {
    if (!source.trim()) return null;
    if (this.svgPaths.has(source)) return this.svgPaths.get(source)!;
    const path = Skia.Path.MakeFromSVGString(source);
    this.svgPaths.set(source, path);
    return path;
  }
  get(color: CampusDrawingFill, opacity: number, strokeWidth?: number, dash?: number[]): SkPaint {
    const key = JSON.stringify([color, opacity, strokeWidth, dash]), old = this.paints.get(key);
    if (old) return old;
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(strokeWidth === undefined ? PaintStyle.Fill : PaintStyle.Stroke);
    if (strokeWidth !== undefined) {
      paint.setStrokeWidth(strokeWidth);
      paint.setStrokeCap(StrokeCap.Round);
      paint.setStrokeJoin(StrokeJoin.Round);
      if (dash?.length) paint.setPathEffect(Skia.PathEffect.MakeDash(dash, 0));
    }
    if (typeof color === 'string') paint.setColor(Skia.Color(color));
    else {
      paint.setColor(Skia.Color('#ffffff'));
      const colors = color.colors.map(value => Skia.Color(value));
      paint.setShader(color.kind === 'linear'
        ? Skia.Shader.MakeLinearGradient(color.start, color.end, colors, color.positions ?? null, TileMode.Clamp)
        : Skia.Shader.MakeRadialGradient(color.center, Math.max(.0001, color.radius), colors, color.positions ?? null, TileMode.Clamp));
    }
    paint.setAlphaf(opacity);
    this.paints.set(key, paint);
    return paint;
  }
}

function drawCommand(canvas: SkCanvas, command: CampusDrawingCommand, paints: RecordingPaints) {
  const opacity = command.opacity ?? 1;
  if (opacity <= 0 || !command.fill && (!command.stroke || !command.strokeWidth)) return;
  const scoped = !!command.clip?.length || !!command.transform;
  if (scoped) canvas.save();
  // Clip is already in world projection. Apply it before an asset-local transform.
  if (command.clip?.length) canvas.clipPath(polygonPath(command.clip, true), ClipOp.Intersect, true);
  if (command.transform) {
    const [a, b, c, d, tx, ty] = command.transform;
    canvas.concat(Skia.Matrix([a, c, tx, b, d, ty, 0, 0, 1]));
  }
  let path: SkPath | null = null;
  if (command.kind === 'polygon' || command.kind === 'polyline') path = polygonPath(command.points, command.kind === 'polygon');
  else if (command.kind === 'path') path = paints.path(command.path);
  const draw = (paint: SkPaint) => {
    if (command.kind === 'oval') canvas.drawOval(Skia.XYWHRect(command.x, command.y, command.width, command.height), paint);
    else if (path) canvas.drawPath(path, paint);
  };
  if (command.fill) draw(paints.get(command.fill, opacity));
  if (command.stroke && command.strokeWidth && command.strokeWidth > 0) draw(paints.get(command.stroke, opacity, command.strokeWidth, command.dash));
  if (scoped) canvas.restore();
}

function record(parts: readonly CampusDrawingPart[], bounds: SceneBounds): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(bounds.x, bounds.y, Math.max(1, bounds.width), Math.max(1, bounds.height))), paints = new RecordingPaints();
  for (const part of parts) for (const command of part.commands) drawCommand(canvas, command, paints);
  return recorder.finishRecordingAsPicture();
}

/** Immutable native vector display list. Memoize on the compiled drawing, not camera. */
export function createCampusScenePicture(drawing: CompiledCampusDrawing): SkPicture {
  return record(drawing.parts, drawing.bounds);
}

/** Optional retained fragments keep source order available for safe viewport culling. */
export function createCampusScenePartPictures(drawing: CompiledCampusDrawing): Array<{ part: CampusDrawingPart; picture: SkPicture }> {
  return drawing.parts.filter(part => part.commands.length > 0).map(part => ({ part, picture: record([part], part.bounds) }));
}

export interface RetainedCampusPictureLayer {
  key: string;
  elementId: string | null;
  base: boolean;
  picture: SkPicture;
}
export interface RetainedCampusPictureStats {
  staticRecordings: number;
  resourceRecordings: number;
  elementCompilations: number;
  cachedElementVariants: number;
}
export interface RetainedCampusScenePictures {
  readonly stats: Readonly<RetainedCampusPictureStats>;
  /** Stable callback is called once per unavailable element variant. Its drawing
   * must use the same geometry, source IDs, lighting and floor as baseDrawing. */
  resolve(unavailableIds: ReadonlySet<string>, compileElement: (elementId: string, unavailable: boolean) => CompiledCampusDrawing): RetainedCampusPictureLayer[];
}

/** Keep static scenery and mutable resources in the exact same painter sequence.
 * Resource variants are bounded to available/unavailable; old geometry owners
 * become collectible normally. No effect cleanup can invalidate a picture still
 * retained by React StrictMode or a native rendering frame. */
export function createCampusSceneRetainedPictures(baseDrawing: CompiledCampusDrawing, options: { mutableElementIds: ReadonlySet<string> }): RetainedCampusScenePictures {
  const plans = planCampusScenePictureLayers(baseDrawing, options.mutableElementIds);
  const stats: RetainedCampusPictureStats = { staticRecordings: 0, resourceRecordings: 0, elementCompilations: 0, cachedElementVariants: 0 };
  const staticLayers = new Map<string, RetainedCampusPictureLayer>(), available = new Map<string, RetainedCampusPictureLayer>();
  const unavailable = new Map<string, Map<string, RetainedCampusPictureLayer>>();
  for (const plan of plans) {
    const layer: RetainedCampusPictureLayer = { key: plan.key, elementId: plan.elementId, base: plan.base, picture: record(plan.parts, unionPartBounds(plan.parts)) };
    if (plan.elementId) { available.set(plan.key, layer); stats.resourceRecordings++; }
    else { staticLayers.set(plan.key, layer); stats.staticRecordings++; }
  }
  return {
    get stats() { return { ...stats }; },
    resolve(unavailableIds, compileElement) {
      const changedIds = new Set(plans.filter(plan => plan.elementId && unavailableIds.has(plan.elementId)).map(plan => plan.elementId!));
      for (const elementId of changedIds) {
        if (unavailable.has(elementId)) continue;
        const next = compileElement(elementId, true), matching = next.parts.filter(part => part.elementId === elementId), keys = new Set(plans.filter(plan => plan.elementId === elementId).flatMap(plan => plan.parts.map(part => part.key)));
        if (matching.some(part => !keys.has(part.key))) throw new Error('Resource geometry changed; prepare the campus drawing again.');
        const byKey = new Map(matching.map(part => [part.key, part]));
        const variants = new Map<string, RetainedCampusPictureLayer>();
        for (const plan of plans.filter(value => value.elementId === elementId)) {
          const original = plan.parts[0]!, part = byKey.get(original.key), previous = available.get(plan.key)!;
          // Contact/cast shadows do not change when a lamp fails. Preserve their
          // native picture as well instead of recording an identical fragment.
          if (part && JSON.stringify(part.commands) === JSON.stringify(original.commands)) variants.set(plan.key, previous);
          else {
            variants.set(plan.key, { key: plan.key, elementId, base: false, picture: record(part ? [part] : [], part?.bounds ?? original.bounds) });
            stats.resourceRecordings++;
          }
        }
        unavailable.set(elementId, variants);
        stats.elementCompilations++;
        stats.cachedElementVariants++;
      }
      return plans.map(plan => !plan.elementId ? staticLayers.get(plan.key)! : unavailableIds.has(plan.elementId) ? unavailable.get(plan.elementId)!.get(plan.key)! : available.get(plan.key)!);
    },
  };
}

function unionPartBounds(parts: readonly CampusDrawingPart[]): SceneBounds {
  const first = parts[0]?.bounds;
  if (!first) return { x: 0, y: 0, width: 1, height: 1 };
  let x = first.x, y = first.y, right = first.x + first.width, bottom = first.y + first.height;
  for (const { bounds: b } of parts.slice(1)) { x = Math.min(x, b.x); y = Math.min(y, b.y); right = Math.max(right, b.x + b.width); bottom = Math.max(bottom, b.y + b.height); }
  return { x, y, width: right - x, height: bottom - y };
}
