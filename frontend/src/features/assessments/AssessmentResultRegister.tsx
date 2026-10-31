import { previewConfiguredGrade } from "../academic-reports/resultPresentation";
import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { saveAssessmentResults, uploadAssessmentEvidence, type AssessmentDetail, type AssessmentResult, type ResultOutcome } from "./api";
import { useOptionalAuth } from "../auth/AuthContext";

interface ResultDraft {
  outcome: ResultOutcome;
  marks: string;
  grade: string;
  feedback: string;
  sourceRevision: number;
  sourceAssessmentRevision?: number;
  reason?: string;
}

const nice = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const draftFor = (result: AssessmentResult): ResultDraft => ({
  outcome: result.outcome, marks: result.marks ?? "", grade: result.grade,
  feedback: result.feedback, sourceRevision: result.revision,
});

export function AssessmentResultRegister({ schoolId, detail, editable, refresh, readOnly = false, pendingAction = false, onStateChange, actorId: suppliedActorId }: {
  schoolId: string; detail: AssessmentDetail; editable: boolean; refresh: () => Promise<void>;
  readOnly?: boolean; onStateChange?: (state: { dirty: boolean; pending: boolean }) => void;
  actorId?: string;
  pendingAction?: boolean;
}) {
  const auth = useOptionalAuth();
  const actorId = suppliedActorId ?? auth?.user?.id;
  // Only edited rows have drafts. Clean rows always reflect the latest server result.
  const [drafts, setDrafts] = useState<Record<string, ResultDraft>>({});
  const [busy, setBusy] = useState("");
  const inFlight = useRef(false);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const correction = correcting || detail.assessment.status === "marking" && detail.publications.length > 0;
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const canRecord = (detail.viewer_role === "admin" || detail.viewer_role === "examiner") && actorId !== detail.assessment.moderator_user_id;
  const editing = !readOnly && canRecord && (editable || correcting && detail.assessment.status === "published");
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => { onStateChange?.({ dirty, pending: Boolean(busy) || pendingAction }); }, [busy, dirty, onStateChange, pendingAction]);
  useEffect(() => () => { onStateChange?.({ dirty: false, pending: false }); }, [onStateChange]);
  const change = (result: AssessmentResult, patch: Partial<ResultDraft>) => {
    setDrafts(current => ({ ...current, [result.id]: { ...(current[result.id] ?? { ...draftFor(result), sourceAssessmentRevision: detail.assessment.revision }), ...patch } }));
    setError(null);
  };
  const discard = (id: string) => {
    setDrafts(current => { const next = { ...current }; delete next[id]; return next; });
    setError(null);
  };

  async function save(result: AssessmentResult) {
    if (inFlight.current || !editing) return;
    const value = drafts[result.id] ?? draftFor(result);
    const fail = (message: string) => setError({ id: result.id, message });
    if (value.sourceRevision !== result.revision || correction && value.sourceAssessmentRevision !== undefined && value.sourceAssessmentRevision !== detail.assessment.revision) {
      fail("This result changed. Review the saved result before saving."); return;
    }
    if (correction && (value.reason?.trim().length ?? 0) < 3) {
      fail("Add a reason for this correction."); return;
    }
    if (correction && value.outcome === result.outcome && (value.outcome !== "scored" || Number(value.marks) === Number(result.marks))
      && value.grade === result.grade && value.feedback === result.feedback) {
      fail("Change a result before saving a correction."); return;
    }
    if (value.outcome === "unrecorded") {
      fail("Enter marks or choose an outcome before saving."); return;
    }
    const marks = value.outcome === "scored" ? Number(value.marks) : null;
    if (value.outcome === "scored" && (!value.marks.trim() || !Number.isFinite(marks)
      || marks! < 0 || marks! > Number(detail.assessment.maximum_marks))) {
      fail(`Enter marks between 0 and ${detail.assessment.maximum_marks}.`); return;
    }
    inFlight.current = true; setBusy(result.id); setError(null);
    try {
      await saveAssessmentResults(schoolId, detail.assessment.id, detail.assessment.revision, [{
        result_id: result.id, outcome: value.outcome, marks, grade: value.grade, feedback: value.feedback,
        expected_revision: value.sourceRevision,
        reason: correction ? value.reason!.trim() : result.outcome === "unrecorded" ? "Initial marks entry" : "Reviewed result correction",
      }]);
      if (!active.current) return;
      await refresh();
      if (!active.current) return;
      discard(result.id);
    } catch (cause) {
      if (active.current) fail(cause instanceof Error ? cause.message : "Couldn’t save this result. Try again.");
    } finally { inFlight.current = false; if (active.current) setBusy(""); }
  }

  async function upload(result: AssessmentResult, file: File) {
    if (inFlight.current || !editing || detail.assessment.status === "published") return;
    inFlight.current = true; setBusy(`file-${result.id}`); setError(null);
    let accepted = false;
    try {
      const uploaded = await uploadAssessmentEvidence(schoolId, detail.assessment.id, result.id, file, "Supporting assessment evidence");
      accepted = true;
      if (!active.current) return;
      if (uploaded.result_id === result.id && uploaded.assessment_revision === detail.assessment.revision + 1) {
        setDrafts(current => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, value.sourceAssessmentRevision === detail.assessment.revision ? { ...value, sourceAssessmentRevision: uploaded.assessment_revision } : value])));
      }
      await refresh();
    } catch (cause) {
      if (active.current) setError({ id: result.id, message: accepted ? "Evidence added. The register couldn’t be refreshed. Try refreshing before adding it again." : cause instanceof Error ? cause.message : "Couldn’t add evidence. Try again." });
    } finally { inFlight.current = false; if (active.current) setBusy(""); }
  }

  return <div className="assessment-register" role="region" aria-labelledby="assessment-results-heading">
    <header><div><h3 id="assessment-results-heading">Results</h3><span>{detail.results.filter(r => r.outcome !== "unrecorded").length} of {detail.results.length} recorded</span><small>{detail.assessment.evidence_requirement === "none" ? "Evidence not collected" : `Evidence ${detail.assessment.evidence_requirement}`}</small></div>{!readOnly && detail.assessment.status === "published" && canRecord && !correcting
      ? <button type="button" className="assessment-correction-trigger" onClick={() => setCorrecting(true)}>Correct results</button>
      : null}</header>
    {detail.assessment.result_policy ? <p className="assessment-policy-caption">{detail.assessment.result_policy.name} · version {detail.assessment.result_policy.version}. Grades and points are calculated from marks using this fixed policy.</p> : null}
    {correction ? <div className="assessment-correction-context"><p role="status">Corrections need moderation and a new release. The current published result stays visible to families.</p>{detail.assessment.status === "published" ? <button type="button" disabled={Boolean(busy)} onClick={() => {
      if (dirty && !window.confirm("Discard these unsaved corrections? The published result will stay unchanged.")) return;
      setDrafts({}); setError(null); setCorrecting(false);
    }}>Cancel correction</button> : null}</div> : null}
    {dirty && !editing ? <div className="assessment-result-recovery"><p className="assessment-error" role="alert">This register is now read-only. Your unsaved changes have not been applied.</p><button type="button" disabled={Boolean(busy)} onClick={() => { setDrafts({}); setError(null); }}>Discard unsaved changes</button></div> : null}
    <div>{detail.results.map(result => {
      const value = drafts[result.id] ?? draftFor(result);
      const stale = value.sourceRevision !== result.revision || correction && value.sourceAssessmentRevision !== undefined && value.sourceAssessmentRevision !== detail.assessment.revision;
      const rowError = error?.id === result.id ? error.message : null;
      return <article key={result.id}>
        <div className="assessment-learner"><b>{result.roll_number ?? "–"}</b><span><strong>{result.first_name} {result.last_name}</strong><small>{result.admission_number}</small></span><i className={`assessment-result-state assessment-result-state--${result.outcome}`}>{nice(result.outcome)}</i></div>
        {editing ? <>
          <div className="assessment-mark-row">
            <select aria-label={`Outcome for ${result.first_name}`} value={value.outcome} disabled={Boolean(busy)} onChange={event => change(result, { outcome: event.target.value as ResultOutcome })}>
              <option value="unrecorded" disabled>Not recorded</option><option value="scored">Scored</option><option value="absent">Absent</option><option value="exempt">Exempt</option><option value="withheld">Withheld</option><option value="not_evaluated">Not evaluated</option>
            </select>
            <input aria-label={`Marks for ${result.first_name}`} type="number" min="0" max={detail.assessment.maximum_marks} step="0.01" disabled={Boolean(busy) || !["scored", "unrecorded"].includes(value.outcome)} placeholder="Marks" value={value.marks}
              aria-invalid={rowError ? true : undefined} aria-describedby={rowError ? `result-error-${result.id}` : undefined}
              onChange={event => change(result, { marks: event.target.value, outcome: event.target.value.trim() ? "scored" : value.outcome })}/>
            {detail.assessment.result_policy ? <span className="assessment-derived-grade" aria-label={`Configured result for ${result.first_name}`}>{(() => {
              const config = detail.assessment.result_policy.configuration;
              const preview = previewConfiguredGrade(value.marks, detail.assessment.maximum_marks, config);
              return value.outcome !== "scored" ? nice(value.outcome) : !preview ? "Enter marks to preview" : config.result_format === "percentage" ? `${preview.percentage.toFixed(config.decimal_places)}% · ${preview.grade}` : config.result_format === "gpa" ? `${preview.grade_points?.toFixed(config.decimal_places)} / ${config.grade_point_scale} · ${preview.grade}` : preview.grade;
            })()}<small>Policy preview · confirmed on save</small></span> : <input aria-label={`Grade for ${result.first_name}`} placeholder="Grade" value={value.grade} disabled={Boolean(busy)} onChange={event => change(result, { grade: event.target.value })}/> }
            <input className="assessment-feedback" aria-label={`Feedback for ${result.first_name}`} placeholder="Feedback (optional)" value={value.feedback} disabled={Boolean(busy)} onChange={event => change(result, { feedback: event.target.value })}/>
            {correction ? <label className="assessment-correction-reason">Reason for correction<input aria-label={`Reason for correcting ${result.first_name}`} value={value.reason ?? ""} minLength={3} maxLength={500} required aria-invalid={rowError ? true : undefined} aria-describedby={rowError ? `result-error-${result.id}` : undefined} disabled={Boolean(busy)} onChange={event => change(result, { reason: event.target.value })}/></label> : null}
            <button type="button" disabled={Boolean(busy) || stale} onClick={() => void save(result)}>{busy === result.id ? "Saving…" : "Save"}</button>
            {detail.assessment.status !== "published" ? <label className="assessment-upload"><Upload size={15}/><span>Add evidence</span><input type="file" aria-label={`Add evidence for ${result.first_name}`} accept="image/jpeg,image/png,application/pdf" disabled={Boolean(busy)} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(result, file); }}/></label> : null}
          </div>
          {result.evidence_count > 0 ? <small>{result.evidence_count} recorded evidence file{result.evidence_count === 1 ? "" : "s"}</small> : null}
          {result.evidence?.some(file => file.integrity === "legacy_unverified") ? <small>Earlier evidence will be checked before submission.</small> : null}
          {drafts[result.id] ? <button type="button" className="assessment-result-discard" disabled={Boolean(busy)} onClick={() => discard(result.id)}>Discard changes</button> : null}
          {stale ? <div className="assessment-result-recovery"><p className="assessment-error" role="alert">This result changed. Your unsaved entry has not been applied.</p><button type="button" disabled={Boolean(busy)} onClick={() => discard(result.id)}>Use saved result</button></div> : null}
          {rowError ? <p className="assessment-error" id={`result-error-${result.id}`} role="alert">{rowError}</p> : null}
        </> : <div className="assessment-read-result"><strong>{result.outcome === "scored" ? `${result.marks} / ${detail.assessment.maximum_marks}` : nice(result.outcome)}</strong>{result.grade ? <span>Grade {result.grade}</span> : null}{result.feedback ? <p>{result.feedback}</p> : null}{result.evidence_count ? <small>{result.evidence_count} evidence file{result.evidence_count === 1 ? "" : "s"}</small> : null}</div>}
      </article>;
    })}</div>
  </div>;
}
