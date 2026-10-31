import type { SceneWalkingLeg, SceneWalkingRoute } from "./sceneWalking";

export function SceneRouteSteps({ route, places, currentFloorId, onSelectFloor }: { route: SceneWalkingRoute | null | undefined; places: Array<{ id: string; name: string }>; currentFloorId: string | null; onSelectFloor: (floorId: string | null) => void }) {
  if (route?.status !== "available") return null;
  const floorName = (id: string | null) => id === null ? "Outdoors" : places.find(place => place.id === id)?.name ?? "Recorded floor";
  const legs: SceneWalkingLeg[] = route.legs ?? route.segments.map(segment => ({ ...segment, kind: "walk" }));
  const stages = legs.filter((leg, index) => { const previous = legs[index - 1]; return leg.kind !== "walk" || previous?.kind !== "walk" || previous.floorId !== leg.floorId; });
  return <details className="campus-scene-route-steps"><summary>Route steps{route.transitionCount ? ` · ${route.transitionCount} connections` : ""}</summary><ol>
    {stages.slice(0, 32).map((leg, index) => {
      const floor = leg.kind === "walk" ? leg.floorId : leg.toFloorId;
      return <li key={`${leg.elementId}-${index}`}><div><strong>{leg.kind === "walk" ? `Follow the path · ${floorName(floor)}` : leg.kind === "entrance" ? `${leg.toFloorId === null ? "Exit" : "Enter"} · ${leg.label}` : `${leg.kind === "lift" ? "Take the lift" : "Use the stairs"} · ${leg.label}`}</strong>{leg.kind !== "walk" ? <p>{floorName(leg.fromFloorId)} → {floorName(leg.toFloorId)}</p> : null}</div><button type="button" className="campus-scene-button" aria-pressed={currentFloorId === floor} onClick={() => onSelectFloor(floor)}>Show {floorName(floor)}</button></li>;
    })}
  </ol>{stages.length > 32 ? <p>Showing the first 32 route parts. Ask the campus team for help with this unusually complex route.</p> : null}<p>Uses the fewest reviewed connections, then the shortest drawn walk. Connection distance and travel time are not estimated.</p></details>;
}
