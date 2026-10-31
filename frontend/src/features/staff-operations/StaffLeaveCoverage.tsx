import { Check, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { assignCoverage, type AdminStaffWorkspace, type CoverageTask } from "./api";
import "./staff-leave-coverage.css";

interface CoverageBoardProps {
  schoolId: string;
  data: AdminStaffWorkspace;
  refresh: () => Promise<void>;
  focusCoverageId?: string | null;
  leaveRequestId?: string;
  embedded?: boolean;
}

const needsOffer = (task: CoverageTask) => ["open", "declined"].includes(task.status);
const isCurrent = (task: CoverageTask) => needsOffer(task) || task.status === "offered";
const personName = (first: string | null, last: string | null) => `${first ?? ""} ${last ?? ""}`.trim();
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(`${value}T12:00:00Z`));
const statusLabel: Record<CoverageTask["status"], string> = {
  open: "Needs cover", offered: "Awaiting reply", accepted: "Cover accepted",
  declined: "Offer declined", completed: "Completed", cancelled: "Cancelled",
  fallback_applied: "Fallback applied", expired_unconfirmed: "Unconfirmed",
};

/** The same native cover records, either in one leave request or the campus board. */
export function CoverageBoard(props: CoverageBoardProps) {
  const environment = useOptionalExecutionEnvironment();
  const scope = `${props.schoolId}:${environment?.namespaceId ?? "live"}:${props.leaveRequestId ?? "all"}`;
  return <ScopedCoverageBoard key={scope} {...props} />;
}

function ScopedCoverageBoard({ schoolId, data, refresh, focusCoverageId, leaveRequestId, embedded = false }: CoverageBoardProps) {
  const tasks = embedded || leaveRequestId
    ? data.coverage_tasks.filter(task => Boolean(leaveRequestId) && task.leave_request_id === leaveRequestId)
    : data.coverage_tasks;
  const focused = tasks.find(task => task.id === focusCoverageId);
  const current = tasks.filter(isCurrent);
  const resolved = tasks.filter(task => !isCurrent(task));
  const visible = embedded ? tasks : focused && !isCurrent(focused) ? [focused, ...current] : current;
  const history = resolved.filter(task => task.id !== focusCoverageId);
  const needsCover = tasks.filter(needsOffer).length;
  const awaitingReply = tasks.filter(task => task.status === "offered").length;
  const rows = (items: CoverageTask[]) => items.map(task => <CoverageRow
    key={`${task.id}:${task.revision}`} task={task} schoolId={schoolId} profiles={data.profiles}
    refresh={refresh} focused={task.id === focusCoverageId} embedded={embedded}
  />);
  return <section className={`staff-panel staff-cover-board staff-leave-cover${embedded ? " staff-leave-cover--embedded" : ""}`}>
    <header>
      {embedded ? <h3>Cover for this leave</h3> : <h2>Leave coverage</h2>}
      <span className="staff-leave-cover__counts">{needsCover} need cover{awaitingReply ? ` · ${awaitingReply} awaiting reply` : ""}</span>
    </header>
    {embedded && !leaveRequestId || focusCoverageId && !focused ? <p className="staff-leave-cover__feedback" role="alert">
      Cover duty unavailable. This item is not part of the current leave or campus.
    </p> : null}
    <div className="staff-cover-list staff-leave-cover__list">
      {rows(visible)}
      {!visible.length ? <p className="staff-empty staff-empty--compact"><Check size={18} aria-hidden="true" />
        {embedded ? "No cover activities recorded for this leave." : "No uncovered classes or shifts."}
      </p> : null}
    </div>
    {!embedded && history.length ? <details className="staff-history">
      <summary>Coverage history <span>{history.length}</span></summary>
      <div className="staff-cover-list staff-leave-cover__list">{rows(history)}</div>
    </details> : null}
  </section>;
}

