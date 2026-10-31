import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, MapPin, Route } from "lucide-react";
import type { CampusSceneSpace } from "../campus-scenes/types";
import type { SceneWalkingRoute } from "../campus-scenes/sceneWalking";
import type { CampusPersonalDestination } from "./personalJourney.types";

const explanations: Record<string, string> = {
  network_unavailable: "Walking paths have not been published yet. Your campus team can connect gates and entrances in the layout editor.",
  origin_unmapped: "This start has no reviewed walking connection. Choose another start.",
  destination_unmapped: "This destination does not have a reviewed entrance connection yet.",
  no_path: "No connected open path matches these choices. Try another start or ask your campus team.",
  same_place: "Your chosen start is already at this entrance.",
};
export function CampusPersonalDirections({ item, origins, originId, onOrigin, accessibleOnly, onAccessible, route, destination, trail, onShowRoom, stale, placeMapped }: {
  item: CampusPersonalDestination; origins: Array<Omit<CampusSceneSpace, "campus_id">>; originId: string;
  onOrigin: (id: string) => void; accessibleOnly: boolean; onAccessible: (value: boolean) => void;
  route: SceneWalkingRoute | null; destination: Omit<CampusSceneSpace, "campus_id"> | null;
  trail: Array<Omit<CampusSceneSpace, "campus_id">>; onShowRoom: () => void; stale: boolean; placeMapped: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = useRef<HTMLDivElement>(null), focusAfterChoice = useRef(false), focusedOptions = useRef(false);
  const available = route?.status === "available" && Boolean(destination) && !stale;
  const optionsOpen = !available || expanded;
  const origin = origins.find(place => place.id === originId);
  const floor = [...trail].reverse().find(place => place.kind === "floor");
  useLayoutEffect(() => {
    if ((focusAfterChoice.current || focusedOptions.current) && available && !optionsOpen) { status.current?.focus({ preventScroll: true }); focusedOptions.current = false; }
    focusAfterChoice.current = false;
  }, [available, optionsOpen, originId]);
  const arrival = <><MapPin size={17} aria-hidden="true" /><span><strong>{item.place_label ?? "Your destination"}</strong><small>{[floor?.name, destination?.id !== item.space_id ? "Indoor route not mapped" : null].filter(Boolean).join(" · ")}</small></span>{placeMapped ? <ChevronRight size={17} aria-hidden="true" /> : null}</>;
  return <section id="campus-personal-directions" className="campus-personal-directions" aria-label="Walking directions">
    {available && route.status === "available" && destination ? <div className="campus-personal-route-result" role="status" tabIndex={-1} ref={status} aria-label="Walking route ready"><strong>{route.transitionCount ? "Walk" : "Outdoor walk"} to {destination.name}</strong><p>{route.unit === "metres" ? `${Math.round(route.length)} m along the published paths` : "Illustrative path · distance is not surveyed"}{route.transitionCount ? ` · ${route.transitionCount} reviewed connections` : ""}</p></div> : stale ? <p className="campus-personal-route-notice" role="status">Your activity or its place changed. Choose a starting place again to refresh directions.</p> : route?.status === "unavailable" ? <p className="campus-personal-route-notice" role="status">{explanations[route.reason] ?? explanations.no_path}</p> : originId && !destination ? <p role="status">{explanations.destination_unmapped}</p> : null}
    {available ? <button type="button" className="campus-personal-route-options-toggle" aria-expanded={optionsOpen} aria-controls="campus-personal-route-options" onClick={() => setExpanded(value => !value)}><span><strong>Route options</strong><small>From {origin?.name ?? "your chosen start"}{accessibleOnly ? " · Step-free" : ""}</small></span><ChevronDown size={17} aria-hidden="true" /></button> : <h3><Route size={18} aria-hidden="true" />Walking directions</h3>}
    {optionsOpen ? <div id="campus-personal-route-options" className="campus-personal-route-options" onFocusCapture={() => { focusedOptions.current = true; }} onBlurCapture={event => { focusedOptions.current = event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget); }}>
      {origins.length ? <><label>Start from<select value={originId} onChange={event => { focusAfterChoice.current = Boolean(event.target.value); setExpanded(false); onOrigin(event.target.value); }}><option value="">Choose a gate or place</option>{origins.map(place => <option value={place.id} key={place.id}>{place.name}</option>)}</select></label><label className="campus-personal-check"><input type="checkbox" checked={accessibleOnly} onChange={event => onAccessible(event.target.checked)} /><span>Step-free paths only</span></label><p>Choose a start; your location is not tracked.</p></> : <p role="status">{explanations.network_unavailable}</p>}
    </div> : null}
    {item.space_id ? placeMapped ? <button type="button" className="campus-personal-arrival" aria-label="Show destination details" onClick={onShowRoom}>{arrival}</button> : <div className="campus-personal-arrival">{arrival}</div> : null}
  </section>;
}
