import { useRef, useState } from "react";
import { Download, Paperclip, X } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { assignmentFileHref, detachAssignmentFile, reviewAssignmentWork, saveAssignmentWork, submitAssignmentWork, uploadAssignmentFile, type AssignmentAttempt, type AssignmentWork } from "./assignmentApi";
import { useAssignmentWrite } from "./useAssignmentWrite";

const labels = { not_started: "To do", draft: "Draft", submitted: "Awaiting review", changes_requested: "Changes requested", reviewed: "Reviewed" };
function Attempt({ attempt, assignmentId, learnerId, person }: { attempt: AssignmentAttempt; assignmentId: string; learnerId: string; person: boolean }) {
  return <article className="learning-assignment-attempt"><header><strong>Attempt {attempt.attempt_number}</strong><span>{new Date(attempt.submitted_at).toLocaleString()}{attempt.late ? " · Late" : ""}</span></header>
    {attempt.body ? <p className="learning-assignment-prose">{attempt.body}</p> : null}
    {attempt.files.map(file => <a className="learning-assignment-file" download key={file.id} href={assignmentFileHref(assignmentId, learnerId, file.id, person ? "person" : "student")}><Download size={18} aria-hidden="true" /><span>{file.original_name}<small>{Math.ceil(file.size_bytes / 1024)} KiB</small></span></a>)}
    {attempt.review ? <section className="learning-assignment-feedback"><strong>{attempt.review.decision === "request_changes" ? "Changes requested" : "Reviewed"}</strong><p className="learning-assignment-prose">{attempt.review.feedback}</p><small>{new Date(attempt.review.reviewed_at).toLocaleString()}</small></section> : <p className="learning-assignment-caption">Submitted · waiting for the assigned reviewer</p>}
    <details><InfoSummary>Submission receipt</InfoSummary><p className="learning-assignment-receipt">{attempt.id}<br />SHA-256 {attempt.manifest_hash}</p></details>
  </article>;
}

