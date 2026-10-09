import { useRef, useState } from "react";
import type { CollectorTrip, Rider } from "./api";
import { riderStops, stopFocus } from "./stopFocus";
import { RiderFocusControls } from "./RiderFocusControls";

export const riderLabel = (state: string, inbound = false) => ({ expected: "Expected", boarded: "On board", dropped: inbound ? "Arrived at school" : "Handed over", not_riding: "Not riding", exception: "Needs help" }[state] ?? state);
export function JourneyRoster({ trip, pending, onRecord }: { trip: CollectorTrip; pending: boolean; onRecord: (rider: Rider, state: string, note: string) => Promise<void> }) {
  const [editing, setEditing] = useState<{ id: string; state: string; stopId?: string } | null>(null);
  const [view, setView] = useState<"all" | "nearby">("all");
  const [selectedStop, setSelectedStop] = useState("auto");
  const [savingStop, setSavingStop] = useState<string>();
  const [note, setNote] = useState("");
  const saving = useRef(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; message: string; failed: boolean } | null>(null);
  const busy = pending || savingId !== null;
  const open = ["boarding", "in_progress"].includes(trip.state) && trip.collector_assignment_status === "accepted";
  const inbound = trip.direction === "to_institution";
  const groups = riderStops(trip);
  const autoFocus = stopFocus(trip, groups);
  const focusId = editing?.stopId ?? savingStop ?? selectedStop;
  const manualGroup = groups.find(group => group.stop.id === focusId);
  const focusedGroup = manualGroup ?? autoFocus.group;
  const shown = view === "all" ? trip.roster : trip.roster.filter(rider => focusedGroup?.riders.some(r => r.student_id === rider.student_id) || rider.student_id === savingId || rider.student_id === editing?.id);
  const record = async (rider: Rider, state: string, evidence = "") => {
    if (saving.current || pending) return;
    saving.current = true; setSavingId(rider.student_id); setSavingStop(focusedGroup?.stop.id); setFeedback(null);
    try {
      await onRecord(rider, state, evidence);
      setEditing(null);
      setFeedback({ id: rider.student_id, message: `${rider.student_name}: ${riderLabel(state, inbound).toLowerCase()} recorded.`, failed: false });
    } catch (error) {
      setFeedback({ id: rider.student_id, message: error instanceof Error ? error.message : "Could not save. Try again.", failed: true });
    } finally { saving.current = false; setSavingId(null); setSavingStop(undefined); }
  };
  const choose = (rider: Rider, state: string) => {
    if (saving.current || pending) return;
    if (state === "exception" || rider.state === "exception") { setEditing({ id: rider.student_id, state, stopId: focusedGroup?.stop.id }); setNote(""); setFeedback(null); }
    else void record(rider, state);
  };
  return <section className="departure-panel"><header><h2>Riders</h2><span>{trip.roster.filter(r => ["dropped", "not_riding"].includes(r.state)).length}/{trip.roster.length} resolved</span></header>
    {!["completed", "cancelled"].includes(trip.state) ? <RiderFocusControls mode={view} setMode={setView} total={trip.roster.length} groups={groups} group={focusedGroup} selected={selectedStop} select={setSelectedStop} message={manualGroup ? "Selected stop · Confirm each learner yourself." : autoFocus.message} distance={manualGroup ? null : autoFocus.distance} nearby={!manualGroup && autoFocus.nearby} disabled={busy || editing !== null}/> : null}
    {view === "nearby" && trip.roster.some(r => r.state === "exception" && !shown.includes(r)) ? <p className="departure-warning">There are concerns at other stops. <button type="button" onClick={() => setView("all")} disabled={busy || editing !== null}>Review all riders</button></p> : null}
    {view === "nearby" && feedback && !shown.some(r => r.student_id === feedback.id) ? <p className="departure-privacy-note" role={feedback.failed ? "alert" : "status"}>{feedback.message}</p> : null}
    {!open ? <p className="departure-privacy-note">{trip.state === "planned" ? "Review the roster now. Rider recording opens with boarding." : "This journey is closed. Its recorded outcomes are read-only."}</p> : null}
    <div className="departure-rider-list">{shown.map(rider => <article key={rider.student_id}>
      <div className="departure-rider-stop"><span>{rider.stop_sequence}</span><div><strong>{rider.student_name}</strong><small>{rider.stop_name}{rider.planned_time ? ` · ${rider.planned_time.slice(0, 5)}` : ""}</small></div></div>
      <span className={`departure-state departure-state--${rider.state}`}>{riderLabel(rider.state, inbound)}</span>
      {rider.outcome_note && rider.state !== "expected" ? rider.state === "exception" ? <p className="departure-rider-note">{rider.outcome_note}</p> : <details className="departure-rider-note"><summary>Note</summary><p>{rider.outcome_note}</p></details> : null}
      {open && editing?.id !== rider.student_id ? <div className="departure-rider-actions">
        {rider.state === "expected" ? <><button disabled={busy} onClick={() => choose(rider, "not_riding")}>Not riding</button><button disabled={busy} className="departure-primary" onClick={() => choose(rider, "boarded")}>Board</button></> : null}
        {rider.state === "boarded" ? <><button disabled={busy} onClick={() => choose(rider, "exception")}>Report concern</button>{trip.state === "in_progress" ? <button disabled={busy} className="departure-primary" onClick={() => choose(rider, "dropped")}>{inbound ? "Confirm arrival" : "Confirm handover"}</button> : null}</> : null}
        {rider.state === "exception" ? <><button disabled={busy} onClick={() => choose(rider, rider.boarded_at ? "boarded" : "not_riding")}>{rider.boarded_at ? "Still on board" : "Not riding"}</button>{rider.boarded_at && trip.state === "in_progress" ? <button disabled={busy} onClick={() => choose(rider, "dropped")}>{inbound ? "Resolve & confirm arrival" : "Resolve & confirm handover"}</button> : !rider.boarded_at ? <button disabled={busy} onClick={() => choose(rider, "boarded")}>Confirm boarding</button> : null}</> : null}
      </div> : null}
      {open && editing?.id === rider.student_id ? <form className="departure-rider-confirm" onSubmit={async event => {
        event.preventDefault(); if (note.trim().length >= 3) await record(rider, editing.state, note.trim());
      }}>
        <label>{editing.state === "exception" ? "What needs attention?" : "How was the concern resolved?"}
          <textarea required disabled={busy} minLength={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} rows={2} autoFocus /></label>
        <div><button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button disabled={busy || note.trim().length < 3} className="departure-primary">{busy ? "Saving…" : `Confirm ${riderLabel(editing.state, inbound).toLowerCase()}`}</button></div>
      </form> : null}
      {savingId === rider.student_id ? <p className="departure-rider-note" role="status">Saving…</p> : null}
      {feedback?.id === rider.student_id ? <p className={feedback.failed ? "departure-rider-note departure-error" : "departure-rider-note"} role={feedback.failed ? "alert" : "status"}>{feedback.message}</p> : null}
    </article>)}</div>
  </section>;
}
