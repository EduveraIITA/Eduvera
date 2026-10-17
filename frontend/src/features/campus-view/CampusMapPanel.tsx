import { AlertCircle, CalendarClock, ChevronRight, List, Radio, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { plannedHeadcount, roomCapacityPresentation, supportsSeatPattern } from "./roomOccupancy";
import type { CampusViewResponse, CampusViewSpace, CampusViewZoneOverlay } from "./types";

type ActivityItem = CampusViewResponse["activity"][number];
export type CampusMapPanelMode = "spaces" | "activity" | "timetable";

function ActivityGlyph({ dimension }: { dimension: ActivityItem["state_dimension"] }) {
  if (dimension === "observed" || dimension === "accepted") return <Radio size={17} />;
  if (dimension === "expected") return <CalendarClock size={17} />;
  return <AlertCircle size={17} />;
}

function activityEvidence(item: ActivityItem) {
  if (item.state === "in_progress") return "In progress · Expected plan";
  if (item.state === "upcoming") return "Later today · Expected plan";
  if (item.state === "ended") return "Earlier today · Expected plan";
  if (item.spatial_claim === "point_observation_only") return "Accepted point event";
  if (item.state_dimension === "accepted") return "Accepted record";
  if (item.state_dimension === "observed") return "Observed point";
  if (item.state_dimension === "expected") return "Expected plan";
  return "Recorded state needs review";
}

export function CampusMapPanel({ mode, spaces, zones, activity, formatTime, formatClock, returnFocus, onSelectSpace, onClose }: {
  mode: CampusMapPanelMode;
  spaces: CampusViewSpace[];
  zones: CampusViewZoneOverlay[];
  activity: ActivityItem[];
  formatTime: (date: Date) => string;
  formatClock: (date: Date) => string;
  returnFocus: HTMLElement | null;
  onSelectSpace: (space: CampusViewSpace) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    title.current?.focus();
    const cancel = (event: Event) => { event.preventDefault(); onClose(); };
    node.addEventListener("cancel", cancel);
    return () => {
      node.removeEventListener("cancel", cancel);
      if (node.open) node.close();
    };
  }, [onClose]);

  const close = () => {
    dialog.current?.close();
    onClose();
    window.setTimeout(() => returnFocus?.focus(), 0);
  };

  const select = (space: CampusViewSpace) => {
    dialog.current?.close();
    onSelectSpace(space);
  };
  const visibleActivity = activity.slice(0, 30);
  const timetable = activity.filter((item) => item.spatial_claim === "expected_context_only"
    && (item.state === "in_progress" || item.state === "upcoming" || item.state === "ended"));
  const eyebrow = mode === "spaces" ? "Accessible map directory" : mode === "timetable" ? "Published schedule" : "Current snapshot";
  const heading = mode === "spaces" ? "Campus spaces" : mode === "timetable" ? "Today's timetable" : "Recent activity";
  const closeLabel = mode === "spaces" ? "campus spaces" : mode === "timetable" ? "today's timetable" : "recent activity";

  return <dialog ref={dialog} className="campus-map-panel" aria-labelledby="campus-map-panel-title" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="campus-map-panel__surface">
      <span className="campus-map-panel__handle" aria-hidden="true" />
      <header>
        <div><span>{eyebrow}</span><h2 id="campus-map-panel-title" ref={title} tabIndex={-1}>{heading}</h2></div>
        <button type="button" onClick={close} aria-label={`Close ${closeLabel}`}><X size={20} /></button>
      </header>
      {mode === "spaces" ? <>
        <p className="campus-map-panel__intro">Choose a space to inspect its expected, observed and accepted evidence. This list is the keyboard-accessible equivalent of the map.</p>
        <ul className="campus-map-panel__list">{spaces.map((space) => {
          const zone = zones.find((item) => item.space_id === space.id);
          const expectedNow = space.expected_now[0];
          const gateToday = space.gate_activity_today;
          const detail = gateToday ? `${gateToday.entries} in · ${gateToday.exits} out today`
            : zone?.title || expectedNow?.subject_label || expectedNow?.title || space.assertions.accepted[0]?.label || space.assertions.observed[0]?.label || space.assertions.expected[0]?.label || "No current assertion";
          const plannedCount = plannedHeadcount([expectedNow?.expected_count, ...space.assertions.expected.map((item) => item.count)], zone?.count);
          const seating = supportsSeatPattern(space.kind)
            ? roomCapacityPresentation(space.id, space.capacity, plannedCount)
            : null;
          const evidence = expectedNow?.teacher ? `Expected: ${expectedNow.teacher.label}`
            : gateToday ? `${gateToday.accepted_points} accepted points`
              : seating?.compactLabel || zone?.marker_label || (space.signal_count ? `${space.signal_count} to review` : space.state_dimension);
          return <li key={space.id}><button type="button" onClick={() => select(space)}><span><strong>{space.name}</strong><small>{detail}</small>{seating ? <><small>{seating.compactLabel}</small><span className="campus-map-sr-only">{seating.accessibleSummary}</span></> : null}</span><em>{evidence}</em><ChevronRight size={18} /></button></li>;
        })}</ul>
      </> : mode === "timetable" ? timetable.length ? <>
        <p className="campus-map-panel__intro">Current lessons appear first, followed by upcoming and earlier periods. Timetable entries are expectations, not proof of physical presence.</p>
        <ol className="campus-map-panel__timetable">{timetable.map((item) => <li key={item.id} className={`is-${item.state}`}>
          <time dateTime={item.occurred_at}><strong>{formatClock(new Date(item.occurred_at))}</strong>{item.ends_at ? <small>to {formatClock(new Date(item.ends_at))}</small> : null}</time>
          <div><span>{item.state === "in_progress" ? "Now" : item.state === "upcoming" ? "Later" : "Earlier"}</span><strong>{item.title}</strong><p>{item.detail}</p></div>
          {item.target_path ? <Link to={item.target_path} aria-label={`Open ${item.title} in timetable`}><ChevronRight size={18} /></Link> : null}
        </li>)}</ol>
      </> : <div className="campus-map-panel__empty"><CalendarClock size={23} /><strong>No timetable entries today</strong><p>Published classes and scheduled campus activities will appear here.</p></div>
      : activity.length ? <>
        <p className="campus-map-panel__intro">Showing {visibleActivity.length} of {activity.length} current and recent activity records.</p>
        <ol className="campus-map-panel__activity">{visibleActivity.map((item) => <li key={item.id} className={`is-${item.state_dimension}`}>
          <span aria-hidden="true"><ActivityGlyph dimension={item.state_dimension} /></span>
          <div><strong>{item.title}</strong><p>{item.detail}</p><small>{activityEvidence(item)} · {item.source_label} · {formatTime(new Date(item.occurred_at))}</small></div>
          {item.target_path ? <Link to={item.target_path} aria-label={`Open ${item.title}`}><ChevronRight size={18} /></Link> : null}
        </li>)}</ol>
      </> : <div className="campus-map-panel__empty"><List size={23} /><strong>No recorded activity yet</strong><p>Silence is not treated as absence. Source-backed campus events will appear here.</p></div>}
    </div>
  </dialog>;
}
