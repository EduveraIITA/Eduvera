import { useId } from "react";
import type { EventCatalogResponse } from "./types";

interface PlaceChoice { space_id: string | null; use_event_space: boolean }

/** Explicit canonical selection. Venue text never supplies an identity. */
export function EventPlacePicker({ catalog, spaceId, inherit = false, allowInheritance = false, label = "Event", onChange }: {
  catalog: EventCatalogResponse; spaceId?: string | null; inherit?: boolean; allowInheritance?: boolean;
  label?: string; onChange: (choice: PlaceChoice) => void;
}) {
  const id = useId(), places = catalog.places ?? [];
  const value = allowInheritance && inherit ? "inherit" : spaceId ?? "";
  const selected = places.find(place => place.id === spaceId);
  const description = value === "inherit" ? "Use event location" : selected?.name ?? (spaceId ? "Saved campus place" : "Not mapped");
  const campuses = [...new Map(places.map(place => [place.campus_id, place.campus_name])).entries()];
  return <details className="campus-event-map-location">
    <summary>Map location <span>{description}</span></summary>
    <label htmlFor={id}>Map location for {label}
      <select id={id} value={value} onChange={event => onChange({
        space_id: event.target.value && event.target.value !== "inherit" ? event.target.value : null,
        use_event_space: event.target.value === "inherit",
      })}>
        {allowInheritance ? <option value="inherit">Use event location</option> : null}
        <option value="">Not mapped / off campus</option>
        {spaceId && !selected ? <option value={spaceId}>Saved campus place</option> : null}
        {campuses.map(([campusId, name]) => <optgroup key={campusId} label={name}>
          {places.filter(place => place.campus_id === campusId).map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
        </optgroup>)}
      </select>
    </label>
    <p>Optional. Choose a campus place to show this activity on the map. A venue name alone does not place a marker.</p>
  </details>;
}
