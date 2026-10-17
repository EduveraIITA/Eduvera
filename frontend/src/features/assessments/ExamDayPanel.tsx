import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, MapPin, Search, ShieldCheck, UserRoundCheck, UsersRound, X } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { AttendanceStudentRow, type AttendanceStudentRowStatusOption } from "../../pages/operations/AttendanceStudentRow";
import "../../pages/operations/attendance-register.css";
import { createExamIncident, examOperationAction, resolveExamIncident, respondToInvigilation, saveExamAttendance, type AssessmentDetail, type ExamCandidateStatus, type ExamOperation } from "./api";

const statusOptions: readonly AttendanceStudentRowStatusOption<Exclude<ExamCandidateStatus, "unrecorded">>[] = [
  { value: "present", label: "Present", tone: "positive" },
  { value: "absent", label: "Absent", tone: "negative" },
  { value: "late", label: "Late" },
  { value: "left_early", label: "Left early" },
];
const quickStatuses = statusOptions.slice(0, 2);
const nice = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const localDateTime = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const time = (value: string) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
const formValue = (form: FormData, key: string) => { const value = form.get(key); return typeof value === "string" ? value.trim() : ""; };

type CandidateDraft = { status: ExamCandidateStatus; note: string };

export function ExamDayPanel({ schoolId, assessmentId, operation, viewerRole, refresh }: { schoolId: string; assessmentId: string; operation: ExamOperation; viewerRole: AssessmentDetail["viewer_role"]; refresh: () => Promise<void> }) {
  const { sitting, space, candidates, incidents, policy } = operation;
  const [drafts, setDrafts] = useState<Record<string, CandidateDraft>>(() => Object.fromEntries(candidates.map((candidate) => [candidate.student_id, { status: candidate.attendance_status, note: candidate.attendance_note ?? "" }])));
  const [filter, setFilter] = useState<"all" | "unrecorded" | "exceptions">("all");
  const [query, setQuery] = useState("");
  const [showIncident, setShowIncident] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const pendingOfferCommand = useRef<{key:string;commandId:string}|null>(null);
  const acceptedInvigilators = operation.invigilators.filter((person) => person.status === "accepted");
  const canOperate = viewerRole === "admin" || operation.viewer_assignment?.status === "accepted";
  const canRecordAttendance = canOperate && sitting.state === "in_progress";
  const readinessBlockers = sitting.state === "planning" ? (operation.readiness?.blockers.map((blocker) => blocker.message) ?? [
    ...(space.capacity === null ? ["Room capacity is not recorded."] : []),
    ...(acceptedInvigilators.length < policy.minimum_invigilators ? [`${policy.minimum_invigilators - acceptedInvigilators.length} more invigilator acceptance${policy.minimum_invigilators - acceptedInvigilators.length === 1 ? " is" : "s are"} needed.`] : []),
  ]) : [];
  const changed = candidates.filter((candidate) => {
    const draft = drafts[candidate.student_id];
    return draft && (draft.status !== candidate.attendance_status || draft.note !== (candidate.attendance_note ?? ""));
  });
  const counts = useMemo(() => Object.values(drafts).reduce((totals, draft) => ({
    recorded: totals.recorded + (draft.status === "unrecorded" ? 0 : 1),
    unrecorded: totals.unrecorded + (draft.status === "unrecorded" ? 1 : 0),
    exceptions: totals.exceptions + (["absent", "late", "left_early"].includes(draft.status) ? 1 : 0),
  }), { recorded: 0, unrecorded: 0, exceptions: 0 }), [drafts]);
  const candidateTotal = sitting.state === "planning"
    ? (operation.readiness?.candidate_count ?? candidates.length)
    : candidates.length;
  const visible = candidates.filter((candidate) => {
    const draft = drafts[candidate.student_id]!;
    const matchesFilter = filter === "all" || (filter === "unrecorded" ? draft.status === "unrecorded" : ["absent", "late", "left_early"].includes(draft.status));
    const needle = query.trim().toLocaleLowerCase();
    return matchesFilter && (!needle || `${candidate.name} ${candidate.admission_number} ${candidate.roll_number_snapshot ?? ""}`.toLocaleLowerCase().includes(needle));
  });

  async function run(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await work();
      await refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The exam-day record could not be updated.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function saveAttendance() {
    const now = new Date().toISOString();
    const records = changed.flatMap((candidate) => {
      const draft = drafts[candidate.student_id]!;
      return draft.status === "unrecorded" ? [] : [{ student_id: candidate.student_id, status: draft.status, note: draft.note, observed_at: now, expected_revision: candidate.attendance_revision }];
    });
    if (!records.length) return;
    await run("attendance", () => saveExamAttendance(schoolId, assessmentId, sitting.revision, records));
  }

  async function submitIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await run("incident", () => createExamIncident(schoolId, assessmentId, {
      expected_revision: sitting.revision,
      student_id: formValue(form, "student_id") || null,
      category: formValue(form, "category") || "other",
      severity: formValue(form, "severity") || "info",
      summary: formValue(form, "summary"),
      observed_at: new Date(formValue(form, "observed_at")).toISOString(),
    }));
    if (saved) setShowIncident(false);
  }

  async function respondToOffer(decision: "accepted" | "declined", note: string) {
    const assignment = operation.viewer_assignment;
    if (!assignment || assignment.status !== "offered") return;
    const key = `${assignment.id}:${assignment.revision}:${decision}:${note}`;
    if (pendingOfferCommand.current?.key !== key) pendingOfferCommand.current = { key, commandId: crypto.randomUUID() };
    const commandId = pendingOfferCommand.current.commandId;
    const saved = await run(`offer-${decision}`, () => respondToInvigilation(schoolId, assessmentId, assignment.id, { command_id: commandId, expected_revision: assignment.revision, decision, note }));
    if (saved) {
      pendingOfferCommand.current = null;
      setShowDecline(false);
    }
  }

  return <section className="exam-day-panel" role="region" aria-labelledby="exam-day-heading">
    <header className="exam-day-panel__header">
      <div><span>PHYSICAL EXAMINATION</span><h3 id="exam-day-heading">Exam day</h3><p>{time(sitting.starts_at)}–{time(sitting.ends_at)} · {space.name}</p></div>
      <i className={`exam-day-state is-${sitting.state}`}>{nice(sitting.state)}</i>
    </header>
    {operation.viewer_assignment?.status === "offered" ? <section className="exam-invigilation-offer" aria-labelledby="invigilation-offer-heading">
      <div><UserRoundCheck size={19}/><span><strong id="invigilation-offer-heading">Invigilation duty</strong><small>Confirm whether you can supervise this sitting.</small></span></div>
      {!showDecline ? <div><button type="button" disabled={Boolean(busy)} onClick={() => void respondToOffer("accepted", "")}>{busy === "offer-accepted" ? "Accepting…" : "Accept duty"}</button><button type="button" className="is-secondary" disabled={Boolean(busy)} onClick={() => setShowDecline(true)}>Decline</button></div> : <form aria-label="Decline invigilation duty" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void respondToOffer("declined", formValue(form, "reason")); }}><label>Reason for declining<textarea name="reason" required minLength={3} maxLength={500} rows={2} placeholder="Help the exam coordinator arrange cover."/></label><div><button disabled={busy === "offer-declined"}>{busy === "offer-declined" ? "Sending…" : "Send decline"}</button><button type="button" className="is-secondary" onClick={() => setShowDecline(false)}>Cancel</button></div></form>}
    </section> : null}
    {readinessBlockers.length ? <div className="exam-day-readiness is-blocked" role="status"><AlertTriangle size={18}/><div><strong>Not ready to schedule</strong><ul>{readinessBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div></div> : <div className="exam-day-readiness"><CheckCircle2 size={18}/><span><strong>{sitting.state === "planning" ? "Ready to schedule" : nice(sitting.state)}</strong> · {sitting.state === "planning" ? "Class, room and staff timetable checks are clear." : "The scheduled readiness checks were completed."}</span></div>}
    <div className="exam-day-facts">
      <span><MapPin size={17}/><small>ROOM</small><strong>{space.name}</strong><em>{space.capacity ? `${space.capacity} seats` : "Capacity not recorded"}</em></span>
      <span><UsersRound size={17}/><small>CANDIDATES</small><strong>{sitting.state === "planning" ? `${candidateTotal} eligible` : `${counts.recorded} of ${candidateTotal}`}</strong><em>{sitting.state === "planning" ? "Roster freezes when scheduled" : `${counts.unrecorded} not recorded`}</em></span>
      <span><UserRoundCheck size={17}/><small>INVIGILATORS</small><strong>{acceptedInvigilators.length} confirmed</strong><em>Minimum {policy.minimum_invigilators}</em></span>
    </div>
    {operation.invigilators.length ? <p className="exam-day-invigilators"><ShieldCheck size={16}/>{operation.invigilators.map((person) => `${person.name} · ${nice(person.status)}`).join("  ·  ")}</p> : null}
    {error ? <p className="assessment-error" role="alert">{error}</p> : null}
    <div className="exam-day-actions">
      {canOperate && sitting.state === "ready" ? <button type="button" disabled={Boolean(busy)} onClick={() => void run("start", () => examOperationAction(schoolId, assessmentId, "start", sitting.revision))}><Clock3 size={17}/>{busy === "start" ? "Starting…" : "Start exam"}</button> : null}
      {canOperate && sitting.state === "in_progress" ? <button type="button" className="is-secondary" disabled={Boolean(busy)} onClick={() => void run("complete", () => examOperationAction(schoolId, assessmentId, "complete", sitting.revision))}><ClipboardCheck size={17}/>{busy === "complete" ? "Completing…" : "Complete exam"}</button> : null}
      {canOperate && sitting.state === "in_progress" ? <button type="button" className="is-secondary" aria-expanded={showIncident} onClick={() => setShowIncident((value) => !value)}><AlertTriangle size={17}/>{showIncident ? "Close incident form" : "Report incident"}</button> : null}
    </div>
    {showIncident ? <form className="exam-incident-form" aria-label="Report exam incident" onSubmit={(event) => void submitIncident(event)}>
      <header><div><span>EXAM RECORD</span><h4>Report an incident</h4></div><button type="button" aria-label="Close incident form" onClick={() => setShowIncident(false)}><X size={18}/></button></header>
      <div>
        <label>Candidate (optional)<select name="student_id"><option value="">Whole room or sitting</option>{candidates.map((candidate) => <option key={candidate.student_id} value={candidate.student_id}>{candidate.name} · {candidate.admission_number}</option>)}</select></label>
        <label>Category<select name="category" defaultValue="conduct"><option value="conduct">Conduct</option><option value="health">Health</option><option value="materials">Exam materials</option><option value="timing">Timing</option><option value="other">Other</option></select></label>
        <label>Severity<select name="severity" defaultValue="info"><option value="info">Information only</option><option value="minor">Needs follow-up</option><option value="major">Urgent</option></select></label>
        <label>Observed at<TemporalInput name="observed_at" type="datetime-local" defaultValue={localDateTime()} required/></label>
        <label className="exam-incident-form__summary">What happened?<textarea name="summary" required minLength={3} maxLength={1000} rows={3} placeholder="Record the observed facts and action taken."/></label>
      </div><button disabled={busy === "incident"}>{busy === "incident" ? "Recording…" : "Record incident"}</button>
    </form> : null}
    {candidates.length ? <div className="exam-day-attendance roll-call-page">
      <div className="exam-day-attendance__head"><div><span>CANDIDATE ATTENDANCE</span><h4>{canRecordAttendance ? "Who is in the room?" : "Candidate record"}</h4></div>{canRecordAttendance ? <button type="button" disabled={!counts.unrecorded || Boolean(busy)} onClick={() => setDrafts((current) => Object.fromEntries(Object.entries(current).map(([id, draft]) => [id, draft.status === "unrecorded" ? { ...draft, status: "present" } : draft])))}><CheckCircle2 size={16}/>Mark remaining present</button> : null}</div>
      <label className="roll-call-search"><Search size={18}/><span className="sr-only">Search candidates</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, admission or roll number"/></label>
      <div className="roll-call-filters" role="group" aria-label="Filter candidates">{([['all','All',candidates.length],['unrecorded','Not recorded',counts.unrecorded],['exceptions','Exceptions',counts.exceptions]] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>)}</div>
      <div className="roll-call-roster">{visible.map((candidate) => { const draft = drafts[candidate.student_id]!; return <AttendanceStudentRow key={candidate.student_id} student={{ id: candidate.student_id, name: candidate.name, admission_number: candidate.admission_number, roll_number: candidate.roll_number_snapshot, avatar_url: candidate.avatar_url }} status={draft.status === "unrecorded" ? null : draft.status} remarks={draft.note} disabled={!canRecordAttendance || Boolean(busy)} conflict={false} statusOptions={statusOptions} quickStatuses={quickStatuses} allowEmpty={candidate.attendance_status === "unrecorded"} emptyLabel="Not recorded" noteLabel="Exam attendance note" onChange={(patch) => setDrafts((current) => ({ ...current, [candidate.student_id]: { ...current[candidate.student_id]!, ...(patch.status !== undefined ? { status: patch.status ?? "unrecorded" } : {}), ...(patch.remarks !== undefined ? { note: patch.remarks } : {}) } }))}/>; })}</div>
      {!visible.length ? <p className="assessment-empty">No candidates match this view.</p> : null}
      {canRecordAttendance ? <footer><span>{changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "Attendance is up to date"}</span><button type="button" disabled={!changed.some((candidate) => drafts[candidate.student_id]?.status !== "unrecorded") || Boolean(busy)} onClick={() => void saveAttendance()}>{busy === "attendance" ? "Saving…" : "Save attendance"}</button></footer> : null}
    </div> : null}
    {incidents.length ? <div className="exam-incident-list"><header><h4>Incident log</h4><span>{incidents.filter((incident) => incident.state === "open").length} open</span></header>{incidents.map((incident) => { const studentName = candidates.find((candidate) => candidate.student_id === incident.student_id)?.name ?? "Whole sitting"; return <article key={incident.id}><AlertTriangle size={17}/><div><strong>{nice(incident.category)} · {nice(incident.severity)}</strong><p>{incident.summary}</p><small>{studentName} · {time(incident.observed_at)} · {nice(incident.state)}</small>{resolving === incident.id ? <form aria-label={`Resolve incident for ${studentName.toLocaleLowerCase()}`} onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget); void run(`resolve-${incident.id}`, () => resolveExamIncident(schoolId, assessmentId, incident.id, { expected_revision: incident.revision, resolution: formValue(value, "resolution") })).then((saved) => { if (saved) setResolving(null); }); }}><label>Resolution<input name="resolution" required minLength={3} maxLength={500} placeholder="What was done?"/></label><div><button disabled={busy === `resolve-${incident.id}`}>{busy === `resolve-${incident.id}` ? "Resolving…" : "Resolve"}</button><button type="button" className="is-secondary" onClick={() => setResolving(null)}>Cancel</button></div></form> : null}</div>{incident.state === "open" && canOperate && resolving !== incident.id ? <button type="button" className="is-secondary" onClick={() => setResolving(incident.id)}>Resolve</button> : null}</article>; })}</div> : null}
  </section>;
}
