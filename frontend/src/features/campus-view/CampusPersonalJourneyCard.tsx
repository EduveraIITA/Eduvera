import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, Clock3, MapPin, Route, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { portalReturnState } from "../navigation/portalReturnState";
import { sessionActionHref } from "../teaching-sessions/api";
import { personalJourneyTime } from "./personalJourney";
import type { CampusPersonalDestination, CampusPersonalResponse } from "./personalJourney.types";

export function CampusJourneySourceLink({ item }: { item: CampusPersonalDestination }) {
  const location = useLocation(), href = sessionActionHref(item.target_path);
  return href ? <Link className="campus-scene-button campus-scene-button--primary" to={href} state={portalReturnState(`${location.pathname}${location.search}`, href)}>{item.action_label}<ArrowUpRight size={16} aria-hidden="true" /></Link> : null;
}

export function CampusPersonalJourneyCard({ data, items, selected, onChoose, onLocate, onDirections, directionsOpen, onRefresh, refreshing, placeMapped, children }: {
  data: CampusPersonalResponse; items: CampusPersonalDestination[]; selected: CampusPersonalDestination | undefined;
  onChoose: (id: string) => void; onLocate: () => void; onDirections: () => void; directionsOpen: boolean;
  onRefresh: () => void; refreshing: boolean; placeMapped: boolean; children?: ReactNode;
}) {
  const title = useRef<HTMLHeadingElement>(null), choices = useRef<HTMLDetailsElement>(null), focusAfterChoice = useRef(false);
  useLayoutEffect(() => {
    if (focusAfterChoice.current) title.current?.focus({ preventScroll: true });
    focusAfterChoice.current = false;
  }, [selected?.id]);
  const status = selected?.state === "in_progress" ? "Scheduled now" : selected?.state === "upcoming" ? "Coming up" : "Assigned to you";
  return <section className="campus-personal" aria-label="Your campus day">
    <header className="campus-personal-heading"><span className="campus-scene-eyebrow">{selected ? status : "Your campus day"}</span><button type="button" className="campus-personal-refresh" onClick={onRefresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></header>
    {selected ? <>
      <div className="campus-personal-focus"><h2 ref={title} tabIndex={-1}>{selected.title}</h2>{placeMapped ? <button type="button" className="campus-scene-icon-button" aria-label="Show place" title="Show place" onClick={onLocate}><MapPin size={20} aria-hidden="true" /></button> : null}</div>
      <p className="campus-personal-time"><Clock3 size={15} aria-hidden="true" /><span>{personalJourneyTime(selected, data.timezone, data.local_date)} · {selected.place_label ?? "Place not assigned yet"}</span></p>
      <div className="campus-personal-actions"><CampusJourneySourceLink item={selected} />{selected.space_id || directionsOpen ? <button type="button" className="campus-scene-button" aria-expanded={directionsOpen} aria-controls="campus-personal-directions" onClick={onDirections}>{directionsOpen ? <X size={16} aria-hidden="true" /> : <Route size={16} aria-hidden="true" />}{directionsOpen ? "Close directions" : "Directions"}</button> : null}</div>
      {selected.space_id && !placeMapped ? <p className="campus-personal-place">The assigned place is not mapped in this layout yet.</p> : null}
      {children}
    </> : <div className="campus-personal-empty"><h2>Your campus is yours to explore</h2><p>No current or upcoming place-linked activity is assigned to you. Select a building to explore its published places.</p></div>}
    <details ref={choices} className="campus-personal-provenance"><summary>{items.length > 1 ? `Your day · ${items.length} activities` : "About this view"}</summary>{items.length > 1 && selected ? <label className="campus-personal-choice">More on your campus<select aria-label="Your places and activities" value={selected.id} onChange={event => { focusAfterChoice.current = true; if (choices.current) choices.current.open = false; onChoose(event.target.value); }}>{items.map(item => <option key={item.id} value={item.id}>{item.title} · {item.place_label ?? "Place not assigned"}</option>)}</select></label> : null}<p>Only your authorised activities and responsibilities are shown. A scheduled place is an expectation, not your current location.</p>{directionsOpen ? <p>Walking directions cover the published outdoor paths. Follow the highlighted path and check campus signs and current conditions. Step-free uses the campus team's settings; accessibility is not independently verified. Choosing a start does not record your location.</p> : null}{data.limitations.map((text, index) => <p key={index}>{text}</p>)}</details>
  </section>;
}
