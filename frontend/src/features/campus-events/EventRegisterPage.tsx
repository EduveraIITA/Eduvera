import { AlertTriangle, CheckCircle2, Clock3, History as HistoryIcon, LockKeyhole, RotateCcw, Save, Search, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { AttendanceStudentRow, type AttendanceStudentRowStatusOption } from "../../pages/operations/AttendanceStudentRow";
import { eventIdempotencyKey } from "./api";
import { formatEventDate } from "./EventPrimitives";
import type { EventAttendanceHistoryResponse, EventAttendanceStatus, EventRegisterInput, EventRegisterResponse } from "./types";
import "./campus-events.css";
import "../../pages/operations/attendance-register.css";

const statusLabels: Record<EventAttendanceStatus, string> = {
  not_recorded: "Not recorded",
  present: "Present",
  late: "Late",
  excused: "Excused",
  no_show: "No-show",
  checked_out: "Checked out",
};

const physicalStatuses = new Set<EventAttendanceStatus>(["present", "late", "checked_out"]);

interface RegisterDraftRecord {
  status: EventAttendanceStatus;
  note: string;
  observed_at: string;
  readiness_contradiction_note: string;
}

const readinessLabels = {
  guardian_consent: "Guardian consent is not ready",
  required_checklist: "Required items are not confirmed packed",
} as const;

function localDateTime(value: string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const attendanceDisabledLabels: Record<string, string> = {
  event_not_published: "Attendance opens after this event is published.",
  attendance_not_enabled: "This session does not use an attendance register.",
  register_locked: "This register is locked. A principal must reopen it for a correction.",
  not_attendance_taker: "Only the assigned attendance taker can mark this register.",
  attendance_window_not_open: "Attendance has not opened yet under the institution’s operating window.",
  outside_attendance_window: "The staff attendance window has closed. A principal can reconcile this register.",
  session_not_ended: "This register can be locked after the session ends.",
  register_incomplete: "Record a decision for every participant before locking the register.",
  attendance_incomplete: "Record a decision for every participant before locking the register.",
  check_out_incomplete: "Complete every required check-out before locking the register.",
  checkout_incomplete: "Complete every required check-out before locking the register.",
  lock_window_closed: "The staff lock window has closed. A principal can reconcile and lock this register.",
};

export function EventRegisterPage({
  portal,
  backTo,
  register,
  onSave,
  onLock,
  onReopen,
  onHistory,
}: {
  portal: "teacher" | "principal";
  backTo?: string;
  register: EventRegisterResponse;
  onSave: (input: EventRegisterInput) => Promise<void>;
  onLock: (reason: string) => Promise<void>;
  onReopen: (reason: string) => Promise<void>;
  onHistory: () => Promise<EventAttendanceHistoryResponse>;
}) {
  const [now] = useState(() => Date.now());
  const policy = register.observation_policy ?? { observation_hours_before: 2, observation_hours_after: 4, revision: 0 };
  const earliestObservation = new Date(register.session.starts_at).getTime() - policy.observation_hours_before * 3_600_000;
  const latestObservation = Math.min(now, new Date(register.session.ends_at).getTime() + policy.observation_hours_after * 3_600_000);
  const liveObservation = now >= earliestObservation && now <= new Date(register.session.ends_at).getTime() + policy.observation_hours_after * 3_600_000;
  const [batchObservedAt, setBatchObservedAt] = useState("");
  const defaultObservation = batchObservedAt || (liveObservation ? localDateTime(now) : "");
  const original = useMemo<Record<string, RegisterDraftRecord>>(() => Object.fromEntries(register.rows.map((row) => {
    const persistedObservation = row.attendance_status === "checked_out" ? row.checked_out_at : physicalStatuses.has(row.attendance_status) ? row.checked_in_at : null;
    return [row.student_id, { status: row.attendance_status, note: row.note, observed_at: persistedObservation ? localDateTime(persistedObservation) : "", readiness_contradiction_note: row.readiness_contradiction_note ?? "" }];
  })), [register]);
  const [records, setRecords] = useState<Record<string, RegisterDraftRecord>>(original);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "exceptions">("all");
  const [reason, setReason] = useState("");
  const [lockReason, setLockReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "locking" | "reopening" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<EventAttendanceHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lockPanelOpen, setLockPanelOpen] = useState(false);
  const prefix = portal === "principal" ? "/principal" : "/teacher";
  const registerBackTo = backTo ?? `${prefix}/events/${register.event.id}`;
  const changedRows = register.rows.filter((row) => {
    const value = records[row.student_id];
    const prior = original[row.student_id];
    if (!value || !prior) return false;
    return value.status !== prior.status || value.note.trim() !== prior.note.trim() || value.observed_at !== prior.observed_at || value.readiness_contradiction_note.trim() !== prior.readiness_contradiction_note.trim();
  });
  const correctionRequired = changedRows.some((row) => row.record_revision > 0);
  const visibleRows = register.rows.filter((row) => {
    const value = records[row.student_id];
    const matchesSearch = `${row.student_name} ${row.admission_number}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "all" || (filter === "pending" ? value?.status === "not_recorded" : value?.status !== "present" && value?.status !== "not_recorded");
    return matchesSearch && matchesFilter;
  });
  const marked = Object.values(records).filter((record) => record.status !== "not_recorded").length;
  const attending = Object.values(records).filter((item) => item.status === "present" || item.status === "checked_out").length;
  const exceptions = Object.values(records).filter((item) => ["late", "excused", "no_show"].includes(item.status)).length;
  const missingObservation = changedRows.some((row) => physicalStatuses.has(records[row.student_id]!.status) && !records[row.student_id]!.observed_at);
  const invalidObservation = changedRows.some((row) => {
    const value = records[row.student_id]!;
    if (!physicalStatuses.has(value.status) || !value.observed_at) return false;
    const timestamp = new Date(value.observed_at).getTime();
    return !Number.isFinite(timestamp) || timestamp < earliestObservation || timestamp > latestObservation;
  });
  const missingReadinessExplanation = changedRows.some((row) => !row.participation_ready && physicalStatuses.has(records[row.student_id]!.status) && records[row.student_id]!.readiness_contradiction_note.trim().length < 3);
  const readyRows = register.rows.filter((row) => row.participation_ready);

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryError("");
    setHistoryLoading(true);
    try { setHistory(await onHistory()); }
    catch (error) { setHistoryError(error instanceof Error ? error.message : "Change history could not be loaded."); }
    finally { setHistoryLoading(false); }
  };

  const save = async () => {
    if (!changedRows.length || missingObservation || invalidObservation || missingReadinessExplanation || (correctionRequired && reason.trim().length < 3)) return;
    setState("saving");
    setMessage("");
    try {
      await onSave({
        expected_revision: register.session.revision,
        idempotency_key: eventIdempotencyKey(),
        reason: correctionRequired ? reason.trim() : undefined,
        records: changedRows.map((row) => {
          const record = records[row.student_id]!;
          return { student_id: row.student_id, status: record.status, note: record.note.trim(), observed_at: physicalStatuses.has(record.status) ? new Date(record.observed_at).toISOString() : null, readiness_contradiction_note: !row.participation_ready && physicalStatuses.has(record.status) ? record.readiness_contradiction_note.trim() : null };
        }),
      });
      setState("saved");
      setMessage("Event register saved with its revision history.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "The event register could not be saved.");
    }
  };

  const lock = async () => {
    if (lockReason.trim().length < 3) return;
    setState("locking");
    setMessage("");
    try { await onLock(lockReason.trim()); setState("saved"); setMessage("Register locked. Reopening requires a principal reason."); setLockPanelOpen(false); }
    catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "The register could not be locked."); }
  };

  const reopen = async () => {
    if (!reopenReason.trim()) return;
    setState("reopening");
    setMessage("");
    try { await onReopen(reopenReason.trim()); setState("saved"); setMessage("Register reopened for correction."); setReopenReason(""); }
    catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "The register could not be reopened."); }
  };

  const markReadyPresent = () => {
    setRecords(Object.fromEntries(register.rows.map((row) => {
      const current = records[row.student_id]!;
      if (!row.participation_ready || current.status !== "not_recorded") return [row.student_id, current];
      return [row.student_id, { ...current, status: "present" as const, observed_at: row.checked_in_at ? localDateTime(row.checked_in_at) : defaultObservation, readiness_contradiction_note: "" }];
    })));
  };

  return (
    <OperationsShell portal={portal} active="events" title="Event register" backTo={registerBackTo} contentHasHeading>
      <div className="campus-event-register-page roll-call-page">
        <section className="campus-event-register-hero">
          <div className="campus-event-register-hero__heading">
            <div><span>{register.event.title}</span><h2>{register.session.title}</h2><p>{formatEventDate(register.session.starts_at)} · {register.session.attendance_mode === "check_in_out" ? "Check-in and check-out" : "Check-in only"}</p></div>
            <span className={`campus-event-register-state is-${register.session.state}`}>{register.session.state === "locked" ? <LockKeyhole size={15} /> : <Clock3 size={15} />}{register.session.state}</span>
          </div>
          <div className="campus-event-register-progress" aria-label={`${marked} of ${register.rows.length} attendance decisions recorded`}>
            <div><strong>{marked} of {register.rows.length}</strong><span>{marked === register.rows.length ? "All decisions recorded" : `${register.rows.length - marked} still to record`}</span></div>
            <progress max={register.rows.length || 1} value={marked}>{marked}/{register.rows.length}</progress>
            <p><span>{attending} attending</span><span>{exceptions} {exceptions === 1 ? "exception" : "exceptions"}</span></p>
          </div>
        </section>

        {!liveObservation ? <section className="campus-event-register-lock-panel"><h2>Record past attendance</h2><p>Choose when attendance was observed for this session. This time applies to new marks and unsaved attendance below.</p><label>Observed time<input type="datetime-local" min={localDateTime(earliestObservation)} max={localDateTime(latestObservation)} value={batchObservedAt} onChange={(event) => {
          const observed_at = event.target.value;
          setBatchObservedAt(observed_at);
          setRecords((current) => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, physicalStatuses.has(value.status) && changedRows.some((row) => row.student_id === id) ? { ...value, observed_at } : value])));
        }} /></label></section> : null}
        <section className="roll-call-register campus-event-register-workspace" aria-labelledby="event-participants-heading">
          <header className="roll-call-toolbar">
            <div className="roll-call-toolbar__title"><div><h2 id="event-participants-heading">Participants</h2><p>{register.rows.length} in this register</p></div><div className="roll-call-toolbar__actions"><button className="campus-event-history-action" type="button" onClick={() => void openHistory()}><HistoryIcon size={16} />History</button><button className="roll-call-mark-all" type="button" disabled={register.session.state === "locked" || !register.permissions.can_take_attendance || readyRows.length === 0} onClick={markReadyPresent}><CheckCircle2 size={16} />{readyRows.length < register.rows.length ? "Mark ready present" : marked && marked < register.rows.length ? "Mark remaining present" : "Mark all present"}</button></div></div>
            <label className="roll-call-search"><Search size={17} /><input aria-label="Search student or admission number" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or admission number" /></label>
            <div className="roll-call-filters" role="group" aria-label="Filter participants">{(["all", "pending", "exceptions"] as const).map((item) => { const count = item === "all" ? register.rows.length : item === "pending" ? Object.values(records).filter((entry) => entry.status === "not_recorded").length : exceptions; return <button type="button" aria-pressed={filter === item} key={item} onClick={() => setFilter(item)}>{item === "all" ? "All" : item === "pending" ? "Not recorded" : "Exceptions"}<span>{count}</span></button>; })}</div>
          </header>
          {readyRows.length < register.rows.length ? <p className="campus-event-readiness-summary"><ShieldCheck size={16} />{register.rows.length - readyRows.length} {register.rows.length - readyRows.length === 1 ? "student needs" : "students need"} individual review before bulk marking.</p> : null}
          <div className="roll-call-roster campus-event-register-list">{visibleRows.map((row) => {
            const value = records[row.student_id]!;
            const prior = original[row.student_id]!;
            const isPersistedChange = row.record_revision > 0 && (value.status !== prior.status || value.note.trim() !== prior.note.trim() || value.observed_at !== prior.observed_at);
            const statuses = (Object.keys(statusLabels) as EventAttendanceStatus[]).filter((status) => {
              if (status === "checked_out") return register.session.attendance_mode === "check_in_out" && Boolean(row.checked_in_at) && ["present", "late", "checked_out"].includes(row.attendance_status);
              if (status === "late") return now >= new Date(register.session.starts_at).getTime();
              if (status === "no_show") return row.participation_ready && (row.participation_requirement === "mandatory" || row.rsvp_status === "accepted") && now >= new Date(register.session.ends_at).getTime();
              return true;
            });
            const statusOptions: AttendanceStudentRowStatusOption<EventAttendanceStatus>[] = statuses.map((status) => ({ value: status, label: statusLabels[status] + (status === "not_recorded" && row.record_revision > 0 ? " (clear decision)" : "") }));
            const quickStatuses: AttendanceStudentRowStatusOption<EventAttendanceStatus>[] = [{ value: "present", label: "Present", tone: "positive" }, ...(statuses.includes("no_show") ? [{ value: "no_show" as const, label: "No-show", tone: "negative" as const }] : [])];
            const updateRow = (change: { status?: EventAttendanceStatus | null; remarks?: string }) => {
              const status = change.status ?? value.status;
              const observed_at = change.status === undefined
                ? value.observed_at
                : status === "checked_out"
                  ? value.status === "checked_out" && value.observed_at ? value.observed_at : row.checked_out_at ? localDateTime(row.checked_out_at) : defaultObservation
                  : status === "present" || status === "late"
                    ? (value.status === "present" || value.status === "late") && value.observed_at ? value.observed_at : row.checked_in_at ? localDateTime(row.checked_in_at) : defaultObservation
                    : "";
              setRecords({ ...records, [row.student_id]: { ...value, status, note: change.remarks ?? value.note, observed_at, readiness_contradiction_note: physicalStatuses.has(status) ? value.readiness_contradiction_note : "" } });
            };
            return (
              <AttendanceStudentRow<EventAttendanceStatus>
                key={row.student_id}
                student={{ id: row.student_id, name: row.student_name, admission_number: row.admission_number, avatar_url: row.avatar_url }}
                status={value.status}
                remarks={value.note}
                disabled={register.session.state === "locked" || !register.permissions.can_take_attendance}
                conflict={false}
                context={row.participation_requirement === "mandatory" ? "Mandatory" : "Optional"}
                attention={<>{row.checked_in_at ? <small className="campus-event-register-timing">Checked in {new Date(row.checked_in_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}{row.checked_out_at ? ` · out ${new Date(row.checked_out_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : ""}</small> : null}{isPersistedChange ? <small className="campus-event-register-correction">Correction pending</small> : null}{!row.participation_ready ? <span className="campus-event-register-readiness"><AlertTriangle size={15} /><span><b>Participation not ready</b><small>{row.readiness_blockers.map((blocker) => readinessLabels[blocker]).join(" · ")}</small></span></span> : null}</>}
                statusOptions={statusOptions}
                quickStatuses={quickStatuses}
                allowEmpty={false}
                emptyLabel="Not recorded"
                noteLabel="Event note"
                onChange={updateRow}
              >
                {physicalStatuses.has(value.status) ? <label className="campus-event-register-observed"><span>Observed at</span><input required min={localDateTime(earliestObservation)} max={localDateTime(latestObservation)} aria-label={`Observed at for ${row.student_name}`} type="datetime-local" disabled={register.session.state === "locked" || !register.permissions.can_take_attendance} value={value.observed_at} onChange={(event) => setRecords({ ...records, [row.student_id]: { ...value, observed_at: event.target.value } })} /></label> : null}
                {!row.participation_ready && physicalStatuses.has(value.status) ? <label className="campus-event-register-contradiction"><span>Observed attendance explanation</span><input required minLength={3} aria-label={`Observed attendance explanation for ${row.student_name}`} disabled={register.session.state === "locked" || !register.permissions.can_take_attendance} value={value.readiness_contradiction_note} onChange={(event) => setRecords({ ...records, [row.student_id]: { ...value, readiness_contradiction_note: event.target.value } })} placeholder="Explain the verified physical observation" /><small>Physical presence may be recorded, but No-show is unavailable while participation is not ready.</small></label> : null}
              </AttendanceStudentRow>
            );
          })}{visibleRows.length === 0 ? <p className="campus-event-inline-empty">No participants match this filter.</p> : null}</div>
        </section>

        {missingObservation ? <p className="campus-event-form-error" role="alert">Add the observed time for every physical attendance decision.</p> : null}
        {invalidObservation ? <p className="campus-event-form-error" role="alert">Choose an observed time within {policy.observation_hours_before} hours before and {policy.observation_hours_after} hours after this session, and no later than now.</p> : null}
        {missingReadinessExplanation ? <p className="campus-event-form-error" role="alert">Explain every observed physical attendance decision that contradicts incomplete participation requirements.</p> : null}
        {correctionRequired ? <section className="campus-event-correction"><RotateCcw size={18} /><div><label>Correction reason<textarea rows={2} required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why are persisted attendance decisions changing?" /></label><p>This reason becomes part of the immutable register history.</p></div></section> : null}
        {message ? <p className={`campus-event-action-message is-${state}`} role="status">{message}</p> : null}
        {register.session.state === "open" && lockPanelOpen ? <section id="event-register-lock-panel" className="campus-event-register-lock-panel" aria-labelledby="event-register-lock-heading"><div><LockKeyhole size={18} /><span><h2 id="event-register-lock-heading">Lock register</h2><p>Lock after every decision is final. A principal can reopen it for a correction.</p></span></div><label><span>Reason</span><input autoFocus value={lockReason} onChange={(event) => setLockReason(event.target.value)} placeholder="Why is this register complete?" /></label><div><button className="campus-event-secondary" type="button" onClick={() => setLockPanelOpen(false)}>Cancel</button><button className="campus-event-primary" type="button" disabled={!register.permissions.can_lock || changedRows.length > 0 || state === "locking" || lockReason.trim().length < 3} onClick={() => void lock()}><LockKeyhole size={16} />{state === "locking" ? "Locking..." : "Confirm lock"}</button></div></section> : null}
        <footer className="roll-call-submit-bar campus-event-submit-bar">
          <div className="roll-call-submit-bar__inner">
            <div className="roll-call-progress">
              <span>{changedRows.length ? `${changedRows.length} unsaved ${changedRows.length === 1 ? "change" : "changes"}` : marked === register.rows.length ? "Register complete" : `${marked} of ${register.rows.length} recorded`}</span>
              <progress aria-label="Participants recorded" max={register.rows.length || 1} value={marked}>{marked}/{register.rows.length}</progress>
            </div>
            {register.session.state === "open" ? changedRows.length ? <button type="button" disabled={missingObservation || invalidObservation || missingReadinessExplanation || state === "saving" || (correctionRequired && reason.trim().length < 3)} onClick={() => void save()}><Save size={16} />{state === "saving" ? "Saving..." : "Save register"}</button> : register.permissions.can_lock ? <button className="campus-event-submit-secondary" type="button" aria-expanded={lockPanelOpen} aria-controls="event-register-lock-panel" onClick={() => setLockPanelOpen((open) => !open)}><LockKeyhole size={16} />Lock register</button> : null : register.permissions.can_reopen ? <div className="campus-event-reopen"><input aria-label="Reason to reopen register" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="Reason to reopen" /><button className="campus-event-secondary" type="button" disabled={reopenReason.trim().length < 3 || state === "reopening"} onClick={() => void reopen()}><RotateCcw size={16} />Reopen</button></div> : <span className="campus-event-locked-note"><ShieldCheck size={15} />Locked record</span>}
          </div>
        </footer>
        {!register.permissions.can_take_attendance && register.session.state === "open" ? <p className="campus-event-policy-note"><Clock3 size={15} />{register.permissions.attendance_disabled_reason ? attendanceDisabledLabels[register.permissions.attendance_disabled_reason] ?? "Attendance controls are not available for this session." : "Attendance controls are not available for this session yet."}</p> : null}
        {register.session.state === "open" && !register.permissions.can_lock && register.permissions.lock_disabled_reason ? <p className="campus-event-policy-note"><LockKeyhole size={15} />{attendanceDisabledLabels[register.permissions.lock_disabled_reason] ?? "This register is not ready to lock."}</p> : null}
        <p className="campus-event-policy-note"><ShieldCheck size={15} /><span><b>Event register only.</b> “Not recorded” means no decision yet; academic attendance is unchanged.</span></p>
      </div>
      {historyOpen ? <EventRegisterHistorySheet history={history} loading={historyLoading} error={historyError} onClose={() => setHistoryOpen(false)} onRetry={() => void openHistory()} /> : null}
    </OperationsShell>
  );
}