function CoverageRow({ task, schoolId, profiles, refresh, focused, embedded }: {
  task: CoverageTask; schoolId: string; profiles: AdminStaffWorkspace["profiles"];
  refresh: () => Promise<void>; focused: boolean; embedded: boolean;
}) {
  const [selection, setSelection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<"saved" | "unknown" | "stale" | null>(null);
  const inFlight = useRef(false);
  const candidates = profiles.filter(profile => profile.status === "active" && profile.user_id && profile.id !== task.absent_staff_profile_id);
  const replacement = personName(task.replacement_first_name, task.replacement_last_name);
  async function refreshStatus() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try { await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not refresh cover status."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function offer() {
    if (inFlight.current || recovery || !needsOffer(task) || !candidates.some(profile => profile.id === selection)) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await assignCoverage(schoolId, task.id, {
        replacement_staff_profile_id: selection,
        note: "Cover offered by school office.",
        expected_revision: task.revision,
      });
      // Never re-offer from a stale row if the command succeeded but the read failed.
      setRecovery("saved");
      try { await refresh(); }
      catch { setError("The offer was saved, but the latest status could not be loaded."); }
    } catch (cause) {
      const definitive = cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && ![408, 425, 429].includes(cause.status);
      if (!definitive) setRecovery("unknown");
      else if (cause.status === 409) setRecovery("stale");
      setError(cause instanceof Error ? cause.message : "Could not send the cover offer.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <article id={`attention-${task.id}`} tabIndex={-1} className={`staff-leave-cover__row${focused ? " attention-focus" : ""}`} aria-busy={busy}>
    <span className={`staff-duty-icon staff-duty-icon--${task.status}`}><RotateCcw size={18} aria-hidden="true" /></span>
    <div className="staff-leave-cover__work">
      <strong>{task.title}</strong>
      <small>{dateLabel(task.duty_date)} · {task.starts_at && task.ends_at ? `${task.starts_at.slice(0, 5)}–${task.ends_at.slice(0, 5)}` : "All day"}{task.class_name ? ` · ${task.class_name}` : ""}</small>
      {task.location ? <small>{task.location}</small> : null}
      {!embedded ? <p>{personName(task.absent_first_name, task.absent_last_name)} is away</p> : null}
      {task.handover_note ? <p>{task.handover_note}</p> : null}
      {task.response_note ? <p>Reply: {task.response_note}</p> : null}
    </div>
    <div className="staff-leave-cover__action">
      <span className={`staff-status staff-status--${task.status}`}>{statusLabel[task.status]}</span>
      {replacement ? <span className="staff-leave-cover__person">{task.status === "offered" ? "Offered to " : "Replacement: "}{replacement}</span> : null}
      {task.fallback_label ? <span className="staff-leave-cover__person">{task.fallback_label}</span> : null}
      {needsOffer(task) && !recovery ? <>
        <label><span className="sr-only">Cover teacher for {task.title}</span>
          <select value={selection} disabled={busy} onChange={event => { setSelection(event.target.value); setError(""); }}>
            <option value="">Choose colleague</option>
            {candidates.map(profile => <option key={profile.id} value={profile.id}>{personName(profile.first_name, profile.last_name)}{profile.designation ? ` · ${profile.designation}` : ""}</option>)}
          </select>
        </label>
        <button type="button" className="staff-primary" disabled={busy || !candidates.some(profile => profile.id === selection)} onClick={() => void offer()}>{busy ? "Sending…" : "Offer cover"}</button>
        {!candidates.length ? <small>No active colleague with app access is available in this list.</small> : null}
      </> : null}
      {recovery ? <div className="staff-leave-cover__recovery" role="status">
        <p>{recovery === "saved" ? "Offer saved. Refresh to see the latest status." : recovery === "stale" ? "This activity changed. Refresh before offering cover." : "The offer result is unconfirmed. Check the latest status before continuing."}</p>
        <button type="button" className="staff-secondary" disabled={busy} onClick={() => void refreshStatus()}>{busy ? "Refreshing…" : "Refresh status"}</button>
      </div> : null}
      {error ? <p className="staff-leave-cover__error" role="alert">{error}</p> : null}
    </div>
  </article>;
}
