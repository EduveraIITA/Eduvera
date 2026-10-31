import { useRef, useState, type FormEvent } from "react";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { decideActivityEvidence, reportActivityEvidence, type ActivityRegister, type ParticipationStatus } from "./api";

export function ActivityEvidenceReview({ schoolId, register, disabled, onAccepted }: { schoolId: string; register: ActivityRegister; disabled: boolean; onAccepted: (register: ActivityRegister, message: string) => Promise<void> }) {
  const [report, setReport] = useState(false);
  const [person, setPerson] = useState("");
  const [status, setStatus] = useState<ParticipationStatus>("present");
  const [observed, setObserved] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [review, setReview] = useState<string | null>(null);
  const [decision, setDecision] = useState<"accepted" | "rejected">("accepted");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const changed = () => { key.current = crypto.randomUUID(); setError(""); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const next = review ? await decideActivityEvidence(schoolId, register.register.id, review, { expected_revision: register.register.revision, decision, reason }, key.current) : await reportActivityEvidence(schoolId, register.register.id, { expected_revision: register.register.revision, person_id: person, claimed_status: status, capture_channel: "offline_paper", observed_at: new Date(observed).toISOString(), source_reference: reference, note }, key.current);
      await onAccepted(next, review ? "Evidence review recorded." : "Paper report saved for review. It is not an accepted attendance decision yet.");
      setReport(false); setReview(null); changed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This report was not confirmed. Your input is retained."); } finally { setBusy(false); }
  };
  const evidence = register.pending_evidence.find((item) => item.id === review);
  return <>
    {register.capabilities.can_record ? <button type="button" className="activity-text-button" disabled={disabled} onClick={() => { changed(); setReport(true); }}>Record a paper / late report</button> : null}
    {register.pending_evidence.length ? <section className="activity-evidence"><h3>Reported evidence · {register.pending_evidence.length}</h3><p>Reports are pending review, not accepted attendance.</p>{register.pending_evidence.map((item) => <article key={item.id}><strong>{item.name} · {item.claimed_status.replaceAll("_", " ")}</strong><p>{item.capture_channel.replaceAll("_", " ")} · observed {new Date(item.observed_at).toLocaleString()} · received {new Date(item.received_at).toLocaleString()}</p><p>{item.note}</p>{register.capabilities.can_review_evidence ? <button type="button" className="activity-text-button" disabled={disabled} onClick={() => { changed(); setReason(""); setDecision("accepted"); setReview(item.id); }}>Review report</button> : null}</article>)}</section> : null}
    {report || review ? <PlannerDialog title={review ? "Review participation report" : "Record a paper report"} busy={busy} onClose={() => { setReport(false); setReview(null); }}><form className="activity-form" onSubmit={(event) => void submit(event)}>
      {review ? <><p>{evidence?.name} · reported {evidence?.claimed_status.replaceAll("_", " ")}. Review the source and observed time before accepting it.</p><label>Decision<select value={decision} onChange={(event) => { changed(); setDecision(event.target.value as "accepted" | "rejected"); }}><option value="accepted">Accept as attendance evidence</option><option value="rejected">Reject this report</option></select></label><label>Review reason<textarea required minLength={3} maxLength={500} value={reason} onChange={(event) => { changed(); setReason(event.target.value); }} /></label></> : <>
        <label>Participant<select required value={person} onChange={(event) => { changed(); setPerson(event.target.value); }}><option value="">Choose a participant</option>{register.roster.map((row) => <option key={row.person_id} value={row.person_id}>{row.name}</option>)}</select></label>
        <label>Reported attendance<select value={status} onChange={(event) => { changed(); setStatus(event.target.value as ParticipationStatus); }}>{register.allowed_statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label>Observed at<TemporalInput required type="datetime-local" value={observed} onChange={(event) => { changed(); setObserved(event.target.value); }} /></label><p>Enter the actual observation time in this device's timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. The server checks it against the activity interval.</p>
        <label>Paper / source reference <span className="activity-optional">Optional</span><input maxLength={160} value={reference} onChange={(event) => { changed(); setReference(event.target.value); }} /></label><label>What supports this report?<textarea required minLength={3} maxLength={500} value={note} onChange={(event) => { changed(); setNote(event.target.value); }} /></label><p>The report remains pending until its appointed reviewer accepts or rejects it. Do not use this for a device or camera identity.</p>
      </>}
      {error ? <p className="activity-error" role="alert">{error}</p> : null}<footer><button type="button" className="is-secondary" disabled={busy} onClick={() => { setReport(false); setReview(null); }}>Cancel</button><button type="submit" disabled={busy || disabled}>{busy ? "Saving…" : review ? "Save review" : "Submit report for review"}</button></footer>
    </form></PlannerDialog> : null}
  </>;
}
