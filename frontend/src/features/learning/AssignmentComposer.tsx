import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { getAssignment, publishAssignment, saveAssignment, type AssignmentItem, type AssignmentList } from "./assignmentApi";
import { useAssignmentWrite } from "./useAssignmentWrite";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";

const localInstant = (value: string | null | undefined) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
export function AssignmentComposer({ list, initial, actorId, onClose, onSaved, refresh }: {
  list: AssignmentList; initial?: AssignmentItem; actorId: string; onClose: () => void; onSaved: (id: string) => void; refresh: () => Promise<unknown>;
}) {
  const environment = useExecutionEnvironment();
  const [source] = useState(() => initial?.id ?? crypto.randomUUID()), [revision, setRevision] = useState(initial?.revision ?? 0);
  const [title, setTitle] = useState(initial?.title ?? ""), [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [term, setTerm] = useState(initial?.term_id ?? list.terms?.[0]?.id ?? ""), [subject, setSubject] = useState(initial?.subject_id ?? (list.can_general ? "" : list.subjects?.[0]?.id ?? ""));
  const [reviewer, setReviewer] = useState(initial?.reviewer_id ?? actorId), [due, setDue] = useState(localInstant(initial?.due_at));
  const [cutoff, setCutoff] = useState(localInstant(initial?.cutoff_at)), [mode, setMode] = useState<AssignmentItem["submission_mode"]>(initial?.submission_mode ?? "either");
  const [limit, setLimit] = useState(initial?.max_attempts?.toString() ?? ""), [review, setReview] = useState(false), [dirty, setDirty] = useState(false);
  const [changedSource, setChangedSource] = useState<AssignmentItem | null>(null), [changedError, setChangedError] = useState("");
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const write = useAssignmentWrite(refresh), guard = useUnsavedChangesGuard(dirty || write.busy || write.locked, "Leave this assignment draft? Only saved work will be kept.");
  const preview = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["learning-assignments", list.class_section?.id, actorId, "publication-preview", source, revision]),
    queryFn: () => getAssignment(source), enabled: review && revision > 0 && !dirty });
  const audience = preview.data && (preview.data.context === "class" || preview.data.context === "offering") ? preview.data.publication_preview : null;
  const reviewers = [...new Map((list.reviewers ?? []).filter(person => !person.subject_id || person.subject_id === subject).map(person => [person.id, person])).values()];
  const reviewerName = reviewers.find(person => person.id === reviewer)?.name ?? "Choose a reviewer";
  const payload = { assignment_id: source, expected_revision: revision,
    ...(list.context === "offering" ? { context_kind: "learning_offering", offering_id: list.offering!.id } : { class_section_id: list.class_section!.id, term_id: term, subject_id: subject || null }), reviewer_id: reviewer, title, instructions,
    due_at: due ? new Date(due).toISOString() : null, cutoff_at: cutoff ? new Date(cutoff).toISOString() : null,
    submission_mode: mode, max_attempts: limit ? Number(limit) : null, policy_version: 1, resubmission_mode: "on_request" };
  const save = async () => write.run(`save:${JSON.stringify(payload)}`, id => saveAssignment({ ...payload, command_id: id }), result => { setRevision(result.revision); setSavedRevision(result.revision); setDirty(false); }, { sourceId: source, expectedRevision: revision });
  const publish = async () => {
    if (dirty || !revision) { if (!await save()) return; setReview(true); return; }
    if (!audience) return;
    await write.run(`publish:${source}:${revision}:${audience.audience_hash}`, id => publishAssignment(source, { command_id: id, expected_revision: revision, audience_hash: audience.audience_hash }), () => { setDirty(false); onSaved(source); }, { sourceId: source, expectedRevision: revision });
  };
  const change = () => { setDirty(true); setSavedRevision(null); setReview(false); };
  const valid = title.trim() && instructions.trim() && (list.context === "offering" || term) && reviewers.some(person => person.id === reviewer);
  return <PlannerDialog title={review ? "Publish assignment" : initial ? "Assignment draft" : "New assignment"} busy={write.busy} onClose={() => { if (!write.busy && guard()) onClose(); }}>
    <form className="learning-assignment-form" onSubmit={event => { event.preventDefault(); if (review) void publish(); else setReview(true); }}>
      <p className="learning-assignment-caption">{list.offering?.name ?? list.class_section?.label}</p>
      {review ? <section className="learning-assignment-review"><h3>{title}</h3><p className="learning-assignment-prose">{instructions}</p>
        <p>Reviewed by <strong>{reviewerName}</strong></p><p className="learning-assignment-caption">{mode === "text" ? "Text response" : mode === "files" ? "File submission" : "Text or files"}{due ? ` · Due ${new Date(due).toLocaleString()}` : " · No due date"}</p>
        {audience ? <p>{audience.count} {audience.count === 1 ? "learner" : "learners"} in this published audience</p> : !dirty && revision ? <p role={preview.error ? "alert" : "status"}>{preview.error ? "The current audience could not be loaded. Try again before publishing." : "Loading current audience…"}</p> : null}
        {preview.error ? <button type="button" onClick={() => void preview.refetch()}>Check audience</button> : null}
        <p className="learning-assignment-caption">{cutoff ? `Closes ${new Date(cutoff).toLocaleString()}.` : "Late submissions stay open."} {limit ? `Up to ${limit} attempts.` : "No attempt limit."} Another attempt needs a request for changes.</p>
        <p className="learning-assignment-caption">Publication fixes these instructions and the current {list.context === "offering" ? "group" : "class"} audience. No review deadline or automatic reminders.</p>
      </section> : <fieldset disabled={write.busy || write.locked}>
        <label>Title<input autoFocus required maxLength={180} value={title} onChange={event => { change(); setTitle(event.target.value); }} /></label>
        <label>Instructions<textarea required rows={5} maxLength={8000} value={instructions} onChange={event => { change(); setInstructions(event.target.value); }} /></label>
        {reviewers.length > 1 ? <label>Reviewer<select value={reviewer} onChange={event => { change(); setReviewer(event.target.value); }}><option value="">Choose a reviewer</option>{reviewers.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label> : <p className="learning-assignment-caption">Reviewer · {reviewerName}</p>}
        <details><summary>Options</summary><div className="learning-assignment-options">
          {list.terms && list.terms.length > 1 ? <label>Term<select value={term} onChange={event => { change(); setTerm(event.target.value); }}>{list.terms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
          {list.subjects?.length ? <label>Subject<select value={subject} onChange={event => { change(); setSubject(event.target.value); const eligible = [...new Map((list.reviewers ?? []).filter(person => !person.subject_id || person.subject_id === event.target.value).map(person => [person.id, person])).values()]; setReviewer(eligible.length === 1 ? eligible[0]!.id : ""); }}>{list.can_general ? <option value="">General class work</option> : null}{list.subjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
          <label>Response<select value={mode} onChange={event => { change(); setMode(event.target.value as AssignmentItem["submission_mode"]); }}><option value="either">Text or files</option><option value="text">Text only</option><option value="files">Files only</option></select></label>
          <label>Due <span className="learning-assignment-caption">Optional · {Intl.DateTimeFormat().resolvedOptions().timeZone}</span><TemporalInput type="datetime-local" value={due} onChange={event => { change(); setDue(event.target.value); }} /></label>
          <label>Submission cutoff <span className="learning-assignment-caption">Optional · late submissions close then</span><TemporalInput type="datetime-local" value={cutoff} onChange={event => { change(); setCutoff(event.target.value); }} /></label>
          <label>Attempt limit <span className="learning-assignment-caption">Optional</span><input type="number" min={1} max={100} value={limit} onChange={event => { change(); setLimit(event.target.value); }} /></label>
          <p className="learning-assignment-caption">Resubmission opens only when the reviewer requests changes.</p>
        </div></details>
      </fieldset>}
      {write.error ? <p role="alert">{write.error}</p> : null}{write.locked ? <button type="button" disabled={write.busy} onClick={() => {
        if (write.recovery !== "obsolete") { void write.recover(); return; }
        setChangedError(""); void getAssignment(source).then(value => { if (value.context === "class" || value.context === "offering") setChangedSource(value.item); }).catch(() => setChangedError("The current assignment could not be loaded. Your edits are kept."));
      }}>{write.recovery === "unknown" ? "Retry same action" : write.recovery === "obsolete" ? "Review current version" : "Refresh saved assignment"}</button> : null}
      {changedError ? <p role="alert">{changedError}</p> : null}
      {write.recovery === "obsolete" && changedSource && changedSource.revision >= (write.obsoleteRevision ?? Infinity) ? <section className="learning-assignment-review"><h3>Current assignment</h3><strong>{changedSource.title}</strong><p className="learning-assignment-prose">{changedSource.instructions}</p>
        {changedSource.state === "published" ? <button type="button" onClick={() => onSaved(source)}>Open published assignment</button> : <div className="learning-assignment-actions"><button type="button" onClick={() => {
          setTitle(changedSource.title); setInstructions(changedSource.instructions); setTerm(changedSource.term_id ?? ""); setSubject(changedSource.subject_id ?? ""); setReviewer(changedSource.reviewer_id);
          setDue(localInstant(changedSource.due_at)); setCutoff(localInstant(changedSource.cutoff_at)); setMode(changedSource.submission_mode); setLimit(changedSource.max_attempts?.toString() ?? "");
          setRevision(changedSource.revision); setDirty(false); setReview(false); setChangedSource(null); write.resolveObsolete();
        }}>Use saved draft</button><button type="button" onClick={() => { setRevision(changedSource.revision); setDirty(true); setReview(false); setChangedSource(null); write.resolveObsolete(); }}>Keep my edits and review again</button></div>}
      </section> : null}
      {savedRevision === revision && !dirty && !write.busy && !write.locked && !write.error && write.recovery === "none" ? <p role="status" className="learning-assignment-caption">Draft saved</p> : null}
      <footer className="learning-assignment-actions"><button type="button" disabled={write.busy || !valid || write.locked} onClick={() => { if (review) setReview(false); else void save(); }}>{review ? "Back" : "Save draft"}</button>
        <button type="submit" disabled={write.busy || write.locked || !valid || Boolean(review && !dirty && revision && !audience)}>{write.busy ? "Saving…" : review ? dirty || !revision ? "Save and review" : "Publish assignment" : "Review"}</button></footer>
    </form>
  </PlannerDialog>;
}
