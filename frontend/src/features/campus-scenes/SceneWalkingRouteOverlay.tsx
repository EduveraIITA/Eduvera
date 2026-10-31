import { projectScenePoint, scenePointsAttribute, type SceneViewMode } from "./sceneGeometry";
import type { SceneWalkingRoute } from "./sceneWalking";

export function SceneWalkingRouteOverlay({ route, mode, floorId = null, scale, endpointsOnly = false }: {
  route?: SceneWalkingRoute | null; mode: SceneViewMode; floorId?: string | null; scale: number; endpointsOnly?: boolean;
}) {
  if (route?.status !== "available") return null;
  const segments = route.segments.filter(segment => segment.floorId === floorId);
  if (!segments.length) return null;
  const first = route.segments[0]!, last = route.segments.at(-1)!;
  const start = first.floorId === floorId ? projectScenePoint(first.points[0]!, 0, mode) : null;
  const end = last.floorId === floorId ? projectScenePoint(last.points.at(-1)!, 0, mode) : null;
  if (endpointsOnly) return <g pointerEvents="none" aria-hidden="true" data-walking-route-endpoints>
    {(route.legs ?? []).filter(leg => leg.kind !== "walk" && (leg.fromFloorId === floorId || leg.toFloorId === floorId)).map((leg, index) => {
      if (leg.kind === "walk") return null;
      const point = projectScenePoint(leg.point, 0, mode);
      return <g key={`${leg.elementId}-${index}`} data-walking-route-connector={leg.elementId}><circle cx={point.x} cy={point.y} r={8 / scale} fill="var(--thatcampus-surface)" stroke="var(--thatcampus-action)" strokeWidth={2 / scale} /><path d={`M ${point.x - 3 / scale} ${point.y + 3 / scale} L ${point.x + 3 / scale} ${point.y - 3 / scale} M ${point.x - 3 / scale} ${point.y - 3 / scale} H ${point.x + 3 / scale} V ${point.y + 3 / scale}`} fill="none" stroke="var(--thatcampus-action)" strokeWidth={1.5 / scale} /><title>{leg.label}: reviewed {leg.kind} connection</title></g>;
    })}
    {start ? <circle data-walking-route-start cx={start.x} cy={start.y} r={5 / scale} fill="var(--thatcampus-surface)" stroke="var(--thatcampus-action)" strokeWidth={3 / scale}><title>Chosen starting place; this is not your tracked position.</title></circle> : null}
    {end ? <g data-walking-route-destination><circle cx={end.x} cy={end.y} r={7 / scale} fill="var(--thatcampus-action)" stroke="var(--thatcampus-surface)" strokeWidth={2.5 / scale} /><circle cx={end.x} cy={end.y} r={2 / scale} fill="var(--thatcampus-on-action)" /><title>Reviewed arrival point</title></g> : null}
  </g>;
  return <g pointerEvents="none" role="img" aria-label="Reviewed walking route" data-walking-route>
    <title>Follows reviewed walking paths. Starting point is chosen, not a tracked location.</title>
    {segments.map((segment, index) => {
      const points = scenePointsAttribute(segment.points.map(point => projectScenePoint(point, 0, mode)));
      return <g key={`${segment.elementId}-${index}`} data-walking-route-segment={segment.elementId}>
        <polyline points={points} fill="none" stroke="var(--thatcampus-surface)" strokeWidth={8 / scale} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={points} fill="none" stroke="var(--thatcampus-action)" strokeWidth={4 / scale} strokeLinecap="round" strokeLinejoin="round" />
      </g>;
    })}
  </g>;
}