function EventRegisterHistorySheet({ history, loading, error, onClose, onRetry }: { history: EventAttendanceHistoryResponse | null; loading: boolean; error: string; onClose: () => void; onRetry: () => void }) {
  return (
    <div className="campus-event-modal-backdrop campus-event-history-backdrop" role="presentation" onClick={onClose}>
      <section className="campus-event-history-sheet" role="dialog" aria-modal="true" aria-labelledby="event-history-heading" onClick={(event) => event.stopPropagation()}>
        <header><span><HistoryIcon size={20} /></span><div><small>Register audit trail</small><h2 id="event-history-heading">Change history</h2><p>{history?.session.title ?? "Loading session history"}</p></div><button type="button" aria-label="Close change history" onClick={onClose}><X size={20} /></button></header>
        {loading ? <p className="campus-authority-loading" role="status">Loading change history...</p> : null}
        {error ? <div className="campus-event-history-error" role="alert"><p>{error}</p><button className="campus-event-secondary" type="button" onClick={onRetry}>Try again</button></div> : null}
        {!loading && !error && history?.items.length === 0 ? <p className="campus-event-inline-empty">No saved attendance changes yet.</p> : null}
        {!loading && !error && history?.items.length ? <ol className="campus-event-history-list">{history.items.map((item) => <li key={item.id}><span>{item.student_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span><div><strong>{item.student_name}</strong><p><b>{statusLabels[item.previous_status ?? "not_recorded"]}</b> to <b>{statusLabels[item.new_status]}</b>{(item.previous_note ?? "") !== (item.new_note ?? "") ? " · note updated" : ""}</p><small>{new Date(item.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {item.changed_by_name}</small>{item.reason ? <em>Reason: {item.reason}</em> : null}</div><mark>Rev {item.revision}</mark></li>)}</ol> : null}
      </section>
    </div>
  );
}
