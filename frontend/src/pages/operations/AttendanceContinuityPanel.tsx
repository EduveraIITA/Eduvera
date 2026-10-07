import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, FileInput, LoaderCircle } from "lucide-react";
import type { AttendanceContinuityWorkspace, TeacherClassSummary } from "../../features/operations/api";

const sourceLabels = {
  live_app: "Live app",
  offline_device: "Offline entry",
  paper: "Paper register",
  office: "Office entry",
};

const reviewLabels: Record<string, string> = {
  snapshot_expired: "Saved register expired",
  roster_changed: "Student list needs checking",
  register_changed: "Register changed",
  permission_revoked: "Access changed",
  assignment_changed: "Staff assignment changed",
  invalid_observation_time: "Recorded time needs checking",
  write_conflict: "Another update was received",
};

function attendanceDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function AttendanceContinuityPanel({ data, classes, date, loading, error, onDecision }: {
  data?: AttendanceContinuityWorkspace;
  classes: TeacherClassSummary[];
  date: string;
  loading: boolean;
  error: Error | null;
  onDecision: (caseId: string, decision: "accept" | "reject", reason: string, expectedRevision: number) => Promise<void>;
}) {
  const [paperClass, setPaperClass] = useState(classes[0]?.class_section_id ?? "");
  const [activeCase, setActiveCase] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [actionError, setActionError] = useState("");
  const selectedClass = classes.some((item) => item.class_section_id === paperClass) ? paperClass : classes[0]?.class_section_id ?? "";
  const workspace = !loading && !error ? data : undefined;
  // Open cases span all dates; processed totals belong only to data.date.
  const reviewCount = workspace ? Math.max(workspace.summary.quarantined, workspace.cases.length) : 0;

  const decide = async (caseId: string, decision: "accept" | "reject", expectedRevision: number) => {
    if (reason.trim().length < 3 || busy) return;
    setBusy(decision);
    setActionError("");
    try {
      await onDecision(caseId, decision, reason.trim(), expectedRevision);
      setActiveCase(null);
      setReason("");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "This entry could not be reviewed. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return <section className="attendance-continuity" aria-labelledby="attendance-continuity-heading">
    <header className="attendance-continuity__header">
      <div><h2 id="attendance-continuity-heading">Paper &amp; offline entries</h2><p>Review entries before they update attendance.</p></div>
      {reviewCount > 0 ? <span className="attendance-continuity__badge">{reviewCount} to review</span> : null}
    </header>
    {loading ? <div className="attendance-continuity__state" role="status"><LoaderCircle className="spin" size={18} />Loading entries…</div> : null}
    {error ? <div className="attendance-continuity__state is-error" role="alert"><AlertTriangle size={18} />{error.message}</div> : null}
    {!loading && !error && !data ? <p className="attendance-continuity__state">Review status unavailable.</p> : null}
    {workspace && reviewCount === 0 ? <p className="attendance-continuity__empty"><CheckCircle2 size={20} />Nothing to review.</p> : null}
    {workspace && workspace.summary.pending > 0 ? <p className="attendance-continuity__state" role="status">{workspace.summary.pending} {workspace.summary.pending === 1 ? "entry awaiting" : "entries awaiting"} processing.</p> : null}
    {workspace?.cases.length ? <div className="attendance-review-list">{workspace.cases.map((item) => <article key={item.id} className="attendance-review-card" aria-labelledby={`review-title-${item.id}`}>
      <div className="attendance-review-card__main"><div><h3 id={`review-title-${item.id}`}>{item.class_name}</h3><p>{attendanceDate(item.date)} · {sourceLabels[item.source]}</p>{item.reason_code !== "source_requires_review" ? <p className="attendance-review-card__reason">{reviewLabels[item.reason_code] ?? item.reason}</p> : null}</div><button type="button" disabled={Boolean(busy)} aria-expanded={activeCase === item.id} aria-controls={`review-decision-${item.id}`} onClick={() => { setActiveCase(activeCase === item.id ? null : item.id); setReason(""); setActionError(""); }}>{activeCase === item.id ? "Close" : "Review"}<ChevronDown size={16} aria-hidden="true" /></button></div>
      {activeCase === item.id ? <div className="attendance-review-card__decision" id={`review-decision-${item.id}`}>
        <p>{item.reason}</p>
        <dl className="attendance-review-card__evidence">
          <div><dt>Recorded by</dt><dd>{item.recorded_by_name}</dd></div>
          <div><dt>Recorded at</dt><dd>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.observed_at))}</dd></div>
          <div><dt>Students</dt><dd>{item.roster_count}</dd></div>
          {item.source_reference ? <div><dt>Reference</dt><dd>{item.source_reference}</dd></div> : null}
          <div><dt>Current register</dt><dd>Revision {item.current_revision} · {item.register_state ?? "not submitted"}</dd></div>
        </dl>
        {item.register_state === "locked" ? <p className="attendance-review-card__warning"><AlertTriangle size={16} />Unlock this register before applying the entry.</p> : null}
        <label>Review note<textarea value={reason} disabled={Boolean(busy)} minLength={3} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="What did you check?" /></label>
        <p className="attendance-review-card__effect">Applying updates attendance. Rejecting leaves it unchanged. Both decisions are recorded.</p>
        {actionError ? <p className="attendance-review-card__error" role="alert">{actionError}</p> : null}
        <div className="attendance-review-card__actions"><button type="button" disabled={Boolean(busy) || reason.trim().length < 3} onClick={() => void decide(item.id, "reject", item.current_revision)}>{busy === "reject" ? <LoaderCircle className="spin" size={16} /> : null}Reject entry</button><button type="button" disabled={Boolean(busy) || reason.trim().length < 3 || item.register_state === "locked"} onClick={() => void decide(item.id, "accept", item.current_revision)}>{busy === "accept" ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}Apply to register</button></div>
      </div> : null}
    </article>)}</div> : null}
    {workspace && reviewCount > workspace.cases.length ? <p className="attendance-continuity__state">Showing {workspace.cases.length} of {reviewCount} entries. More appear as these are reviewed.</p> : null}
    <details className="attendance-paper-capture">
      <summary><FileInput size={20} aria-hidden="true" /><span>Enter a paper register</span><ChevronDown size={18} aria-hidden="true" /></summary>
      <div className="attendance-paper-capture__form">
        <p>{attendanceDate(date)} · Entries need review before updating attendance.</p>
        {selectedClass ? <><label>Class<span className="attendance-paper-capture__select"><select value={selectedClass} onChange={(event) => setPaperClass(event.target.value)}>{classes.map((item) => <option value={item.class_section_id} key={item.class_section_id}>{item.class_name}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></span></label><Link to={`/principal/attendance?class_section_id=${encodeURIComponent(selectedClass)}&date=${date}&source=paper`}>Enter sheet <ArrowRight size={16} /></Link></> : <p>No classes available for paper entry.</p>}
      </div>
    </details>
    {workspace && workspace.summary.accepted + workspace.summary.rejected > 0 ? <details className="attendance-continuity__processed">
      <summary><span>Processed · {attendanceDate(workspace.date)}</span><ChevronDown size={18} aria-hidden="true" /></summary>
      <dl><div><dt>Applied</dt><dd>{workspace.summary.accepted}</dd></div><div><dt>Rejected</dt><dd>{workspace.summary.rejected}</dd></div></dl>
    </details> : null}
  </section>;
}
