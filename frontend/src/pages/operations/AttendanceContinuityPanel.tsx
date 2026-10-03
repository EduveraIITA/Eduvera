import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardPenLine, FileInput, LoaderCircle, RotateCcw, ShieldAlert } from "lucide-react";
import type { AttendanceContinuityWorkspace, TeacherClassSummary } from "../../features/operations/api";

const sourceLabels = {
  live_app: "Live app",
  offline_device: "Offline device",
  paper: "Paper register",
  office: "Office entry",
};

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

  const decide = async (caseId: string, decision: "accept" | "reject", expectedRevision: number) => {
    if (reason.trim().length < 3 || busy) return;
    setBusy(decision);
    setActionError("");
    try {
      await onDecision(caseId, decision, reason.trim(), expectedRevision);
      setActiveCase(null);
      setReason("");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "This observation could not be reconciled.");
    } finally {
      setBusy(null);
    }
  };

  return <section className="attendance-continuity" aria-labelledby="attendance-continuity-heading">
    <header className="attendance-continuity__header">
      <div><span>Operational continuity</span><h2 id="attendance-continuity-heading">Evidence and reconciliation</h2><p>Offline and paper observations stay separate until they are verified against the live register.</p></div>
      <span className={`attendance-continuity__badge${data?.summary.quarantined ? " has-review" : ""}`}><ShieldAlert size={15} />{data?.summary.quarantined ?? 0} need review</span>
    </header>
    <div className="attendance-continuity__summary" aria-label="Attendance capture status">
      <div><CheckCircle2 size={18} /><span>Accepted for date</span><strong>{data?.summary.accepted ?? 0}</strong></div>
      <div><AlertTriangle size={18} /><span>Quarantined</span><strong>{data?.summary.quarantined ?? 0}</strong></div>
      <div><RotateCcw size={18} /><span>Syncing</span><strong>{data?.summary.pending ?? 0}</strong></div>
    </div>
    <div className="attendance-paper-capture">
      <div><FileInput size={20} /><span><strong>Record a paper register</strong><small>Enter the sheet, then verify it here before publishing.</small></span></div>
      <label><span className="sr-only">Class for paper register</span><select value={paperClass} onChange={(event) => setPaperClass(event.target.value)}>{classes.map((item) => <option value={item.class_section_id} key={item.class_section_id}>{item.class_name}</option>)}</select></label>
      {paperClass ? <Link to={`/principal/attendance?class_section_id=${encodeURIComponent(paperClass)}&date=${date}&source=paper`}>Enter sheet <ArrowRight size={16} /></Link> : null}
    </div>
    {loading ? <div className="attendance-continuity__state" role="status"><LoaderCircle className="spin" size={18} /> Loading reconciliation queue…</div> : null}
    {error ? <div className="attendance-continuity__state is-error" role="alert"><AlertTriangle size={18} />{error.message}</div> : null}
    {!loading && !error && data?.cases.length === 0 ? <div className="attendance-continuity__empty"><CheckCircle2 size={22} /><div><strong>No observations need review</strong><p>Offline captures that match the current roster and revision are accepted automatically.</p></div></div> : null}
    {data?.cases.length ? <div className="attendance-review-list">{data.cases.map((item) => <article key={item.id} className="attendance-review-card">
      <div className="attendance-review-card__main"><span className="attendance-review-card__icon"><ClipboardPenLine size={19} /></span><div><span>{sourceLabels[item.source]} · {item.class_name}</span><h3>{item.reason}</h3><p>{item.recorded_by_name} · {item.roster_count} students · observed {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.observed_at))}</p>{item.source_reference ? <small>Reference: {item.source_reference}</small> : null}</div><button type="button" aria-expanded={activeCase === item.id} onClick={() => { setActiveCase(activeCase === item.id ? null : item.id); setReason(""); setActionError(""); }}>{activeCase === item.id ? "Close" : "Review"}</button></div>
      {activeCase === item.id ? <div className="attendance-review-card__decision">
        <p><strong>Current register:</strong> revision {item.current_revision}{item.register_state ? ` · ${item.register_state}` : " · not submitted"}. Applying this observation creates a fully audited revision.</p>
        {item.register_state === "locked" ? <p className="attendance-review-card__warning"><AlertTriangle size={15} />Unlock this register before applying the observation.</p> : null}
        <label>Decision note<textarea value={reason} minLength={3} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="What did you verify against the paper sheet, teacher, or current roster?" /></label>
        {actionError ? <p className="attendance-review-card__error" role="alert">{actionError}</p> : null}
        <div><button type="button" disabled={Boolean(busy) || reason.trim().length < 3} onClick={() => void decide(item.id, "reject", item.current_revision)}>{busy === "reject" ? <LoaderCircle className="spin" size={15} /> : null}Reject observation</button><button type="button" disabled={Boolean(busy) || reason.trim().length < 3 || item.register_state === "locked"} onClick={() => void decide(item.id, "accept", item.current_revision)}>{busy === "accept" ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}Apply to register</button></div>
      </div> : null}
    </article>)}</div> : null}
  </section>;
}
