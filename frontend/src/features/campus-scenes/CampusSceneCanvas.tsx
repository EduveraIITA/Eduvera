import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { LocateFixed, Minus, Plus, Route } from "lucide-react";
import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint } from "./types";
import { clampSceneViewport, constrainSceneTranslation, projectScenePoint, sceneElementWidth, scenePaintOrder, scenePointsAttribute, sceneRenderBounds, sceneUnitScale, sceneVisibleElements, unprojectScenePoint, zoomSceneViewport, type SceneBounds, type SceneViewMode, type SceneViewport } from "./sceneGeometry";
import { SceneAssetDrawing, SceneElementOutline, SceneElementShadow } from "./SceneAssetDrawing";
import { layoutSceneLabels } from "./sceneLabels";
import { sceneDrawingParts } from "./sceneDepth";
import { SceneSurroundings } from "./SceneSurroundings";
import { SceneEvidenceMarkers } from "./SceneEvidenceMarkers";
import { ScenePeopleLayer } from "./ScenePeopleLayer";
import { SceneInteriorLabels } from './SceneInteriorLabels';
import { isSceneIndoorAssetKey } from "./sceneIndoorAssets";
import type { ScenePeopleClock, ScenePeopleCompiled } from "./scenePeopleTracks.types";
import type { SceneEvidenceMarker } from "./sceneOperations.types";
import type { SceneLighting } from "./sceneLighting";
import { SCENE_GROUND } from "./sceneLightingPalette";
import { DEFAULT_SCENE_SUNLIGHT, type SceneSunlight } from "./sceneSunlight";
import { useSceneViewport } from "./useSceneViewport";
import { SceneWalkingRouteOverlay } from "./SceneWalkingRouteOverlay";
import type { SceneWalkingRoute } from "./sceneWalking";
import type { SceneViewportFocus } from "./sceneViewportFocus";
import { sceneWalkingRouteFocus } from "./sceneRouteCamera";
import "./campus-scene-canvas.css";

const EMPTY_MARKERS:readonly SceneEvidenceMarker[]=[];
const EMPTY_IDS:readonly string[]=[];

export interface CampusSceneCanvasProps {
  scene: CampusSceneDocument;
  mode: SceneViewMode;
  lighting?: SceneLighting;
  sunlight?: SceneSunlight;
  markers?: readonly SceneEvidenceMarker[];
  people?: ScenePeopleCompiled | null;
  peopleClock?: ScenePeopleClock;
  walkingRoute?: SceneWalkingRoute | null;
  /** Optional camera target; a reviewed route always takes priority. */
  placeFocus?: SceneViewportFocus | null;
  selectedMarkerId?: string | null;
  onSelectMarker?: (id:string)=>void;
  unavailableFixtureIds?: readonly string[];
  selectedElementId?: string | null;
  highlightedElementIds?: readonly string[];
  onSelectElement: (id: string | null) => void;
  onMoveElement?: (id: string, dx: number, dy: number) => void;
  onCanvasPoint?: (point: CampusScenePoint) => void;
  onChangeVertex?: (id: string, index: number, point: CampusScenePoint) => void;
  draftPoints?: CampusScenePoint[];
  interaction?: "select" | "draw";
  sourceImageUrl?: string | null;
  /** Private proposal reference only; never published source metadata. */
  sourceImageBounds?: SceneBounds;
  sourceImageRotationDeg?: number;
  interiorView?: boolean;
  floorId?: string | null;
  interiorOutline?: CampusScenePoint[];
  viewBounds?: SceneBounds;
  topInset?: number;
  bottomInset?: number;
  showRooms?: boolean;
  resetKey?: string;
  overview?: boolean;
  className?: string;
}

type DragState = {
  kind: "pan" | "element" | "vertex" | "draw";
  pointerId: number;
  start: CampusScenePoint;
  startWorld: CampusScenePoint;
  viewport: SceneViewport;
  element?: CampusSceneElement;
  vertex?: number;
  moved: boolean;
};
type Preview = { id: string; delta?: CampusScenePoint; vertex?: { index: number; point: CampusScenePoint } } | null;

