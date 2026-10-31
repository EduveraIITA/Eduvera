import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Plus, Printer, Settings2, ShieldCheck, X } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import { InfoSummary } from "../../components/InfoSummary";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ApiError } from "../../lib/api";
import { MarksheetDocumentHeader } from "./MarksheetDocumentHeader";
import {
  activateGradingScheme,
  generateReportBatch,
  getGradingScheme,
  getReportBatch,
  reportBatchAction,
  saveGradingSubject,
  updateReportComments,
  type AcademicReportWorkspace,
  type FamilyReportCards,
  type GradingSchemeDetail,
  type GradingPolicy,
  type ReportBatchDetail,
  type ReportCommentUpdate,
} from "./api";
import { GradingPolicies, GradingPolicyDialog, PolicyConfigurationDetails } from "./GradingPolicies";
import { ReportSchemeDialog } from "./ReportSchemeDialog";
import { cumulativeUnavailableReason, policyDescription, reportPrimaryResult, resultNumber } from "./resultPresentation";
import { useOptionalAuth } from "../auth/AuthContext";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import "./academic-reports.css";

const nice = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "Not published";
const reportAccessLost = (error: unknown) => error instanceof ApiError && [401, 403, 404, 410].includes(error.status);

type ReportWorkspaceProps = { schoolId: string; schoolName?: string; data: AcademicReportWorkspace; refresh: () => Promise<void>; workspaceRecovery?: { retry: () => void; pending: boolean } };
type ReportEditState = { dirty: boolean; pending: boolean };
export function AcademicReportWorkspacePage(props: ReportWorkspaceProps) {
  const auth = useOptionalAuth();
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const identity = JSON.stringify([props.schoolId, auth?.user?.id, environment.mode, environment.namespaceId, environment.runId]);
  if (environment.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title="Reports & remarks"><p role="alert">This simulation is unavailable. Return to its workspace to recover it.</p></OperationsShell>;
  return <AcademicReportWorkspaceContext key={identity} {...props} actorId={auth?.user?.id} readOnly={environment.mode === "simulation" && (environment.runStatus === "completed" || environment.runStatus === "stopped")} />;
}

function AcademicReportWorkspaceContext({ schoolId, schoolName, data, refresh, workspaceRecovery, actorId, readOnly }: ReportWorkspaceProps & { actorId?: string; readOnly: boolean }) {
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const client = useQueryClient();
  const [editState, setEditState] = useState<ReportEditState>({ dirty: false, pending: false });
  const beforeBack = useUnsavedChangesGuard(editState.dirty || editState.pending, "Leave this report release? Unsaved remarks will be discarded; a pending save may already have been accepted.");
  const [params,setParams] = useSearchParams();
  const detailRef = useRef<HTMLElement>(null);
  const activeList = data.mode !== "admin" ? "releases" : params.get("view") === "policies" ? "policies" : params.get("view") === "schemes" ? "schemes" : "releases";
  const selectedBatch = params.get("batch");
  const selectedScheme = data.mode === "admin" && !selectedBatch ? params.get("scheme") : null;
  const isDetail = Boolean(selectedBatch || selectedScheme);
  const openRecord=(kind:"scheme"|"batch",id:string)=>{const next=new URLSearchParams(params);next.delete("scheme");next.delete("batch");next.set(kind,id);next.set("view",kind==="scheme"?"schemes":"releases");setParams(next);};
  const listParams=new URLSearchParams(params);listParams.delete("scheme");listParams.delete("batch");
  const listPath=`/areas/reports/remarks${listParams.size?`?${listParams}`:""}`;
  const [policySeed, setPolicySeed] = useState<GradingPolicy | null>(null);
  const [dialog, setDialog] = useState<"scheme" | "subject" | "policy" | null>(null);
  const scheme = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["grading-scheme", schoolId, "actor", actorId ?? "session", selectedScheme]), queryFn: () => getGradingScheme(schoolId, selectedScheme!), enabled: data.mode === "admin" && Boolean(selectedScheme) });
  const batchKey = executionEnvironmentQueryKey(environment, ["report-batch", schoolId, "actor", actorId ?? "session", selectedBatch]);
  const batch = useQuery({ queryKey: batchKey, queryFn: () => getReportBatch(schoolId, selectedBatch!), enabled: Boolean(selectedBatch) });
  const batchLoaded = Boolean(batch.data);
  const statuses = ["all", "draft", "reviewed", "published", "cancelled"] as const;
  const status = statuses.find(value => value === params.get("status")) ?? "all";
  const batches = data.batches.filter(item => status === "all" || item.status === status);

  useEffect(() => {
    if (!selectedBatch || !batchLoaded) return;
    const frame = window.requestAnimationFrame(() => {
      if (detailRef.current?.contains(document.activeElement) && document.activeElement !== detailRef.current) return;
      detailRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      detailRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedBatch, batchLoaded]);

  async function refreshAll() {
    await Promise.all([refresh(), ...(selectedScheme?[scheme.refetch({ throwOnError: true })]:[]), ...(selectedBatch?[batch.refetch({ throwOnError: true })]:[])]);
  }

  function acceptComment(updated: ReportCommentUpdate) {
    client.setQueryData<ReportBatchDetail>(batchKey, current => current ? {
      ...current,
      batch: { ...current.batch, revision: Math.max(current.batch.revision, updated.batch_revision) },
      students: current.students.map(student => student.id === updated.id && student.comment_revision <= updated.comment_revision ? { ...student, class_teacher_comment: updated.class_teacher_comment, principal_comment: updated.principal_comment, comment_revision: updated.comment_revision } : student),
    } : current);
  }

  function showSchemes() {
    const next=new URLSearchParams(listParams);next.set("view","schemes");setParams(next,{replace:true});
  }

  function showReleases() {
    const next=new URLSearchParams(listParams);next.set("view","releases");setParams(next,{replace:true});
  }

  return <OperationsShell active="areas" title={selectedScheme?"Grading scheme":selectedBatch?"Report release":"Reports & remarks"} schoolName={schoolName} beforeBack={beforeBack} backTo={isDetail?listPath:"/areas/reports"}>
    <div className="report-page">
      {workspaceRecovery ? <div className="report-detail-recovery" role="alert"><strong>Couldn’t refresh the report workspace</strong><p>Your current editor is still here.</p><button type="button" disabled={workspaceRecovery.pending} onClick={workspaceRecovery.retry}>{workspaceRecovery.pending ? "Trying again…" : "Try again"}</button></div> : null}
      {!isDetail && data.mode === "admin" ? <div className="workspace-list-toolbar report-workspace-toolbar">
        <div className="report-library-tabs report-library-tabs--three" role="group" aria-label="Report card workspace">
          <button aria-pressed={activeList === "releases"} className={activeList === "releases" ? "is-active" : ""} onClick={showReleases}><ProductIcon name="records" size={22}/><span>Releases</span><b>{data.batches.length}</b></button>
          <button aria-pressed={activeList === "schemes"} className={activeList === "schemes" ? "is-active" : ""} onClick={showSchemes}><Settings2 size={16}/><span>Schemes</span><b>{data.schemes.length}</b></button>
          <button aria-pressed={activeList === "policies"} className={activeList === "policies" ? "is-active" : ""} onClick={() => { const next = new URLSearchParams(listParams); next.set("view", "policies"); setParams(next, { replace: true }); }}><Settings2 size={16} /><span>Policies</span><b>{data.policies?.length ?? 0}</b></button>
        </div>
        {!readOnly && activeList === "schemes" ? <button className="workspace-add-link" aria-label="New scheme" onClick={() => setDialog("scheme")}><Plus size={20}/></button> : null}
      </div> : null}
      {!isDetail && activeList === "releases" ? <div className="workspace-list-toolbar"><select aria-label="Filter report releases" value={status} onChange={event=>setParams(current=>{current.set("status",event.target.value);return current;},{replace:true})}>{statuses.map(value=><option key={value} value={value}>{value==="all"?"All releases":value==="draft"?"To review":value==="reviewed"?"Ready to publish":nice(value)} · {data.batches.filter(item=>value==="all"||item.status===value).length}</option>)}</select></div> : null}
      {!isDetail && activeList === "policies" && data.mode === "admin" ? <GradingPolicies schoolId={schoolId} policies={data.policies ?? []} readOnly={readOnly} refresh={refreshAll} onCreate={() => { setPolicySeed(null); setDialog("policy"); }} onRevise={(policy) => { setPolicySeed(policy); setDialog("policy"); }} /> : <section className="report-workspace">
        {!isDetail?<article className="report-panel report-library">
          <div className="report-list">
            {activeList === "schemes" ? data.schemes.length ? data.schemes.map((item) => <button key={item.id} onClick={() => openRecord("scheme",item.id)}><span><strong>{item.name}</strong><small>{item.class_name} · {item.term_name}</small></span><i className={`report-status report-status--${item.status}`}>{nice(item.status)}</i><ChevronRight size={17} /></button>) : <p className="report-empty">No grading schemes</p>
              : batches.length ? batches.map((item) => <button key={item.id} onClick={() => openRecord("batch",item.id)}><span><strong>{item.scheme_name}</strong><small>{item.class_name} · Release {item.sequence}</small></span><i className={`report-status report-status--${item.status}`}>{nice(item.status)}</i><ChevronRight size={17} /></button>) : <p className="report-empty" role="status">{data.batches.length?"No releases with this status":"No report releases"}</p>}
          </div>
        </article>:<article ref={detailRef} id={selectedBatch ? `attention-${selectedBatch}` : undefined} tabIndex={selectedBatch ? -1 : undefined} className={`report-panel report-detail${selectedBatch ? " attention-focus" : ""}`}>
          {selectedBatch ? batch.data && !reportAccessLost(batch.error) ? <>{batch.error ? <div className="report-detail-recovery" role="alert"><strong>Couldn’t refresh this report release</strong><p>Your unsaved remarks are still here.</p><button type="button" disabled={batch.isFetching} onClick={() => void batch.refetch()}>{batch.isFetching ? "Trying again…" : "Try again"}</button></div> : null}<BatchPanel key={selectedBatch} canCoordinate={data.mode === "admin"} schoolId={schoolId} detail={batch.data} readOnly={readOnly || Boolean(batch.error)} refresh={refreshAll} acceptComment={acceptComment} onStateChange={setEditState} /></> : batch.isPending ? <p className="report-empty">Opening reports…</p> : batch.error ? <div className="report-detail-recovery" role="alert"><strong>Couldn’t open this report release</strong><p>{batch.error.message}</p><button type="button" disabled={batch.isFetching} onClick={() => void batch.refetch()}>{batch.isFetching ? "Trying again…" : "Try again"}</button></div> : null
            : selectedScheme && data.mode === "admin" ? scheme.data && !reportAccessLost(scheme.error) ? <>{scheme.error ? <div className="report-detail-recovery" role="alert"><strong>Couldn’t refresh this grading scheme</strong><p>Your current editor is still here.</p><button type="button" disabled={scheme.isFetching} onClick={() => void scheme.refetch()}>{scheme.isFetching ? "Trying again…" : "Try again"}</button></div> : null}<SchemePanel key={selectedScheme} schoolId={schoolId} detail={scheme.data} readOnly={readOnly} sourceUnavailable={Boolean(scheme.error)} reportCount={data.schemes.find((item) => item.id === selectedScheme)?.report_count ?? 0} onAddSubject={() => setDialog("subject")} onOpenRelease={id => openRecord("batch", id)} refresh={refreshAll} /></> : scheme.isPending ? <p className="report-empty">Opening scheme…</p> : scheme.error ? <div className="report-detail-recovery" role="alert"><strong>Couldn’t open this grading scheme</strong><p>{scheme.error.message}</p><button type="button" disabled={scheme.isFetching} onClick={() => void scheme.refetch()}>{scheme.isFetching ? "Trying again…" : "Try again"}</button></div> : null
              : <p className="report-empty">Choose a grading scheme or report release.</p>}
        </article>}
      </section>}
      {!readOnly && dialog === "policy" && data.mode === "admin" ? <GradingPolicyDialog schoolId={schoolId} sourcePolicy={policySeed} close={() => setDialog(null)} saved={async () => { setDialog(null); const next = new URLSearchParams(listParams); next.set("view", "policies"); setParams(next, { replace: true }); await refreshAll(); }} /> : null}
      {!readOnly && dialog === "scheme" && data.mode === "admin" ? <ReportSchemeDialog schoolId={schoolId} data={data} onCreatePolicy={() => { setPolicySeed(null); setDialog("policy"); }} close={() => setDialog(null)} saved={async (id) => { setDialog(null); openRecord("scheme",id); await refresh(); }} /> : null}
      {!readOnly && dialog === "subject" && data.mode === "admin" && scheme.data ? <SubjectDialog schoolId={schoolId} data={data} scheme={scheme.data} close={() => setDialog(null)} saved={async () => { setDialog(null); await refreshAll(); }} /> : null}
    </div>
  </OperationsShell>;
}

function SchemePanel({ schoolId, detail, reportCount, onAddSubject, onOpenRelease, refresh, readOnly, sourceUnavailable }: { schoolId: string; detail: GradingSchemeDetail; reportCount: number; onAddSubject: () => void; onOpenRelease: (id: string) => void; refresh: () => Promise<void>; readOnly: boolean; sourceUnavailable: boolean }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [correction, setCorrection] = useState("");
  const [generated, setGenerated] = useState<{ id: string; sequence: number } | null>(null);
  const generating = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function activate() {
    if (readOnly || sourceUnavailable) return;
    setBusy("activate"); setError("");
    try { await activateGradingScheme(schoolId, detail.scheme.id, detail.scheme.revision, "Grading structure checked and activated."); await refresh(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(""); }
  }
  async function generate() {
    if (readOnly || sourceUnavailable || generating.current || generated) return;
    generating.current = true;
    setBusy("generate"); setError("");
    let accepted = false;
    try {
      const release = await generateReportBatch(schoolId, detail.scheme.id, detail.scheme.revision, correction);
      accepted = true;
      if (!active.current) return;
      setGenerated({ id: release.id, sequence: release.sequence });
      await refresh();
    } catch (cause) {
      if (active.current) setError(accepted ? "Report release created. The latest workspace couldn’t be refreshed." : cause instanceof Error ? cause.message : "Couldn’t generate this release. Try again.");
    } finally { generating.current = false; if (active.current) setBusy(""); }
  }
  async function refreshGenerated() {
    if (!generated || generating.current) return;
    generating.current = true; setBusy("refresh");
    try { await refresh(); if (active.current) setError(""); }
    catch { if (active.current) setError("Report release created. The latest workspace couldn’t be refreshed."); }
    finally { generating.current = false; if (active.current) setBusy(""); }
  }
  return <div className="report-scheme"><header><div><small>{detail.scheme.class_name} · {detail.scheme.term_name}</small><h2>{detail.scheme.name}</h2><p>{detail.scheme.code} · {nice(detail.scheme.review_mode)}</p></div><i className={`report-status report-status--${detail.scheme.status}`}>{nice(detail.scheme.status)}</i></header>
    <div className="report-policy-facts"><span><small>ABSENCE</small><strong>{nice(detail.scheme.absence_treatment)}</strong></span><span><small>SUBJECTS</small><strong>{detail.subjects.length}</strong></span><span><small>GRADE BANDS</small><strong>{detail.bands.length}</strong></span></div>
    {error ? <p className="report-error" role="alert">{error}</p> : null}
    {detail.scheme.result_policy ? <details className="report-policy-disclosure"><InfoSummary>{policyDescription(detail.scheme.result_policy)}</InfoSummary><p>{detail.scheme.result_policy.name} · Version {detail.scheme.result_policy.version}</p><PolicyConfigurationDetails configuration={detail.scheme.result_policy.configuration} /></details> : null}
    <section className="report-band-strip" aria-label="Grade bands">{detail.bands.slice().reverse().map((band) => <span key={band.id}><b>{band.code}</b><small>{band.minimum_percentage}–{band.maximum_percentage}</small></span>)}</section>
    <section className="report-subject-plans"><header><h3>Subject plans</h3>{!readOnly && detail.scheme.status === "draft" ? <button onClick={onAddSubject}><Plus size={16} />Add subject</button> : null}</header>{detail.subjects.length ? detail.subjects.map((subject) => <article key={subject.id}><span className="report-subject-dot" style={{ background: subject.color }} /><div><strong>{subject.subject_name}</strong><small>{subject.pass_percentage !== null ? `Pass ${subject.pass_percentage}%` : "Pass decision from policy"}{subject.course_code ? ` · ${subject.course_code}` : ""}{subject.credits ? ` · ${subject.credits} credits` : ""}</small></div><div>{detail.components.filter((item) => item.scheme_subject_id === subject.id).map((component) => <span key={component.id}>{component.name} {component.weight_percentage}% · {component.assessment_titles.length} assessment{component.assessment_titles.length === 1 ? "" : "s"}</span>)}</div></article>) : <p className="report-empty">Add a subject and map its published assessments.</p>}</section>
    {generated ? <p className="report-edit-notice" role="status">Release {generated.sequence} created.</p> : null}
    {!readOnly ? <div className="report-primary-actions">{detail.scheme.status === "draft" ? <button disabled={Boolean(busy) || sourceUnavailable || !detail.subjects.length} onClick={() => void activate()}>{busy === "activate" ? "Activating…" : "Activate scheme"}</button> : <><label>{reportCount ? "Correction reason" : "First release"}<input value={correction} disabled={Boolean(busy) || sourceUnavailable || Boolean(generated)} onChange={(event) => setCorrection(event.target.value)} placeholder={reportCount ? "Why is a new report needed?" : "No reason required"} /></label>{generated ? <><button type="button" disabled={Boolean(busy)} onClick={() => onOpenRelease(generated.id)}>Open release</button>{error ? <button type="button" className="is-secondary" disabled={Boolean(busy)} onClick={() => void refreshGenerated()}>{busy === "refresh" ? "Refreshing…" : "Retry refresh"}</button> : null}</> : <button disabled={Boolean(busy) || sourceUnavailable || (reportCount > 0 && correction.trim().length < 3)} onClick={() => void generate()}>{busy === "generate" ? "Generating…" : reportCount ? "Generate correction" : "Generate reports"}</button>}</>}</div> : null}
  </div>;
}

interface RemarkDraft {
  teacher: string;
  principal: string;
  commentRevision: number;
  batchRevision: number;
}

function BatchPanel({ canCoordinate, schoolId, detail, refresh, acceptComment, readOnly, onStateChange }: { canCoordinate: boolean; schoolId: string; detail: ReportBatchDetail; refresh: () => Promise<void>; acceptComment: (updated: ReportCommentUpdate) => void; readOnly: boolean; onStateChange: (state: ReportEditState) => void }) {
  const [note, setNote] = useState<{ value: string; revision: number; status: string } | null>(null);
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, RemarkDraft>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<{ studentId?: string; message: string } | null>(null);
  const inFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const dirty = Object.keys(drafts).length > 0;
  const staleNote = Boolean(note && (note.revision !== detail.batch.revision || note.status !== detail.batch.status));
  useEffect(() => { onStateChange({ dirty: dirty || Boolean(note?.value), pending: Boolean(busy) }); }, [busy, dirty, note?.value, onStateChange]);
  useEffect(() => () => { onStateChange({ dirty: false, pending: false }); }, [onStateChange]);
  const learners = detail.students.filter((student) => `${student.first_name} ${student.last_name} ${student.admission_number} ${student.roll_number ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const discard = (id: string) => {
    setDrafts(current => { const next = { ...current }; delete next[id]; return next; });
    setError(null);
  };
  function change(student: ReportBatchDetail["students"][number], patch: Partial<Pick<RemarkDraft, "teacher" | "principal">>) {
    setDrafts(current => ({ ...current, [student.id]: { ...(current[student.id] ?? { teacher: student.class_teacher_comment, principal: student.principal_comment, commentRevision: student.comment_revision, batchRevision: detail.batch.revision }), ...patch } }));
    setError(null);
  }
  async function save(student: ReportBatchDetail["students"][number]) {
    const draft = drafts[student.id];
    if (inFlight.current || !draft || readOnly || detail.batch.status !== "draft" || draft.commentRevision !== student.comment_revision || draft.batchRevision !== detail.batch.revision) return;
    inFlight.current = true; setBusy(student.id); setError(null);
    let accepted = false;
    try {
      const updated = await updateReportComments(schoolId, detail.batch.id, student.student_id, { expected_revision: draft.commentRevision, expected_batch_revision: draft.batchRevision, class_teacher_comment: draft.teacher, principal_comment: draft.principal });
      accepted = true;
      if (!active.current) return;
      if (updated.batch_revision === draft.batchRevision + 1) {
        // A known own save may move the other drafts with it. A remote jump
        // never rebases a draft or a review note silently.
        setDrafts(current => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, value.batchRevision === draft.batchRevision ? { ...value, batchRevision: updated.batch_revision } : value])));
        setNote(current => current?.revision === draft.batchRevision ? { ...current, revision: updated.batch_revision } : current);
      }
      acceptComment(updated);
      discard(student.id);
      await refresh();
    } catch (cause) {
      if (active.current) setError({ studentId: student.id, message: accepted ? "Remarks saved. The latest release couldn’t be refreshed. Try again before continuing." : cause instanceof Error ? cause.message : "Couldn’t save these remarks. Try again." });
    } finally { inFlight.current = false; if (active.current) setBusy(""); }
  }
  async function act(action: "review" | "publish" | "cancel") {
    if (inFlight.current || dirty || readOnly || staleNote || !note || note.value.trim().length < 3) return;
    inFlight.current = true; setBusy(action); setError(null);
    let accepted = false;
    try { await reportBatchAction(schoolId, detail.batch.id, action, note.revision, note.value); accepted = true; if (!active.current) return; setNote(null); await refresh(); }
    catch (cause) { if (active.current) setError({ message: accepted ? "The action was saved. Refresh this release to see its current state." : cause instanceof Error ? cause.message : "Couldn’t save this action. Try again." }); }
    finally { inFlight.current = false; if (active.current) setBusy(""); }
  }
  return <div className="report-batch"><header><div><small>{detail.batch.class_name} · {detail.batch.term_name}</small><h2>{detail.batch.scheme_name}</h2><p>Release {detail.batch.sequence} · Generated {date(detail.batch.generated_at)}</p></div><i className={`report-status report-status--${detail.batch.status}`}>{nice(detail.batch.status)}</i></header>
    <div className="report-policy-facts"><span><small>LEARNERS</small><strong>{detail.students.length}</strong></span><span><small>COMPLETE</small><strong>{detail.students.filter((item) => item.outcome === "complete").length}</strong></span><span><small>INCOMPLETE</small><strong>{detail.students.filter((item) => item.outcome === "incomplete").length}</strong></span></div>
    {detail.batch.correction_reason ? <p className="report-correction">Correction: {detail.batch.correction_reason}</p> : null}{error ? <p className="report-error" role="alert">{error.studentId ? `${detail.students.find(student => student.id === error.studentId)?.first_name ?? "Learner"}: ` : ""}{error.message}</p> : null}
    {canCoordinate && ["draft", "reviewed"].includes(detail.batch.status) ? <div className="report-review-bar"><input aria-label="Review or publication note" value={note?.value ?? ""} disabled={Boolean(busy) || readOnly} onChange={(event) => setNote(current => ({ value: event.target.value, revision: current?.revision ?? detail.batch.revision, status: current?.status ?? detail.batch.status }))} placeholder="Required note" />{detail.batch.status === "draft" ? <button disabled={Boolean(busy) || dirty || readOnly || staleNote || (note?.value.trim().length ?? 0) < 3} onClick={() => void act("review")}>{busy === "review" ? "Reviewing…" : "Review batch"}</button> : <button disabled={Boolean(busy) || dirty || readOnly || staleNote || (note?.value.trim().length ?? 0) < 3} onClick={() => void act("publish")}>{busy === "publish" ? "Publishing…" : "Publish reports"}</button>}</div> : null}
    {dirty && canCoordinate ? <p className="report-edit-notice" role="status">Save or discard unsaved remarks before reviewing.</p> : null}
    {staleNote ? <div className="report-edit-recovery"><p role="alert">This release changed. Your note has not been applied.</p><button type="button" disabled={Boolean(busy)} onClick={() => setNote(null)}>Use latest release</button></div> : null}
    <div className="report-learner-tools"><label htmlFor="report-learner-search">Learners</label><input id="report-learner-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, roll or admission number" /><span>{learners.length} of {detail.students.length}</span></div>
    <div className="report-learners">{learners.length ? learners.map((student) => <LearnerReport key={student.id} canCoordinate={canCoordinate} batch={detail} student={student} draft={drafts[student.id]} busy={Boolean(busy)} saving={busy === student.id} readOnly={readOnly} change={patch => change(student, patch)} discard={() => discard(student.id)} save={() => void save(student)} />) : <p className="report-empty">No learners match this search.</p>}</div>
  </div>;
}

function LearnerReport({ canCoordinate, batch, student, draft, busy, saving, readOnly, change, discard, save }: { canCoordinate: boolean; batch: ReportBatchDetail; student: ReportBatchDetail["students"][number]; draft?: RemarkDraft; busy: boolean; saving: boolean; readOnly: boolean; change: (patch: Partial<Pick<RemarkDraft, "teacher" | "principal">>) => void; discard: () => void; save: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const stale = Boolean(draft && (draft.commentRevision !== student.comment_revision || draft.batchRevision !== batch.batch.revision));
  const locked = readOnly || batch.batch.status !== "draft";
  const subjects = batch.subjects.filter((item) => item.report_student_id === student.id);
  const primary = reportPrimaryResult(student, batch.batch.result_policy);
  const format = batch.batch.result_policy?.configuration.result_format;
  return <article className={expanded ? "is-expanded" : ""}><button className="report-learner-summary" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><span className="report-roll">{student.roll_number ?? "–"}</span><span className="report-learner-identity"><strong>{student.first_name} {student.last_name}</strong><small>{student.admission_number}</small></span><span className={`report-outcome report-outcome--${student.outcome}`}>{nice(student.outcome)}</span><span className="report-score"><b>{primary.value}</b><small>{primary.label}{primary.secondary ? ` · ${primary.secondary}` : ""}</small></span>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
    {expanded ? <div className="report-learner-detail"><div className="report-subject-grid">{subjects.map((subject) => <span key={subject.id}><i style={{ background: subject.color }} /><strong>{subject.subject_name}</strong><b>{format === "grade" ? subject.grade || "—" : format === "gpa" ? resultNumber(subject.grade_points, batch.batch.result_policy) : subject.percentage !== null ? `${subject.percentage}%` : nice(subject.outcome)}</b><small>{subject.grade}{subject.passed === false ? " · Below pass" : ""}</small></span>)}</div>
      {batch.batch.status === "draft" || draft ? <div className="report-comments"><label>Class teacher remark<textarea rows={2} maxLength={1000} value={draft?.teacher ?? student.class_teacher_comment} disabled={busy || locked} onChange={(event) => change({ teacher: event.target.value })} /></label>{canCoordinate ? <label>Principal remark<textarea rows={2} maxLength={1000} value={draft?.principal ?? student.principal_comment} disabled={busy || locked} onChange={(event) => change({ principal: event.target.value })} /></label> : null}<button type="button" disabled={busy || locked || stale || !draft} onClick={save}>{saving ? "Saving…" : "Save remarks"}</button>{draft ? <button type="button" className="is-secondary" disabled={busy} onClick={discard}>{stale || locked ? "Use saved remarks" : "Discard changes"}</button> : null}{draft && (stale || locked) ? <p role="alert">{locked ? "This release is read-only." : "These remarks changed."} Your unsaved remarks have not been applied.</p> : null}</div> : student.class_teacher_comment || student.principal_comment ? <div className="report-read-comments">{student.class_teacher_comment ? <p><b>Class teacher</b>{student.class_teacher_comment}</p> : null}{student.principal_comment ? <p><b>Principal</b>{student.principal_comment}</p> : null}</div> : null}</div> : null}
  </article>;
}

function SubjectDialog({ schoolId, data, scheme, close, saved }: { schoolId: string; data: Extract<AcademicReportWorkspace, { mode: "admin" }>; scheme: GradingSchemeDetail; close: () => void; saved: () => Promise<void> }) {
  const [subjectId, setSubjectId] = useState(data.references.subjects[0]?.id ?? "");
  const [components, setComponents] = useState([{ name: "Term assessment", code: "TERM", weight: "100", assessmentIds: [] as string[] }]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const configured = Boolean(scheme.scheme.result_policy);
  const needsCredits = scheme.scheme.result_policy?.configuration.result_format === "gpa" || scheme.scheme.result_policy?.configuration.aggregation === "credit_weighted";
  const eligible = data.references.assessments.filter((item) => item.subject_id === subjectId && item.class_section_id === scheme.scheme.class_section_id && item.term_id === scheme.scheme.term_id);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { await saveGradingSubject(schoolId, scheme.scheme.id, { subject_id: subjectId, credits: needsCredits ? Number(form.get("credits")) : null, course_code: needsCredits ? form.get("course_code") : null, pass_percentage: form.get("pass_percentage") ? Number(form.get("pass_percentage")) : null, expected_revision: scheme.scheme.revision, components: components.map((item) => ({ code: item.code, name: item.name, weight_percentage: Number(item.weight), assessment_ids: item.assessmentIds })) }); await saved(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <div className="report-dialog-backdrop"><section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="subject-plan-title"><header><h2 id="subject-plan-title">Subject grading plan</h2><button onClick={close} aria-label="Close"><X /></button></header><form onSubmit={(event) => void submit(event)}><div className="report-form-grid"><label>Subject<select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setComponents((current) => current.map((item) => ({ ...item, assessmentIds: [] }))); }}>{data.references.subjects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{configured ? <p className="report-form-help">Pass decisions follow the grading policy.</p> : <label>Pass percentage<input name="pass_percentage" type="number" min="0" max="100" step="0.01" defaultValue="40" /></label>}{needsCredits ? <><label>Course code<input name="course_code" required maxLength={80} placeholder="CS601" /><small>Keep this code stable across terms and retakes.</small></label><label>Credits<input name="credits" required type="number" min="0.01" max="100" step="0.01" placeholder="4" /></label></> : null}</div><fieldset><legend>Components</legend>{components.map((component, index) => <article className="report-component-form" key={index}><div><input aria-label={`Component name ${index + 1}`} value={component.name} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><input aria-label={`Component code ${index + 1}`} value={component.code} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item))} /><input aria-label={`Component weight ${index + 1}`} type="number" min="0.01" max="100" step="0.01" value={component.weight} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, weight: event.target.value } : item))} /></div><strong>Published assessments</strong>{eligible.length ? eligible.map((assessment) => <label className="report-check" key={assessment.id}><input type="checkbox" checked={component.assessmentIds.includes(assessment.id)} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, assessmentIds: event.target.checked ? [...item.assessmentIds, assessment.id] : item.assessmentIds.filter((id) => id !== assessment.id) } : item))} /><span>{assessment.title} · {assessment.maximum_marks} marks</span></label>) : <p>No published assessments for this class, term and subject.</p>}</article>)}<button type="button" className="report-add-component" onClick={() => setComponents((current) => [...current, { name: "", code: "", weight: "", assessmentIds: [] }])}><Plus size={16} />Add component</button></fieldset>{error ? <p className="report-error">{error}</p> : null}<footer><button type="button" className="is-secondary" onClick={close}>Cancel</button><button disabled={busy || !eligible.length}>{busy ? "Saving…" : "Save subject plan"}</button></footer></form></section></div>;
}

export function FamilyReportMarksheet({ data, report, showPrintAction = false, printing = false, onPrint = () => window.print() }: { data: FamilyReportCards; report: FamilyReportCards["reports"][number]; showPrintAction?: boolean; printing?: boolean; onPrint?: () => void }) {
  const studentName = `${data.student.first_name} ${data.student.last_name}`;
  const historicalClass = report.class_name ?? "Not recorded";
  const completed = report.subjects.filter((subject) => subject.outcome === "complete").length;
  const passed = report.subjects.filter((subject) => subject.passed === true).length;
  const reference = report.batch_id.slice(0, 8).toUpperCase();
  const policy = report.result_policy;
  const format = policy?.configuration.result_format;
  const primary = reportPrimaryResult(report);
  const showCredits = format === "gpa" || policy?.configuration.aggregation === "credit_weighted";
  const termLabel = report.term_name.includes(report.academic_year) ? report.term_name : [report.term_name, report.academic_year].filter(Boolean).join(" · ");
  return <article className={`marksheet marksheet--term-report result-document${printing ? " is-print-target" : ""}`} aria-labelledby={`term-marksheet-${report.batch_id}`}>
    <MarksheetDocumentHeader kind="term" />
    <div className="marksheet__title"><div className="marksheet__title-copy">
      <span>{termLabel}</span><h2 id={`term-marksheet-${report.batch_id}`}>{report.scheme_name}</h2>
      <p className="marksheet__learner-context">{studentName}</p>
      {report.sequence > 1 ? <em>Corrected release</em> : null}
    </div></div>
    <div className="marksheet__summary" aria-label="Overall result">
      <span><small>{primary.label}</small><strong>{primary.value}</strong>{format === "gpa" ? <em>{report.gpa === null || report.gpa === undefined ? cumulativeUnavailableReason(report.gpa_unavailable_reason) : `${report.credit_total ?? "—"} term credits`}</em> : null}</span>
      {format === "gpa" ? <span><small>CGPA</small><strong>{resultNumber(report.cgpa, policy)}</strong><em>{report.cgpa === null || report.cgpa === undefined ? cumulativeUnavailableReason(report.cgpa_unavailable_reason) : `${report.cumulative_credits ?? "—"} cumulative credits · out of ${policy?.configuration.grade_point_scale}`}</em></span> : format !== "grade" ? <span><small>Grade</small><strong>{report.overall_grade || "—"}</strong></span> : null}
      <span><small>Result</small><strong>{nice(report.outcome)}</strong><em>{completed} of {report.subjects.length} {report.subjects.length === 1 ? "subject" : "subjects"} complete</em></span>
    </div>
    <section className="marksheet__subject-section" aria-label="Subject breakdown">
      <h3>Subjects</h3>
      <div className={`marksheet__subjects${format === "grade" ? " marksheet__subjects--grade" : format === "gpa" ? " marksheet__subjects--gpa" : ""}${showCredits ? " marksheet__subjects--credits" : ""}`} role="table" aria-label="Subject results">
        <div className="marksheet__subject-head" role="row"><span role="columnheader">Subject</span>{format !== "grade" && format !== "gpa" ? <span role="columnheader">Score</span> : null}<span role="columnheader">Grade</span>{format === "gpa" ? <span role="columnheader">Points</span> : null}{showCredits ? <span role="columnheader">Credits</span> : null}<span role="columnheader">Status</span></div>
        {report.subjects.map((subject) => <div className="marksheet__subject-row" role="row" key={subject.id}>
          <span role="cell"><b>{subject.subject_name}</b>{showCredits && subject.course_code ? <small className="marksheet__course-code">{subject.course_code}</small> : null}</span>
          {format !== "grade" && format !== "gpa" ? <strong role="cell"><span className="marksheet__mobile-label" aria-hidden="true">Score </span>{subject.percentage !== null ? `${resultNumber(subject.percentage, policy)}%` : "—"}</strong> : null}
          <b role="cell"><span className="marksheet__mobile-label" aria-hidden="true">Grade </span>{subject.grade || "—"}</b>
          {format === "gpa" ? <strong role="cell"><span className="marksheet__mobile-label" aria-hidden="true">Points </span>{resultNumber(subject.grade_points, policy)}</strong> : null}
          {showCredits ? <strong role="cell"><span className="marksheet__mobile-label" aria-hidden="true">Credits </span>{subject.credits ?? "—"}</strong> : null}
          <em role="cell" className={`is-${subject.passed === false ? "below" : subject.outcome}`}><span className="marksheet__mobile-label sr-only">Status </span>{subject.passed === false ? "Below pass" : nice(subject.outcome)}</em>
        </div>)}
      </div>
      <div className="marksheet__subject-note"><span>{passed} passed</span><span>{report.subjects.length} {report.subjects.length === 1 ? "subject" : "subjects"}</span></div>
    </section>
    {report.class_teacher_comment || report.principal_comment ? <section className="marksheet__remarks" aria-label="School remarks"><h3>Remarks</h3><div>{report.class_teacher_comment ? <p><b>Class teacher</b>{report.class_teacher_comment}</p> : null}{report.principal_comment ? <p><b>Principal</b>{report.principal_comment}</p> : null}</div></section> : null}
    <details className="marksheet__record-details" open={printing || undefined}>
      <InfoSummary>Record details</InfoSummary>
      <dl className="marksheet__identity"><div><dt>Student</dt><dd>{studentName}</dd></div><div><dt>Class</dt><dd>{historicalClass}</dd></div><div><dt>Admission no.</dt><dd>{data.student.admission_number}</dd></div><div><dt>Published</dt><dd>{date(report.published_at)}</dd></div><div><dt>Reference</dt><dd>{reference}</dd></div><div><dt>Release</dt><dd>{report.sequence}</dd></div></dl>
      {policy ? <div className="marksheet__policy"><h3>Grading policy</h3><p>{policy.name} · Version {policy.version} · {policyDescription(policy)}</p><PolicyConfigurationDetails configuration={policy.configuration} />{format === "gpa" ? <><p>Term credit points: {report.credit_points ?? "—"}. Cumulative credit points: {report.cumulative_credit_points ?? "—"}.</p>{report.cumulative_sources?.length ? <div className="marksheet__cumulative-sources"><h4>Included course sources</h4><ul>{report.cumulative_sources.map((source, index) => <li key={index}>{[source.course_code, source.term_index ? `Term ${source.term_index}` : null, source.credits ? `${source.credits} credits` : null, source.grade_points !== null && source.grade_points !== undefined ? `${source.grade_points} points` : null, source.included === false ? "Superseded attempt" : source.outcome === "exempt" ? "Exempt · excluded" : "Included", source.outcome && source.outcome !== "complete" ? nice(source.outcome) : null, `Release ${source.batch_id.slice(0, 8).toUpperCase()}`].filter(Boolean).join(" · ") || `Published source ${index + 1}`}</li>)}</ul></div> : null}</> : null}</div> : null}
      {report.correction_reason ? <p className="marksheet__correction-note"><b>Correction reason</b>{report.correction_reason}</p> : null}
      <footer className="marksheet__verification"><ShieldCheck size={18} aria-hidden="true" /><span>Published school record</span><CheckCircle2 size={18} aria-hidden="true" /></footer>
    </details>
    {showPrintAction ? <button type="button" className="marksheet__print" onClick={onPrint}><Printer size={17} aria-hidden="true" />Print / save marksheet</button> : null}
  </article>;
}

export function FamilyReportCardList({ data }: { data: FamilyReportCards }) {
  if (!data.reports.length) return null;
  return <section className="family-report-cards" aria-labelledby="published-marksheet-heading"><header><div><span>PUBLISHED RESULT</span><h2 id="published-marksheet-heading">Term marksheet</h2></div><button onClick={() => window.print()}><Printer size={17} />Print</button></header>{data.reports.map((report) => <FamilyReportMarksheet key={report.batch_id} data={data} report={report} />)}</section>;
}
