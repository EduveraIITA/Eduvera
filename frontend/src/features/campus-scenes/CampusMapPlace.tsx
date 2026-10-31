import type { ReactNode } from "react";
import { MapPin, Navigation } from "lucide-react";
import type { CampusSceneElement } from "./types";
import type { CampusScenePublished } from "./api";

export function CampusMapPlace({ selected, place, onInspect, inspectionState = "available", onDirections, children }: {
  selected: CampusSceneElement; place?: CampusScenePublished["places"][number];
  onInspect?: () => void; inspectionState?: "loading" | "available" | "unavailable"; onDirections: () => void; children: ReactNode;
}) {
  return <section className="campus-map-place" aria-label={`${selected.label} details`}>
    {place ? place.name !== selected.label ? <p>{place.name}</p> : null : <p className="campus-scene-helper">A feature of the published campus layout.</p>}
    {place ? <div className="campus-map-place__actions"><button type="button" className="campus-scene-button campus-scene-button--primary" onClick={onDirections}><Navigation size={17} />Directions to this place</button>{onInspect ? <button type="button" className="campus-scene-button" disabled={inspectionState !== "available"} onClick={onInspect}><MapPin size={17} />View recorded activity</button> : null}</div> : null}
    {onInspect && inspectionState !== "available" ? <p role="status">{inspectionState === "loading" ? "Loading recorded activity…" : "Recorded activity for this place is unavailable in the current snapshot."}</p> : null}
    {children}
  </section>;
}