function withPreview(element: CampusSceneElement, preview: Preview): CampusSceneElement {
  if (preview?.id !== element.id) return element;
  const points = element.geometry.points.map((point, index) => preview.vertex?.index === index ? preview.vertex.point : preview.delta ? { x: point.x + preview.delta.x, y: point.y + preview.delta.y } : point);
  return { ...element, geometry: { ...element.geometry, points } };
}

export function CampusSceneCanvas({ scene, mode, lighting = "day", sunlight = DEFAULT_SCENE_SUNLIGHT, markers = EMPTY_MARKERS, people, peopleClock, walkingRoute, placeFocus, selectedMarkerId, onSelectMarker, unavailableFixtureIds = EMPTY_IDS, selectedElementId, highlightedElementIds = EMPTY_IDS, onSelectElement, onMoveElement, onCanvasPoint, onChangeVertex, draftPoints = [], interaction = "select", sourceImageUrl, sourceImageBounds, sourceImageRotationDeg, interiorView, floorId, interiorOutline, viewBounds, topInset = 0, bottomInset = 0, showRooms = false, resetKey, overview = false, className = "" }: CampusSceneCanvasProps) {
  const bounds = useMemo(() => viewBounds ?? sceneRenderBounds(scene, mode), [scene, mode, viewBounds]);
  const readOnlyView = interaction !== "draw" && !onMoveElement && !onChangeVertex && !onCanvasPoint;
  const routeFocus = useMemo(() => readOnlyView ? sceneWalkingRouteFocus(scene, walkingRoute, mode, floorId ?? null) : null, [readOnlyView, scene, walkingRoute, mode, floorId]);
  const { hostRef, size, viewport, viewportRef, setViewport, scheduleViewport, flushViewport, fit, fitFocus, zoom } = useSceneViewport(bounds, mode, resetKey, topInset, routeFocus ?? (readOnlyView ? placeFocus : null), bottomInset, overview && readOnlyView && !floorId);
  const [preview, setPreview] = useState<Preview>(null);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null), previewRef = useRef<Preview>(null);
  const pointers = useRef(new Map<number, CampusScenePoint>());
  const pinch = useRef<{ center: CampusScenePoint; distance: number } | null>(null);
  const gestureRect = useRef<DOMRect | null>(null);
  const helpId = `scene-help-${useId().replace(/:/g, "")}`, grainId = `scene-grain-${useId().replace(/:/g, "")}`;
  const unit = sceneUnitScale(scene);
  const interior = Boolean(floorId) || Boolean(interiorView);
  const night = lighting === "night";
  const effectiveSunlight = useMemo(() => night ? {...sunlight,strength:0} : sunlight,[night,sunlight]);
  const unavailable = useMemo(()=>new Set(unavailableFixtureIds),[unavailableFixtureIds]);
  const groundColor = interior ? night ? "#202a31" : "var(--thatcampus-surface-soft)" : SCENE_GROUND[lighting];
  const visible = useMemo(() => {
    const ordered = scenePaintOrder(sceneVisibleElements(scene.elements, floorId, showRooms));
    return mode === "2d" ? [...ordered.filter((element) => element.kind !== "room"), ...ordered.filter((element) => element.kind === "room")] : ordered;
  }, [scene.elements, floorId, showRooms, mode]);
  const rendered = useMemo(() => visible.map((element) => withPreview(element, preview)), [visible, preview]);
  const drawingParts = useMemo(() => {
    const parts = sceneDrawingParts(rendered, unit, mode);
    // Plan rooms form the base; furniture and openings stay visible above them.
    return mode === '2d' ? [...parts.filter(part=>part.element.kind==='room'),...parts.filter(part=>part.element.kind!=='room')] : parts;
  }, [rendered, unit, mode]);
  const approaches = useMemo(() => scene.elements.flatMap(element => {
    const points = element.asset_key === "gate" ? element.geometry.points : (element.kind === "road" || element.kind === "path") && element.asset_key !== "boundary_wall" ? [element.geometry.points[0]!, element.geometry.points[element.geometry.points.length - 1]!] : [];
    return points.map(point => ({point, width:sceneElementWidth(element,unit), kind: element.asset_key === "gate" ? "gate" as const : element.kind === "road" ? "road" as const : "path" as const}));
  }), [scene.elements, unit]);
  const surroundingsBounds = useMemo(() => ({x:-viewport.x/viewport.scale,y:-viewport.y/viewport.scale,width:size.width/viewport.scale,height:size.height/viewport.scale}),[viewport.x,viewport.y,viewport.scale,size.width,size.height]);
  const selected = rendered.find((element) => element.id === selectedElementId);
  const evidenceElementId = markers.find(marker=>marker.id===selectedMarkerId)?.elementId;
  const groupHighlights = useMemo(() => new Set(highlightedElementIds), [highlightedElementIds]);
  const highlighted = rendered.find(element=>element.id===evidenceElementId) ?? selected;
  const labels = selectedMarkerId ? [] : layoutSceneLabels(rendered, mode, unit, viewport, size, selectedElementId);
  const editing = mode === "2d" && Boolean(onMoveElement || onChangeVertex || onCanvasPoint);
  const simple = visible.length > 300;
  const localPoint = (event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }): CampusScenePoint => {
    const rect = gestureRect.current ?? event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * size.width / Math.max(1, rect.width), y: (event.clientY - rect.top) * size.height / Math.max(1, rect.height) };
  };
  const worldPoint = (point: CampusScenePoint) => { const camera = viewportRef.current; return unprojectScenePoint({ x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale }, mode); };
  const withinSite = (point: CampusScenePoint) => ({ x: Math.max(0, Math.min(scene.bounds.width, point.x)), y: Math.max(0, Math.min(scene.bounds.height, point.y)) });
  const updatePreview = (next: Preview) => { previewRef.current = next; setPreview(next); };

  // React delegates wheel listeners as passive. The map must consume wheel zoom without scrolling its page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const point = { x: (event.clientX - rect.left) * size.width / Math.max(1, rect.width), y: (event.clientY - rect.top) * size.height / Math.max(1, rect.height) };
      const multiplier = Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .008);
      scheduleViewport((current) => zoomSceneViewport(current, point, multiplier, size, bounds));
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [bounds, scheduleViewport, size]);

  function pinchState() {
    const [first, second] = Array.from(pointers.current.values());
    return first && second ? { center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, distance: Math.hypot(second.x - first.x, second.y - first.y) } : null;
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    if (!pointers.current.size) gestureRect.current = event.currentTarget.getBoundingClientRect();
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size > 1) {
      drag.current = null;
      updatePreview(null);
      pinch.current = pinchState();
      setDragging(true);
      return;
    }
    const target = event.target as Element;
    const elementId = target.closest("[data-scene-element]")?.getAttribute("data-scene-element");
    const vertexValue = target.closest("[data-scene-vertex]")?.getAttribute("data-scene-vertex");
    const element = visible.find((item) => item.id === elementId);
    const kind = interaction === "draw" && editing ? "draw" : editing && vertexValue !== null && vertexValue !== undefined && onChangeVertex ? "vertex" : editing && element && onMoveElement ? "element" : "pan";
    drag.current = { kind, pointerId: event.pointerId, start: point, startWorld: worldPoint(point), viewport: viewportRef.current, element, ...(vertexValue !== undefined && vertexValue !== null ? { vertex: Number(vertexValue) } : {}), moved: false };
    if (editing && element && interaction === "select") onSelectElement(element.id);
    setDragging(kind === "pan" || kind === "element" || kind === "vertex");
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size > 1) {
      const nextPinch = pinchState();
      if (!nextPinch) return;
      const { center, distance } = nextPinch;
      const previous = pinch.current;
      if (previous && previous.distance > 0) scheduleViewport((current) => {
        const next = zoomSceneViewport(current, previous.center, distance / previous.distance, size, bounds);
        return clampSceneViewport({ ...next, x: next.x + center.x - previous.center.x, y: next.y + center.y - previous.center.y }, size, bounds);
      });
      pinch.current = { center, distance };
      return;
    }
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = point.x - current.start.x, dy = point.y - current.start.y;
    if (Math.hypot(dx, dy) > 4) current.moved = true;
    if (current.kind === "pan" && current.moved) scheduleViewport(clampSceneViewport({ ...current.viewport, x: current.viewport.x + dx, y: current.viewport.y + dy }, size, bounds));
    if (current.kind === "element" && current.element) {
      const now = worldPoint(point), delta = constrainSceneTranslation(current.element, { x: now.x - current.startWorld.x, y: now.y - current.startWorld.y }, scene.bounds);
      updatePreview({ id: current.element.id, delta });
    }
    if (current.kind === "vertex" && current.element && current.vertex !== undefined) updatePreview({ id: current.element.id, vertex: { index: current.vertex, point: withinSite(worldPoint(point)) } });
  }

  function finishPointer(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const current = drag.current;
    if (!cancelled && current?.pointerId === event.pointerId) {
      const end = localPoint(event), dx = end.x - current.start.x, dy = end.y - current.start.y;
      if (Math.hypot(dx, dy) > 4) current.moved = true;
      if (current.kind === "pan" && current.moved) scheduleViewport(clampSceneViewport({ ...current.viewport, x: current.viewport.x + dx, y: current.viewport.y + dy }, size, bounds));
      const pending = previewRef.current;
      if (current.moved && pending?.delta && onMoveElement) onMoveElement(pending.id, pending.delta.x, pending.delta.y);
      if (current.moved && pending?.vertex && onChangeVertex) onChangeVertex(pending.id, pending.vertex.index, pending.vertex.point);
      if (!current.moved && current.kind === "draw") onCanvasPoint?.(withinSite(worldPoint(localPoint(event))));
      if (!current.moved && current.kind === "pan" && interaction === "select") onSelectElement(current.element?.id ?? null);
    }
    drag.current = null;
    pinch.current = null;
    updatePreview(null);
    flushViewport();
    const remaining = pointers.current.entries().next().value;
    if (pointers.current.size > 1) pinch.current = pinchState();
    else if (remaining) drag.current = { kind: "pan", pointerId: remaining[0], start: remaining[1], startWorld: worldPoint(remaining[1]), viewport: viewportRef.current, moved: true };
    else gestureRect.current = null;
    setDragging(Boolean(remaining));
  }

  const elementKeyDown = useCallback((event: KeyboardEvent<SVGGElement>, element: CampusSceneElement) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectElement(element.id); }
    if (mode !== "2d" || !onMoveElement || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const step = (event.shiftKey ? 5 : 1) * unit;
    const delta = constrainSceneTranslation(element, { x: event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0, y: event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0 }, scene.bounds);
    onMoveElement(element.id, delta.x, delta.y);
  }, [mode, onMoveElement, onSelectElement, scene.bounds, unit]);

  // Preserve the detailed vector subtree while only the camera transform changes.
  const groundAssets = useMemo(() => (rendered.filter((element) => element.asset_key !== "boundary_wall" && ["surface", "road", "path"].includes(element.kind)).map((element) => <g key={element.id} data-scene-element={element.id} role="button" tabIndex={0} aria-label={`${element.label}, ${element.kind}`} aria-pressed={selectedElementId === element.id || groupHighlights.has(element.id)} onKeyDown={(event) => elementKeyDown(event, element)} className="campus-scene-object">
          <title>{element.label}</title><SceneAssetDrawing element={element} mode={mode} unit={unit} simple={simple} lighting={lighting} sunlight={effectiveSunlight} />
        </g>)), [rendered, mode, unit, simple, lighting, effectiveSunlight, selectedElementId, groupHighlights, elementKeyDown]);
  const elevatedAssets = useMemo(() => (drawingParts.map(({key, source, element, primary}) => {
    // Interior furnishings describe the room; only real linked resources and
    // navigation fixtures need independent interaction in the published view.
    const indoor = isSceneIndoorAssetKey(source.asset_key);
    const decorative = readOnlyView && interior && indoor && !source.holding_id && !source.navigation_connector;
    const interactive = primary && !decorative;
    const targetPixels = readOnlyView && interior && indoor && source.holding_id && !source.navigation_connector ? 6 : 12;
    return <g key={key} data-scene-element={source.id} data-render-fragment={key !== source.id ? key : undefined} role={interactive ? "button" : undefined} tabIndex={interactive ? 0 : undefined} aria-hidden={!interactive || undefined} aria-label={interactive ? `${source.label}, ${source.kind}${source.levels ? `, ${source.levels} floor${source.levels === 1 ? "" : "s"}` : ""}` : undefined} aria-pressed={interactive ? selectedElementId === source.id || groupHighlights.has(source.id) : undefined} onKeyDown={interactive ? (event) => elementKeyDown(event, source) : undefined} pointerEvents={decorative ? "none" : undefined} className="campus-scene-object">
          {primary && <title>{source.label}</title>}<SceneAssetDrawing element={element} mode={mode} unit={unit} simple={simple} lighting={lighting} sunlight={effectiveSunlight} unavailable={unavailable.has(source.id)} />
          {!decorative && element.geometry.type === "point" && <circle cx={projectScenePoint(element.geometry.points[0]!, 0, mode).x} cy={projectScenePoint(element.geometry.points[0]!, 0, mode).y} r={Math.max(sceneElementWidth(element, unit) / 2, targetPixels / viewport.scale)} fill="transparent" />}
        </g>;
  })), [drawingParts, mode, unit, simple, lighting, effectiveSunlight, unavailable, selectedElementId, groupHighlights, elementKeyDown, viewport.scale, readOnlyView, interior]);
  const shadows = useMemo(() => mode === "2.5d" ? <g pointerEvents="none">{rendered.map(element => <SceneElementShadow key={element.id} element={element} unit={unit} sunlight={effectiveSunlight}/>)}</g> : null, [mode, rendered, unit, effectiveSunlight]);

  const ground = [{ x: 0, y: 0 }, { x: scene.bounds.width, y: 0 }, { x: scene.bounds.width, y: scene.bounds.height }, { x: 0, y: scene.bounds.height }];
  const groundPoints = scenePointsAttribute(ground.map((point) => projectScenePoint(point, 0, mode)));
  return <div ref={hostRef} className={`campus-scene-canvas ${className}`} data-mode={mode} data-lighting={lighting} data-interior={interior || undefined} data-interaction={interaction} data-dragging={dragging || undefined} data-testid="campus-scene-canvas">
    <p id={helpId} className="campus-scene-visually-hidden">{editing ? "Select an object to edit. Drag to move it, or use arrow keys when focused. Drag a corner to reshape. " : "Select a place for its details. "}Drag empty space to pan, pinch or use the zoom buttons. Press Home to fit the campus. Use the place list as an alternative to this scene. Lighting is illustrative and does not indicate presence or actual lights. People illustrate authorized plans, not tracked positions; scan rings are timestamped events.</p>
    <svg ref={svgRef} className="campus-scene-svg" viewBox={`0 0 ${size.width} ${size.height}`} role="group" aria-label={`${scene.name}, ${mode === "2d" ? "plan" : "campus perspective"}`} aria-describedby={helpId} tabIndex={0}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(event) => finishPointer(event)} onPointerCancel={(event) => finishPointer(event, true)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Home" || event.key === "0") { event.preventDefault(); fit(); }
        if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.3); }
        if (event.key === "-") { event.preventDefault(); zoom(1 / 1.3); }
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          setViewport((current) => clampSceneViewport({ ...current, x: current.x + (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0), y: current.y + (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0) }, size, bounds));
        }
      }}>
      {!interior && <defs><pattern id={grainId} width={unit * 12} height={unit * 12} patternUnits="userSpaceOnUse"><circle cx={unit * 2} cy={unit * 3} r={unit * .22} fill="#6f8b5b" opacity={.2} /><circle cx={unit * 8} cy={unit * 9} r={unit * .16} fill="#e4e9c8" opacity={.5} /><path d={`M ${unit * 6} ${unit * 2} l ${unit * .4} ${-unit * .7}`} stroke="#8b9e6d" strokeWidth={unit * .15} opacity={.4} /></pattern></defs>}
      <rect data-scene-surround x={0} y={0} width={size.width} height={size.height} fill={groundColor} />
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
        {!interior && mode === "2.5d" && <SceneSurroundings bounds={scene.bounds} unit={unit} lighting={lighting} sunlight={effectiveSunlight} mode={mode} id={grainId} approaches={approaches} visibleBounds={surroundingsBounds} />}
        <polygon data-scene-base={interior ? "interior" : "outdoor"} points={groundPoints} fill={groundColor} stroke="none" />
        {!interior && <rect x={-viewport.x / viewport.scale} y={-viewport.y / viewport.scale} width={size.width / viewport.scale} height={size.height / viewport.scale} fill={`url(#${grainId})`} opacity={night ? .22 : .7} pointerEvents="none" />}
        {interior && interiorOutline && interiorOutline.length >= 3 && <polygon data-interior-outline points={scenePointsAttribute(interiorOutline.map((point) => projectScenePoint(point, 0, mode)))} fill={night ? "#2c3740" : "var(--thatcampus-surface)"} stroke={night ? "#65717b" : "var(--thatcampus-border)"} strokeWidth={1.2} vectorEffect="non-scaling-stroke" pointerEvents="none"><title>Recorded building footprint</title></polygon>}
        {mode === "2d" && sourceImageUrl && <image href={sourceImageUrl} x={sourceImageBounds?.x ?? 0} y={sourceImageBounds?.y ?? 0} width={sourceImageBounds?.width ?? scene.bounds.width} height={sourceImageBounds?.height ?? scene.bounds.height} transform={sourceImageBounds && sourceImageRotationDeg ? `rotate(${sourceImageRotationDeg} ${sourceImageBounds.x + sourceImageBounds.width / 2} ${sourceImageBounds.y + sourceImageBounds.height / 2})` : undefined} preserveAspectRatio="xMidYMid meet" opacity={.72} pointerEvents="none"><title>Uploaded reference for tracing; object locations are reviewed separately.</title></image>}
        {groundAssets}
        <SceneWalkingRouteOverlay route={walkingRoute} mode={mode} floorId={floorId} scale={viewport.scale} />
        {shadows}
        {elevatedAssets}
        <SceneWalkingRouteOverlay route={walkingRoute} mode={mode} floorId={floorId} scale={viewport.scale} endpointsOnly />
        {rendered.filter(element => groupHighlights.has(element.id) && element.id !== highlighted?.id).map(element => <g key={`highlight-${element.id}`} data-scene-group-highlight={element.id} pointerEvents="none"><SceneElementOutline element={element} mode={mode} unit={unit} scale={viewport.scale}/></g>)}
        {highlighted && <g pointerEvents="none"><SceneElementOutline element={highlighted} mode={mode} unit={unit} scale={viewport.scale} /></g>}
        {selected && editing && onChangeVertex && selected.geometry.type !== "point" && <g data-scene-element={selected.id}>{selected.geometry.points.map((point, index) => <circle key={index} data-scene-vertex={index} cx={point.x} cy={point.y} r={7 / viewport.scale} fill="var(--thatcampus-surface)" stroke="var(--thatcampus-action)" strokeWidth={2 / viewport.scale} className="campus-scene-vertex"><title>Corner {index + 1}; coordinates can also be edited in the inspector.</title></circle>)}</g>}
        {draftPoints.length > 0 && <g pointerEvents="none">
          <polyline points={scenePointsAttribute(draftPoints.map((point) => projectScenePoint(point, 0, mode)))} fill={draftPoints.length > 2 ? "var(--thatcampus-brand-soft)" : "none"} fillOpacity={.35} stroke="var(--thatcampus-action)" strokeWidth={2 / viewport.scale} strokeDasharray={`${5 / viewport.scale} ${4 / viewport.scale}`} />
          {draftPoints.map((point, index) => { const projected = projectScenePoint(point, 0, mode); return <circle key={index} cx={projected.x} cy={projected.y} r={4 / viewport.scale} fill="var(--thatcampus-action)" />; })}
        </g>}
      </g>
      {people && peopleClock ? <foreignObject x={0} y={0} width={size.width} height={size.height} pointerEvents="none" aria-hidden="true"><ScenePeopleLayer scene={scene} mode={mode} floorId={floorId ?? null} unit={unit} viewport={viewport} size={size} lighting={lighting} sunlight={effectiveSunlight} data={people} clock={peopleClock}/></foreignObject> : null}
      <SceneEvidenceMarkers markers={markers} elements={rendered} mode={mode} unit={unit} viewport={viewport} size={size} selectedMarkerId={selectedMarkerId} onSelectMarker={onSelectMarker}/>
      {interior && mode === '2d' ? <SceneInteriorLabels elements={rendered} viewport={viewport} size={{...size,topInset,bottomInset}} unit={unit} selectedId={selectedElementId}/> : null}
      {interaction !== "draw" && <g className="campus-scene-labels">{labels.map(label => <g key={label.id} data-scene-label={label.id} data-selected={label.selected || undefined} className="campus-scene-floating-label" pointerEvents="none" aria-hidden="true">
        <title>{label.name}</title>
        <line x1={label.anchorX} y1={label.anchorY} x2={Math.max(label.x + 10, Math.min(label.x + label.width - 10, label.anchorX))} y2={label.anchorY >= label.y + label.height ? label.y + label.height : label.y} stroke={label.selected ? "var(--thatcampus-action)" : night ? "#9ba9b4" : "#4a6660"} strokeWidth={1.2} opacity={.62} pointerEvents="none" />
        <rect className="campus-scene-label-background" x={label.x} y={label.y} width={label.width} height={label.height} rx={8} fill={label.selected ? "var(--thatcampus-action)" : night ? "#1c252c" : "var(--thatcampus-surface)"} stroke={label.selected ? "var(--thatcampus-action)" : night ? "#51606a" : "#bac8bb"} strokeWidth={1} />
        <text textAnchor="middle" x={label.x + label.width / 2} fill={label.selected ? "var(--thatcampus-on-action)" : night ? "#edf0f2" : "var(--thatcampus-ink)"} fontSize={11.5} fontWeight={650}>{label.lines.map((line, index) => <tspan key={index} x={label.x + label.width / 2} y={label.y + 17 + index * 15}>{line}</tspan>)}</text>
      </g>)}</g>}
    </svg>
    <div className="campus-scene-map-controls" role="group" aria-label="Campus view controls">
      {routeFocus ? <button type="button" onClick={fitFocus} aria-label="Fit route" title="Fit route"><Route size={18} aria-hidden="true" /></button> : null}
      <button type="button" onClick={() => zoom(1.3)} aria-label="Zoom in"><Plus size={18} aria-hidden="true" /></button>
      <button type="button" onClick={() => zoom(1 / 1.3)} aria-label="Zoom out"><Minus size={18} aria-hidden="true" /></button>
      <button type="button" onClick={fit} aria-label="Fit campus" title="Fit campus"><LocateFixed size={17} aria-hidden="true" /></button>
    </div>
    <span className="campus-scene-perspective-label">{people ? "Planned activity" : interior ? "Floor plan" : mode === "2d" ? "Plan view" : "Architectural view"}</span>
  </div>;
}
