import { CalendarClock, CheckCircle2, ChevronRight, DoorOpen, Eye, Radio, Sparkles, UserRoundCheck, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { activeAssertion } from "./geometry";
import type { CampusAssertion, CampusViewSpace, CampusViewZoneOverlay } from "./types";

const stamp = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function AssertionRow({ assertion }: { assertion: CampusAssertion }) {
  const Icon = assertion.dimension === "accepted" ? CheckCircle2 : assertion.dimension === "observed" ? Radio : CalendarClock;
  const timing = assertion.observed_at || assertion.valid_from;
  const dimensionLabel = assertion.dimension === "accepted" ? "Accepted record" : assertion.dimension === "observed" ? "Observed point" : "Expected plan";
  const spatialLabel = assertion.spatial_claim === "bounded_space_presence"
    ? "Current room evidence"
    : assertion.spatial_claim === "point_observation_only"
      ? "Point evidence only"
      : assertion.spatial_claim === "expected_context_only" ? "Expected location only" : null;
  return <li className={`campus-space-sheet__assertion is-${assertion.dimension}`}>
    <span aria-hidden="true"><Icon size={17} /></span>
    <div><strong>{assertion.label}</strong>{assertion.detail ? <p>{assertion.detail}</p> : null}<small><b>{dimensionLabel}</b> · {assertion.source_label}{spatialLabel ? ` · ${spatialLabel}` : ""}{timing ? ` · ${stamp.format(new Date(timing))}` : ""}{assertion.freshness === "stale" || assertion.freshness === "historical" ? " · Historical" : ""}</small></div>
    {assertion.target_path ? <Link to={assertion.target_path} aria-label={`Open source for ${assertion.label}`}><ChevronRight size={18} /></Link> : null}
  </li>;
}

export function CampusSpaceSheet({ space, overlay, onClose }: { space: CampusViewSpace; overlay?: CampusViewZoneOverlay; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const assertion = activeAssertion(space);
  const expectedNow = space.expected_now[0];
  const gateToday = space.gate_activity_today;
  const assertions = useMemo(() => [
    ...space.assertions.accepted,
    ...space.assertions.observed,
    ...space.assertions.expected,
  ], [space.assertions]);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    title.current?.focus();
    const cancel = (event: Event) => { event.preventDefault(); onClose(); };
    node.addEventListener("cancel", cancel);
    return () => { node.removeEventListener("cancel", cancel); if (node.open) node.close(); };
  }, [onClose]);
  return <dialog ref={dialog} className="campus-space-sheet" aria-labelledby="campus-space-sheet-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="campus-space-sheet__panel">
      <span className="campus-space-sheet__handle" aria-hidden="true" />
      <header>
        <div><span>{space.floor_label} · {space.kind.replaceAll("_", " ")}</span><h2 id="campus-space-sheet-title" ref={title} tabIndex={-1}>{space.name}</h2><p>{overlay?.title || assertion?.label || "No current activity has been asserted for this space."}</p></div>
        <button type="button" onClick={onClose} aria-label="Close space details"><X size={20} /></button>
      </header>
      {overlay ? <section className="campus-space-sheet__context" aria-label={overlay.source_label}>
        <Sparkles size={18} aria-hidden="true" /><div><strong>{overlay.source_label}</strong><p>{overlay.source_detail}</p></div>
      </section> : null}
      {expectedNow ? <section className="campus-space-sheet__context" aria-label="Current timetable expectation">
        <UserRoundCheck size={18} aria-hidden="true" /><div><strong>{expectedNow.teacher ? `${expectedNow.teacher.label} is expected here` : "Teacher is not assigned"}</strong><p>{expectedNow.class_label} · {expectedNow.subject_label || expectedNow.title}. This comes from the published timetable; it does not prove physical presence.</p></div>
      </section> : null}
      {gateToday ? <section className="campus-space-sheet__context is-gate" aria-label="Today's accepted gate observations">
        <DoorOpen size={18} aria-hidden="true" /><div><strong>{gateToday.entries} in · {gateToday.exits} out today</strong><p>{gateToday.accepted_points} accepted point observations. These record boundary movements, not anyone's current location.</p></div>
      </section> : null}
      <section className="campus-space-sheet__why" aria-labelledby="campus-space-why-title">
        <div><Eye size={17} aria-hidden="true" /><h3 id="campus-space-why-title">Why this is shown</h3></div>
        {assertions.length ? <ul>{assertions.map((item) => <AssertionRow key={`${item.dimension}:${item.id}`} assertion={item} />)}</ul> : <p>{overlay?.explanation ?? "No schedule, device or accepted record currently places anyone in this space. ThatCampus leaves the state unknown."}</p>}
      </section>
      {overlay?.people.length ? <section className="campus-space-sheet__people" aria-labelledby="campus-space-people-title">
        <h3 id="campus-space-people-title">{overlay.people_heading ?? "People in this projection"}</h3>
        <ul>{overlay.people.slice(0, 8).map((person) => <li key={person.id}>{person.avatar_url ? <img src={person.avatar_url} alt="" /> : <span>{person.name.slice(0, 1)}</span>}<div><strong>{person.name}</strong><small>{person.descriptor}</small></div></li>)}</ul>
        {overlay.people.length > 8 ? <p>{overlay.people_more_label ?? `+ ${overlay.people.length - 8} more`}</p> : null}
      </section> : null}
      <footer><Link to="/principal/administration?section=campus">Edit campus setup <ChevronRight size={16} /></Link></footer>
    </div>
  </dialog>;
}