export function AssignmentWorkView({ data, readOnly, refresh, onLeave }: { data: AssignmentWork; readOnly: boolean; refresh: () => Promise<unknown>; onLeave?: () => void }) {
  const [body, setBody] = useState(data.draft?.body ?? ""), [reviewing, setReviewing] = useState(false), [feedback, setFeedback] = useState("");
  const [decision, setDecision] = useState<"reviewed" | "request_changes">("reviewed"), [submitReview, setSubmitReview] = useState(false);
  const attemptId = useRef(crypto.randomUUID()), reviewId = useRef(crypto.randomUUID()), upload = useRef<{ file: File; id: string } | null>(null);
  const draftRevision = useRef(data.draft?.revision ?? 0);
  const [visibleDraftRevision, setVisibleDraftRevision] = useState(data.draft?.revision ?? 0);
  const advanceDraft = (revision: number) => { draftRevision.current = revision; setVisibleDraftRevision(revision); };
  const write = useAssignmentWrite(refresh), dirty = body !== (data.draft?.body ?? "") || Boolean(feedback.trim());
  const guard = useUnsavedChangesGuard(dirty || write.busy || write.locked, "Leave this assignment? Only saved work will be kept.");
  const disabled = readOnly || write.busy || write.locked, last = data.attempts[0];
  const person = data.item.context_kind === "learning_offering", learner = person ? data.learner : data.student;
  const identityKind = person ? "person" : "student";
  if (!learner) return <p role="alert">This learner’s identity could not be loaded. Refresh the assignment before continuing.</p>;
  const attemptLimitReached = data.item.max_attempts !== null && Boolean(last && last.attempt_number >= data.item.max_attempts);
  const save = async () => write.run(`save:${draftRevision.current}:${body}`, id => saveAssignmentWork(data.item.id, learner.id,
    { command_id: id, expected_revision: draftRevision.current, body }, identityKind), result => { advanceDraft(result.revision); }, { sourceId: data.item.id, expectedRevision: draftRevision.current });
  const attach = async (file: File) => {
    // Keep upload selection/identity for exact retry; an attachment never submits work.
    upload.current = { file, id: crypto.randomUUID() };
    if (body !== (data.draft?.body ?? "") || !data.draft?.revision) { if (!await save()) return; }
    const selected = upload.current;
    if (!selected) return;
    await write.run(`upload:${draftRevision.current}:${selected.id}`, id => {
      const form = new FormData(); form.set("command_id", id); form.set("file_id", selected.id); form.set("expected_revision", String(draftRevision.current)); form.set("file", selected.file);
      return uploadAssignmentFile(data.item.id, learner.id, form, identityKind);
    }, result => { upload.current = null; advanceDraft(result.revision); }, { sourceId: data.item.id, expectedRevision: draftRevision.current });
  };
  const submit = async () => write.run(`submit:${data.draft?.revision}:${attemptId.current}`, id => submitAssignmentWork(data.item.id, learner.id,
    { command_id: id, expected_revision: data.draft?.revision ?? 0, attempt_id: attemptId.current }, identityKind), result => { advanceDraft(result.revision); setSubmitReview(false); attemptId.current = crypto.randomUUID(); }, { sourceId: data.item.id, expectedRevision: data.draft?.revision ?? 0 });
  const review = async () => {
    if (!last) return;
    await write.run(`review:${last.id}:${decision}:${feedback}`, id => reviewAssignmentWork(data.item.id, learner.id,
      { command_id: id, expected_revision: last.attempt_number, attempt_id: last.id, review_id: reviewId.current, decision, feedback }, identityKind), () => { setReviewing(false); setFeedback(""); reviewId.current = crypto.randomUUID(); }, { sourceId: data.item.id, expectedRevision: last.attempt_number });
  };
  return <div className="learning-assignment-work">
    <div className="learning-assignment-status"><strong>{learner.name}</strong><span>{labels[data.state]}</span></div>
    {data.item.due_at || data.item.cutoff_at ? <p className="learning-assignment-caption">{data.item.due_at ? `Due ${new Date(data.item.due_at).toLocaleString()}` : "No due date"}{data.item.cutoff_at ? ` · Closes ${new Date(data.item.cutoff_at).toLocaleString()}` : " · Late submissions stay open"}</p> : null}
    <p className="learning-assignment-prose">{data.item.instructions}</p>
    {readOnly ? <p className="learning-assignment-caption">This Simulation is read-only.</p> : null}
    {data.can_write && !readOnly ? <section className="learning-assignment-response" aria-label="Draft response">
      {submitReview ? <><h3>Submit this attempt?</h3>{body ? <p className="learning-assignment-prose">{body}</p> : null}<p>{data.files.length} attached {data.files.length === 1 ? "file" : "files"}</p>
        <p className="learning-assignment-caption">Your submitted text and files stay unchanged. Another attempt opens only if the reviewer requests changes.</p>
      <div className="learning-assignment-actions"><button disabled={write.busy || write.locked} onClick={() => setSubmitReview(false)}>Back</button><button disabled={write.busy || write.locked} onClick={() => void submit()}>{write.busy ? "Submitting…" : "Submit assignment"}</button></div>
      </> : <>
        <div className="learning-assignment-label">{data.item.submission_mode === "files" ? <strong>Your files</strong> : <label htmlFor="assignment-response">Your response</label>}{data.item.submission_mode !== "text" ? <label className="learning-assignment-upload"><Paperclip size={18} aria-hidden="true" />Attach file<input type="file" disabled={disabled} accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.md,.py,.js,.ts,.java,.c,.cpp,.html,.css" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void attach(file).catch(() => undefined); }} /></label> : null}</div>
        {data.item.submission_mode !== "files" ? <textarea id="assignment-response" rows={6} maxLength={12000} value={body} disabled={disabled} onChange={event => setBody(event.target.value)} /> : null}
        {data.files.map(file => <div className="learning-assignment-file" key={file.id}><Paperclip size={18} aria-hidden="true" /><span>{file.original_name}<small>{Math.ceil(file.size_bytes / 1024)} KiB</small></span><button className="learning-assignment-icon" aria-label={`Remove ${file.original_name} from draft`} disabled={disabled} onClick={() => void write.run(`detach:${file.id}:${draftRevision.current}`, id => detachAssignmentFile(data.item.id, learner.id, file.id, { command_id: id, expected_revision: draftRevision.current }, identityKind), result => { advanceDraft(result.revision); }, { sourceId: data.item.id, expectedRevision: draftRevision.current })}><X size={18} /></button></div>)}
        <p className="learning-assignment-caption" role="status">{body !== (data.draft?.body ?? "") ? "Unsaved changes" : data.draft?.updated_at ? `Saved ${new Date(data.draft.updated_at).toLocaleTimeString()}` : "Drafts are private to you"}</p>
        <div className="learning-assignment-actions"><button disabled={disabled} onClick={() => void save()}>{write.busy ? "Saving…" : "Save draft"}</button><button disabled={disabled || data.can_submit === false || body !== (data.draft?.body ?? "") || !data.draft?.revision || !body.trim() && !data.files.length} onClick={() => setSubmitReview(true)}>Review submission</button></div>
        <details><InfoSummary>File details</InfoSummary><p className="learning-assignment-caption">Up to 3 files per attempt · 5 MiB each. PDF, images or UTF-8 text/code. At most 20 uploaded files are retained per learner for this assignment. Uploaded does not mean submitted.</p></details>
      </>}
    </section> : null}
    {data.attempts.length ? <section aria-label="Submitted attempts"><h3>{data.state === "reviewed" ? "Reviewed work" : "Submitted work"}</h3>{data.attempts.map(attempt => <Attempt key={attempt.id} attempt={attempt} assignmentId={data.item.id} learnerId={learner.id} person={person} />)}</section> : !data.can_write ? <p className="learning-assignment-caption">No submission yet. Saved drafts are private to the learner.</p> : null}
    {data.can_review && !readOnly ? <section className="learning-assignment-review-action">{!reviewing ? <button onClick={() => setReviewing(true)}>Review attempt {last?.attempt_number}</button> : <><h3>Your review</h3><label>Feedback<textarea autoFocus rows={4} maxLength={4000} value={feedback} disabled={disabled} onChange={event => setFeedback(event.target.value)} /></label>
      <fieldset disabled={disabled} className="learning-assignment-decisions"><legend>Next step</legend><label><input type="radio" name="assignment-review" checked={decision === "reviewed"} onChange={() => setDecision("reviewed")} />Reviewed</label>{attemptLimitReached || data.can_request_changes === false ? <span className="learning-assignment-caption">{attemptLimitReached ? "Attempt limit reached" : "Another attempt is unavailable"}</span> : <label><input type="radio" name="assignment-review" checked={decision === "request_changes"} onChange={() => setDecision("request_changes")} />Request changes</label>}</fieldset>
      <div className="learning-assignment-actions"><button disabled={write.busy || write.locked} onClick={() => { setReviewing(false); setFeedback(""); }}>Cancel</button><button disabled={disabled || !feedback.trim()} onClick={() => void review()}>{write.busy ? "Saving…" : decision === "reviewed" ? "Finish review" : "Send request"}</button></div></>}</section> : null}
    {write.error ? <p role="alert">{write.error}</p> : null}{write.error || write.locked ? <button disabled={write.busy} onClick={() => void write.recover()}>{write.recovery === "unknown" ? "Retry same action" : "Refresh saved work"}</button> : null}
    {data.submission_blocked_reason ? <p role="status" className="learning-assignment-caption">{data.submission_blocked_reason}</p> : null}
    {write.recovery === "obsolete" && !data.can_write && !data.can_review && last && (last.review || (data.draft?.revision ?? 0) >= (write.obsoleteRevision ?? Infinity)) ? <section><h3>Your text is kept</h3><p className="learning-assignment-prose">{feedback || body}</p><button disabled={write.busy} onClick={() => { setReviewing(false); setSubmitReview(false); write.resolveObsolete(); }}>Continue with saved work</button></section> : null}
    {data.draft && data.draft.revision > visibleDraftRevision ? <div role="status"><p>The saved draft changed. Your text is still here.</p><button disabled={write.busy || write.locked && (write.recovery !== "obsolete" || data.draft.revision < (write.obsoleteRevision ?? Infinity))} onClick={() => { setBody(data.draft!.body); advanceDraft(data.draft!.revision); write.resolveObsolete(); setSubmitReview(false); }}>Use saved draft</button>{write.recovery === "obsolete" && data.draft.revision >= (write.obsoleteRevision ?? Infinity) ? <button disabled={write.busy} onClick={() => { advanceDraft(data.draft!.revision); write.resolveObsolete(); setSubmitReview(false); }}>Keep my text and review again</button> : null}</div> : null}
    {write.recovery === "obsolete" && data.can_review && last && last.attempt_number >= (write.obsoleteRevision ?? Infinity) ? <button disabled={write.busy} onClick={() => { setReviewing(false); reviewId.current = crypto.randomUUID(); write.resolveObsolete(); }}>Review latest attempt</button> : null}
    {onLeave ? <button disabled={write.busy} onClick={() => { if (guard()) onLeave(); }}>Back to assignment</button> : null}
  </div>;
}
