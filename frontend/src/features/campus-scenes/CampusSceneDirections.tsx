import { SceneRouteSteps } from "./SceneRouteSteps";
import type { SceneWalkingRoute } from "./sceneWalking";

export function CampusSceneDirections({ destinationName, exact, arrivalName, origins, originId, accessibleOnly, onOrigin, onAccessible, route, places, currentFloorId, onSelectFloor }: {
  destinationName: string; exact: boolean; arrivalName?: string; origins: Array<{ id: string; name: string }>; originId: string; accessibleOnly: boolean;
  onOrigin: (id: string) => void; onAccessible: (value: boolean) => void; route: SceneWalkingRoute | null;
  places: Array<{ id: string; name: string }>; currentFloorId: string | null; onSelectFloor: (id: string | null) => void;
}) {
  return <section className="campus-scene-directions" aria-label="Place directions">
    <label>Starting place<select value={originId} onChange={event => onOrigin(event.target.value)}><option value="">Choose an entrance or place</option>{origins.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label>
    <label className="campus-scene-check"><input type="checkbox" checked={accessibleOnly} onChange={event => onAccessible(event.target.checked)} />Step-free route only</label>
    {!exact && arrivalName ? <p>The indoor route to {destinationName} is not mapped. Only the outdoor portion{arrivalName ? ` to ${arrivalName}` : ""} can be shown.</p> : null}
    {!exact && !arrivalName ? <p role="status">There is no reviewed connected arrival for {destinationName} yet. Ask the campus team for directions; no route can be drawn from the available map.</p> : null}
    {route?.status === "unavailable" ? <p role="status">{route.reason === "same_place" ? "The chosen start is already at this arrival point." : "No connected reviewed open route matches these choices. Choose another start or ask the campus team."}</p> : route?.status === "available" ? <p role="status">{route.unit === "metres" ? `Approximately ${Math.round(route.length)} m of drawn walking paths` : "Illustrative path; distance is not surveyed"}. Lift and stair distance is excluded. Check signs and current conditions on campus.</p> : null}
    <p className="campus-scene-directions__privacy">Your start is a choice, not a location report or permission to enter.</p>
    <SceneRouteSteps route={route} places={places} currentFloorId={currentFloorId} onSelectFloor={onSelectFloor} />
  </section>;
}
