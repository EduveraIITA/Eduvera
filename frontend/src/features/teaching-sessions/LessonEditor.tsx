import { useState } from "react";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { saveTeachingLesson, type TeachingSessionDetail } from "./api";
import { useTeachingSessionWrite } from "./useTeachingSessionWrite";

export function LessonEditor({ data, refresh, onClose, onAccessLost }: { data: TeachingSessionDetail; refresh: () => Promise<TeachingSessionDetail>; onClose: () => void; onAccessLost?: () => void }) {
  const [source, setSource] = useState(data), [topic, setTopic] = useState(data.lesson.topic), [notes, setNotes] = useState(data.lesson.learner_notes);
  const [preparation, setPreparation] = useState(data.lesson.preparation ?? ""), [reason, setReason] = useState("");
  const [current, setCurrent] = useState<TeachingSessionDetail | null>(null), [reviewing, setReviewing] = useState(false), [reviewError, setReviewError] = useState("");
  const write = useTeachingSessionWrite(refresh, onAccessLost);
  const dirty = topic !== source.lesson.topic || notes !== source.lesson.learner_notes || preparation !== (source.lesson.preparation ?? "") || Boolean(reason);
  const guard = useUnsavedChangesGuard(dirty || write.busy || write.locked, "Leave this lesson? Keep this screen while an unconfirmed save is resolved. Only confirmed work is kept.");
  const disabled = write.busy || write.locked || reviewing;
  const correction = source.lesson.state === "reported";
  const save = async (state: "prepared" | "reported") => {
    if (disabled) return;
    const input = { expected_revision: source.lesson.revision, source_fingerprint: source.session.source_fingerprint, preparation, topic, learner_notes: notes, state, ...(correction ? { reason: reason.trim() } : {}) };
    if (await write.run(JSON.stringify(input), command_id => saveTeachingLesson(source.session.id, source.session.date, { command_id, ...input }), { sourceId: source.session.id, revision: source.lesson.revision, fingerprint: source.session.source_fingerprint })) onClose();
  };
  const review = async () => {
    setReviewing(true); setReviewError("");
    try { const fresh = await refresh(); if (fresh.capabilities.can_manage && fresh.session.state === "expected") setCurrent(fresh); else setReviewError("You can no longer change this session. Your local text has not been sent again."); }
    catch { setReviewError("The current session could not load. Your text is kept."); }
    finally { setReviewing(false); }
  };
  return <PlannerDialog title={correction ? "Correct lesson record" : "Record lesson"} busy={write.busy || reviewing} onClose={() => { if (!write.busy && !reviewing && guard()) onClose(); }}>
    <div className="teaching-session-form">
      <p className="teaching-caption">{source.session.group_label}</p>
      <fieldset disabled={disabled}>
        <label>Topic taught<input autoFocus maxLength={180} value={topic} onChange={event => setTopic(event.target.value)} /></label>
        <label>Notes for learners<textarea rows={4} maxLength={8000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <details><summary>Teacher preparation <span className="teaching-caption">Private to instructors</span></summary><label>Preparation<textarea rows={4} maxLength={8000} value={preparation} onChange={event => setPreparation(event.target.value)} /></label></details>
        {correction ? <label>Reason for correction<textarea rows={2} required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label> : null}
      </fieldset>
      <p className="teaching-caption">{correction ? "The earlier record stays in history." : "Save preparation privately, or report what you taught. Reporting shares the topic and learner notes."}</p>
      {write.error ? <p role="alert" className="teaching-error">{write.error}</p> : null}
      {write.recovery === "unknown" || write.recovery === "accepted" ? <button type="button" disabled={write.busy} onClick={() => { void write.recover().then(saved => { if (saved) onClose(); }); }}>{write.recovery === "unknown" ? "Retry same action" : "Refresh saved session"}</button> : null}
      {write.recovery === "obsolete" ? <button type="button" disabled={reviewing} onClick={() => void review()}>Review current version</button> : null}
      {reviewError ? <p role="alert">{reviewError}</p> : null}
      {current ? <section className="teaching-review" aria-label="Current saved lesson"><h3>Saved lesson</h3><strong>{current.lesson.topic || "No reported topic"}</strong><p className="teaching-prose">{current.lesson.learner_notes}</p><p className="teaching-caption">{current.session.place_label ?? "Place not assigned"} · {current.session.teacher_name ?? "Teacher not assigned"}</p><div className="teaching-actions"><button type="button" onClick={() => {
        setSource(current); setTopic(current.lesson.topic); setNotes(current.lesson.learner_notes); setPreparation(current.lesson.preparation ?? ""); setReason(""); setCurrent(null); write.resolveObsolete();
      }}>Use saved lesson</button><button type="button" onClick={() => { setSource(current); setCurrent(null); write.resolveObsolete(); }}>Keep my text</button></div></section> : null}
      <footer className="teaching-actions">
        <button type="button" disabled={write.busy || reviewing} onClick={() => { if (guard()) onClose(); }}>Cancel</button>
        {!correction ? <button type="button" disabled={disabled} onClick={() => void save("prepared")}>Save preparation</button> : null}
        <button type="button" className="is-primary" disabled={disabled || !topic.trim() || correction && reason.trim().length < 3} onClick={() => void save("reported")}>{write.busy ? "Saving…" : correction ? "Save correction" : "Report taught"}</button>
      </footer>
    </div>
  </PlannerDialog>;
}
