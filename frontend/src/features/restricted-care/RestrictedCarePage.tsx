import { applicationNow } from "../simulation/applicationTime";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, FileLock2, PhoneCall, Plus, ShieldAlert, ShieldCheck, UserRoundCog } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ProductIcon } from "../../components/ProductIcon";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { actOnCareCase, assignCareRole, getCareCase, getCareWorkspace, openCareCase, revokeCareRole, type CareCaseSummary, type CareWorkspace } from "./api";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { useCareSave } from "./useCareSave";
import { CareOrphanRecovery } from "./CareOrphanRecovery";
import { CarePendingReceipts } from "./CarePendingReceipts";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";
import "./restricted-care.css";

type Tab = "cases" | "team" | "message_reports";

const labels: Record<string, string> = {
  open: "New", triage: "In triage", active: "Active", closed: "Closed",
  urgent: "Urgent", priority: "Priority", routine: "Routine",
  assessment_required: "Reporting assessment needed", reporting_required: "External report required",
  reported: "External report recorded", not_applicable: "Reporting assessed as not applicable",
  sexual_safety: "Sexual safety", physical_safety: "Physical safety", emotional_wellbeing: "Emotional wellbeing",
  neglect: "Neglect", bullying: "Bullying", cyber_safety: "Cyber safety", other: "Other concern",
  staff_observation: "Staff observation", child_disclosure: "Child disclosure", guardian_report: "Guardian report",
  student_report: "Student report", anonymous: "Anonymous report", primary: "Primary route", alternate: "Alternate route",
  designated_lead: "Designated safeguarding lead", deputy_lead: "Deputy safeguarding lead", institution_head: "Institution head",
  counsellor: "Counsellor", external_liaison: "External liaison",
};
const title = (value: string) => labels[value] ?? value.replaceAll("_", " ");
const formatDateTime = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function SafetyBanner() {
  return <section className="care-safety" aria-label="Emergency guidance">
    <span className="care-safety__icon"><PhoneCall size={22} /></span>
    <div><strong>Immediate danger? Call 112 now.</strong><p>Do not wait for this form or an in-app response. Follow the institution's approved police, SJPU, Child Helpline or emergency procedure.</p></div>
    <a href="tel:112">Call 112</a>
  </section>;
}

function CaseCard({ item, onOpen }: { item: CareCaseSummary; onOpen: () => void }) {
  return <button type="button" className={`care-case care-case--${item.urgency}`} onClick={onOpen}>
    <span className="care-case__rail" aria-hidden="true" />
    <span className="care-case__main">
      <span className="care-case__eyebrow"><b>{title(item.urgency)}</b><time>{formatDateTime(item.last_activity_at)}</time></span>
      <strong>{item.subject_name}</strong>
      <small>{title(item.concern_category)} · Owner: {item.owner_name}</small>
      <span className="care-case__states"><em>{title(item.status)}</em><em>{title(item.reporting_state)}</em></span>
    </span>
    <ArrowRight size={19} aria-hidden="true" />
  </button>;
}

function CaseQueue({ cases, onOpen }: { cases: readonly CareCaseSummary[]; onOpen: (id: string) => void }) {
  const [params, setParams] = useSearchParams();
  const pages = Math.max(1, Math.ceil(cases.length / 20));
  const requested = Number(params.get("care_page") ?? 1);
  const page = Number.isFinite(requested) ? Math.min(pages, Math.max(1, Math.floor(requested))) : 1;
  const changePage = (nextPage: number) => setParams((current) => { const next = new URLSearchParams(current); if (nextPage === 1) next.delete("care_page"); else next.set("care_page", String(nextPage)); return next; });
  return <><section className="care-queue" aria-label="Assigned cases">{cases.length ? cases.slice((page - 1) * 20, page * 20).map((item) => <CaseCard key={item.id} item={item} onOpen={() => onOpen(item.id)} />) : <div className="care-empty"><ProductIcon name="care" size={40} /><strong>No assigned cases</strong><p>This does not mean the institution has no concerns. You only see cases explicitly assigned to you.</p></div>}</section>{pages > 1 ? <nav className="care-pagination" aria-label="Assigned case pages"><button type="button" disabled={page === 1} onClick={() => changePage(page - 1)}>Previous</button><span>Page {page} of {pages} · {cases.length} assigned cases</span><button type="button" disabled={page === pages} onClick={() => changePage(page + 1)}>Next</button></nav> : null}</>;
}

function IntakePage({ schoolId, scope, data, onClose, onCreated, refresh }: { schoolId: string; scope: readonly unknown[]; data: CareWorkspace; onClose: () => void; onCreated: (caseId: string) => Promise<void>; refresh: () => Promise<void> }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [form, setForm] = useState({ student_id: "", intake_route: "primary", source_kind: "staff_observation", urgency: "priority", concern_category: "emotional_wellbeing", safety_state: "unknown", ordinary_handler_involved: false, details: "" });
  const save = useCareSave({ schoolId, scope, slot: "intake", onAccepted: result => onCreated(result.id) });
  useEffect(() => { headingRef.current?.focus(); }, []);
  const set = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  return <section aria-labelledby="care-intake-title" className="care-sheet care-sheet--page">
    <h2 id="care-intake-title" ref={headingRef} tabIndex={-1} className="sr-only">Record a concern</h2>
    <div className="care-sheet__body">
      <aside className="care-form-warning"><ShieldAlert /><p>Record what was seen, heard or disclosed. Do not investigate, confront an alleged person, promise secrecy or delay urgent external help.</p></aside>
      <fieldset className="care-fields" disabled={save.locked}>
      <label>Child or student (optional)<select value={form.student_id} onChange={(event) => set("student_id", event.target.value)}><option value="">Not selected / not in my assigned list</option>{data.eligible_students.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.admission_number}</option>)}</select></label>
      <label className="care-checkbox"><input type="checkbox" checked={form.ordinary_handler_involved} onChange={(event) => { set("ordinary_handler_involved", event.target.checked); if (event.target.checked) set("intake_route", "alternate"); }} /><span><b>The ordinary handler may be involved</b><small>This forces the protected alternate route.</small></span></label>
      <div className="care-form-grid">
        <label>Recipient route<select value={form.intake_route} disabled={form.ordinary_handler_involved} onChange={(event) => set("intake_route", event.target.value)}><option value="primary">Primary route ({data.routes.primary} available)</option><option value="alternate">Alternate route ({data.routes.alternate} available)</option></select></label>
        <label>How it came to you<select value={form.source_kind} onChange={(event) => set("source_kind", event.target.value)}>{["staff_observation","child_disclosure","guardian_report","student_report","anonymous","other"].map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label>
        <label>Concern category<select value={form.concern_category} onChange={(event) => set("concern_category", event.target.value)}>{["sexual_safety","physical_safety","emotional_wellbeing","neglect","bullying","cyber_safety","other"].map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label>
        <label>Operational urgency<select value={form.urgency} onChange={(event) => set("urgency", event.target.value)}><option value="urgent">Urgent</option><option value="priority">Priority</option><option value="routine">Routine follow-up</option></select></label>
      </div>
      <fieldset><legend>Immediate safety at the time of recording</legend>{([
        ["immediate_action_required", "Immediate action required"], ["actions_underway", "Safety actions underway"],
        ["no_immediate_danger", "No immediate danger observed"], ["unknown", "Not known"],
      ] as const).map(([value, label]) => <label key={value} className="care-radio"><input type="radio" name="safety" value={value} checked={form.safety_state === value} onChange={() => set("safety_state", value)} /><span>{label}</span></label>)}</fieldset>
      <label>Factual intake note<textarea value={form.details} onChange={(event) => set("details", event.target.value)} rows={7} placeholder="Record exact words where possible, what you observed, when it occurred, and immediate actions already taken. Avoid assumptions or diagnosis." /></label>
      </fieldset>
      {save.error && <p className="care-error" role="alert">{save.error}</p>}
    </div>
    <footer><button type="button" className="care-secondary" disabled={save.locked} onClick={onClose}>Cancel</button>{save.recovery ? <button type="button" className="care-primary" disabled={save.busy} onClick={() => void save.recover()}>{save.busy ? "Checking…" : save.recovery === "accepted" ? "Open saved concern" : save.retryReady ? "Retry exact save" : "Check exact result"}</button> : save.reviewNeeded ? <button type="button" className="care-primary" onClick={() => void refresh().then(save.reviewed).catch(() => undefined)}>Review latest routes</button> : <button type="button" className="care-primary" disabled={save.busy || form.details.trim().length < 20} onClick={() => { const input = { ...form, student_id: form.student_id || null, observed_at: null }; void save.execute(commandId => openCareCase(schoolId, { ...input, command_id: commandId })); }}>{save.busy ? "Recording…" : "Record concern"}</button>}</footer>
  </section>;
}

const dateTimeInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function CasePage({ schoolId, scope, caseId, expectedRevision, onChanged, onTransferred }: { schoolId: string; scope: readonly unknown[]; caseId: string; expectedRevision?: number; onChanged: () => Promise<void>; onTransferred: () => void }) {
  const [params]=useSearchParams();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [actionKind, setActionKind] = useState("case_note");
  const [note, setNote] = useState("");
  const [authority, setAuthority] = useState("local_police");
  const [reportedAt, setReportedAt] = useState(() => dateTimeInput(applicationNow()));
  const [owner, setOwner] = useState("");
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const query = useQuery({ queryKey: [...scope, "case", caseId], queryFn: () => getCareCase(schoolId, caseId) });
  const hasLoaded = Boolean(query.data);
  const beginDraft = () => setDraftRevision(previous => previous ?? query.data?.case.revision ?? null);
  const save = useCareSave({ schoolId, scope, slot: `case:${caseId}`, caseId, onAccepted: async result => {
    if (result.action === "restricted_care.case.reassigned") { await onChanged(); onTransferred(); return; }
    await query.refetch({ throwOnError: true }); await onChanged(); setDraftRevision(result.revision); setNote("");
  } });
  useEffect(() => {
    if (!hasLoaded) return;
    const frame = window.requestAnimationFrame(() => {
      headingRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [caseId, hasLoaded]);
  if (query.isPending) return <ScreenLoading />;
  if (!query.data || query.error instanceof ApiError && [401, 403, 404, 410].includes(query.error.status)) return <><LiveRouteError error={query.error ?? new Error("Case unavailable") } onRetry={query.refetch} />{save.recovery && <div className="care-recovery" role="status"><p>A protected save is still awaiting confirmation. Current access controls its details.</p>{save.error && <p role="alert">{save.error}</p>}<button type="button" className="care-secondary" disabled={save.busy} onClick={() => void save.recover()}>Check exact result</button></div>}</>;
  const detail = query.data; const item = detail.case; const full = detail.access.access_level === "full";
  const sourceChanged = draftRevision !== null && draftRevision !== item.revision;
  const reviewLatest = async () => {
    const latest = await query.refetch({ throwOnError: true });
    if (latest.data) { setDraftRevision(latest.data.case.revision); save.reviewed(); }
  };
  const submit = () => {
    const common = { expected_revision: draftRevision ?? item.revision };
    let input: Record<string, unknown>;
    if (actionKind === "reporting_required" || actionKind === "not_applicable") input = { action: "reporting_decision", reporting_state: actionKind, rationale: note, ...common };
    else if (actionKind === "external_report") input = { action: "external_report", authority_type: authority, reported_at: new Date(reportedAt).toISOString(), reference: note, ...common };
    else if (actionKind === "reassign") input = { action: "reassign", owner_user_id: owner, note, ...common };
    else if (["triage","active","closed"].includes(actionKind)) input = { action: "transition", status: actionKind, note, ...common };
    else input = { action: "add_entry", entry_type: actionKind, note, ...common };
    void save.execute(commandId => actOnCareCase(schoolId, caseId, { ...input, command_id: commandId }));
  };
  return <>{expectedRevision === item.revision ? <AttentionOpenAcknowledgement /> : params.get("attention_notification_id")&&expectedRevision?<AttentionTargetUnavailable message="This protected-case update has changed since the alert was created. It was not marked as opened."/>:null}<section aria-labelledby="care-case-title" className="care-sheet care-sheet--page care-sheet--attention">
    <header><div><small>Restricted case · {title(item.status)}</small><h2 ref={headingRef} tabIndex={-1} id="care-case-title">{item.subject_name}</h2></div></header>
    <div className="care-sheet__body">
      <div className="care-detail-summary"><span><b>{title(item.urgency)}</b><small>{title(item.concern_category)}</small></span><span><b>{title(item.reporting_state)}</b><small>Owner: {item.owner_name}</small></span></div>
      {item.reporting_state === "assessment_required" && <aside className="care-assessment"><AlertTriangle /><p><strong>Reporting assessment is still open.</strong> The software cannot decide the legal duty. For suspected POCSO offences, authorised staff must follow the immediate statutory reporting process.</p></aside>}
      {!full && <aside className="care-receipt"><FileLock2 /><p><strong>Reporter receipt</strong>Your access is limited to the intake you recorded. Later handling notes are visible only to assigned restricted-care staff.</p></aside>}
      {detail.source_content_omitted && <aside className="care-receipt"><FileLock2 /><p>Original protected notes and report references were not copied into this Simulation. Only new records made in this run are shown.</p></aside>}
      <section className="care-timeline"><h3>Protected record</h3>{detail.entries.map((entry) => <article key={entry.id}><span className="care-timeline__mark"><ShieldCheck size={16} /></span><div><small>{title(entry.entry_type)} · {formatDateTime(entry.created_at)}</small><p>{entry.note}</p></div></article>)}</section>
      {full && detail.external_reports.length > 0 && <section className="care-reports"><h3>External reporting evidence</h3>{detail.external_reports.map((report) => <p key={report.id}><b>{title(report.authority_type)}</b><span>Reported {formatDateTime(report.reported_at)} · {report.reference}</span><small>Recorded {formatDateTime(report.created_at)}</small></p>)}</section>}
      {query.error && <p role="alert" className="care-error">The latest view could not be loaded. Your entered action is kept here. <button type="button" className="care-link" onClick={() => void query.refetch()}>Refresh</button></p>}
      {full && item.status !== "closed" && <section className="care-action-panel"><h3>Record next action</h3>
        <fieldset className="care-fields" disabled={save.locked}><div className="care-form-grid">
          <label>Action<select value={actionKind} onChange={(event) => { beginDraft(); setActionKind(event.target.value); if (event.target.value === "external_report") setReportedAt(dateTimeInput(applicationNow())); }}>
            <option value="safety_action">Safety action</option><option value="contact">Contact record</option><option value="case_note">Case note</option>
            {(["owner", "reviewer"].includes(detail.access.assignment_role)) && <><option value="reporting_required">Reporting required</option><option value="not_applicable">Reporting assessed as not applicable</option><option value="external_report">Record external report</option></>}
            <option value="triage">Move to triage</option><option value="active">Mark active</option><option value="closed">Close with outcome</option>
            {detail.access.assignment_role === "owner" && <option value="reassign">Confidential handover</option>}
          </select></label>
          {actionKind === "external_report" && <><label>Authority<select value={authority} onChange={(event) => { beginDraft(); setAuthority(event.target.value); }}><option value="sjpu">SJPU</option><option value="local_police">Local police</option><option value="child_welfare_committee">Child Welfare Committee</option><option value="child_helpline">Child Helpline</option><option value="other">Other authority</option></select></label><label>Reported at<input type="datetime-local" value={reportedAt} max={dateTimeInput(applicationNow())} onChange={event => { beginDraft(); setReportedAt(event.target.value); }} required /></label></>}
          {actionKind === "reassign" && <label>New care lead<select value={owner} onChange={event => { beginDraft(); setOwner(event.target.value); }}><option value="">Choose a care lead</option>{detail.handover_candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} · {title(candidate.role_kind)}</option>)}</select></label>}
        </div>
        {actionKind === "reassign" && <p className="care-hint">This transfers confidential access. You will no longer see handling notes.{!detail.handover_candidates.length && " No eligible replacement is configured on this protected route. Ask the care-team administrator to assign one."}</p>}
        <label>{actionKind === "external_report" ? "Report reference" : actionKind === "reassign" ? "Handover note" : "Factual note / rationale"}<textarea rows={4} value={note} onChange={(event) => { beginDraft(); setNote(event.target.value); }} /></label></fieldset>
        {save.error && <p className="care-error" role="alert">{save.error}</p>}
        {save.recovery ? <button type="button" className="care-primary" disabled={save.busy} onClick={() => void save.recover()}>{save.busy ? "Checking…" : save.recovery === "accepted" ? "Refresh saved record" : save.retryReady ? "Retry exact save" : "Check exact result"}</button>
          : save.reviewNeeded || sourceChanged ? <><p className="care-hint">This case changed. Review its latest record; your note is kept.</p><button type="button" className="care-primary" onClick={() => void reviewLatest().catch(() => undefined)}>Review latest record</button></>
          : <button type="button" className="care-primary" disabled={save.busy || Boolean(query.error) || note.trim().length < (actionKind === "external_report" ? 3 : ["reassign","reporting_required","not_applicable","triage","active","closed"].includes(actionKind) ? 20 : 10) || actionKind === "reassign" && !owner || actionKind === "external_report" && (!reportedAt || Number.isNaN(new Date(reportedAt).getTime()) || new Date(reportedAt) > applicationNow())} onClick={submit}>{save.busy ? "Saving…" : actionKind === "reassign" ? "Hand over case" : "Save action"}</button>}
      </section>}
    </div>
  </section></>;
}

function TeamPanel({ schoolId, scope, data, refresh }: { schoolId: string; scope: readonly unknown[]; data: CareWorkspace; refresh: () => Promise<void> }) {
  const [member, setMember] = useState(data.candidates[0]?.id ?? ""); const [role, setRole] = useState("designated_lead"); const [route, setRoute] = useState("primary");
  const [revokeId, setRevokeId] = useState<string | null>(null); const [reason, setReason] = useState("");
  const assign = useMutation({ mutationFn: () => assignCareRole(schoolId, { user_id: member, role_kind: role, route_kind: route, valid_from: applicationNow().toISOString().slice(0, 10), valid_until: null }), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (assignment: { id: string; revision: number }) => revokeCareRole(schoolId, assignment.id, assignment.revision, reason), onSuccess: async () => { setRevokeId(null); setReason(""); await refresh(); } });
  return <section className="care-team"><h2 className="sr-only">Restricted care team</h2><p>Job title alone does not open case records. Team assignments set intake recipients; each case still requires explicit access.</p>
    <details className="care-team-add"><summary>Add care-team member</summary><div className="care-team-form"><label>Staff member<select value={member} onChange={(event) => setMember(event.target.value)}>{data.candidates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}</select></label><label>Care role<select value={role} onChange={(event) => setRole(event.target.value)}>{["designated_lead","deputy_lead","institution_head","counsellor","external_liaison"].map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label><label>Intake route<select value={route} onChange={(event) => setRoute(event.target.value)}><option value="primary">Primary route</option><option value="alternate">Alternate route</option></select></label><button type="button" className="care-primary" disabled={!member || assign.isPending} onClick={() => assign.mutate()}><Plus size={18} /> Add assignment</button></div></details>
    {(assign.error || revoke.error) && <p className="care-error" role="alert">{(assign.error ?? revoke.error)?.message}</p>}
    <div className="care-team-list">{data.team.map((item) => <article key={item.id} className={item.status === "revoked" ? "is-revoked" : ""}><span className="care-team-list__avatar"><UserRoundCog /></span><div><strong>{item.member_name}</strong><small>{title(item.role_kind)} · {title(item.route_kind)}</small><small>From {new Date(`${item.valid_from}T00:00:00`).toLocaleDateString("en-IN")}{item.valid_until ? ` to ${new Date(`${item.valid_until}T00:00:00`).toLocaleDateString("en-IN")}` : ""}</small></div><em>{item.status}</em>{item.status === "active" && (revokeId === item.id ? <span className="care-revoke"><input aria-label={`Reason to revoke ${item.member_name}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for revocation" /><button type="button" disabled={reason.trim().length < 12} onClick={() => revoke.mutate(item)}>Confirm</button></span> : <button type="button" className="care-link" onClick={() => setRevokeId(item.id)}>Revoke</button>)}</article>)}</div>
    <CareOrphanRecovery schoolId={schoolId} scope={scope} refresh={refresh} />
  </section>;
}

export interface ProtectedCareWorkspaceProps {
  readonly schoolId: string;
  readonly schoolName?: string;
  readonly messageReports?: ReactNode;
}

/**
 * Responsibility-scoped protected-care experience. Available operations come
 * from the care-domain response and exact case access, never from a persona.
 */
export function ProtectedCareWorkspace({ schoolId, schoolName, messageReports }: ProtectedCareWorkspaceProps) {
  const auth = useAuth(), environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  if (environment.mode === "simulation" && environment.unavailable === true) return <OperationsShell active="areas" title="Student care"><LiveRouteError error={new Error("Recover the active Simulation before opening protected care.")} onRetry={auth.refresh} /></OperationsShell>;
  const scope = executionEnvironmentQueryKey(environment, ["restricted-care", schoolId, "actor", auth.user?.id ?? "session"]);
  return <ProtectedCareWorkspaceScope key={JSON.stringify(scope)} schoolId={schoolId} schoolName={schoolName} messageReports={messageReports} scope={scope} />;
}

function ProtectedCareWorkspaceScope({ schoolId, schoolName, messageReports, scope }: ProtectedCareWorkspaceProps & { scope: readonly unknown[] }) {
  const queryClient = useQueryClient(); const [params,setParams]=useSearchParams();
  const tab:Tab=params.get('section')==='team'?'team':params.get('section')==='message_reports'?'message_reports':'cases';
  const intake=params.get('create')==='concern'; const caseId=params.get('case');
  const caseRevision=Number(params.get('case_revision'));
  const reportId=tab==='message_reports'?params.get('report'):null;
  const navigate=(section:Tab,caseToOpen?:string,create=false,replace=!caseToOpen&&!create)=>setParams(current=>{
    const next=new URLSearchParams(current);
    next.set('section',section);
    for(const key of ['case','case_revision','create','report','attention_notification_id','focus'])next.delete(key);
    if(caseToOpen)next.set('case',caseToOpen);
    if(create)next.set('create','concern');
    return next;
  },{replace});
  const listParams=new URLSearchParams(params);
  for(const key of ['case','case_revision','create','report','attention_notification_id','focus'])listParams.delete(key);
  listParams.set('section','cases');
  const baseTitle="Student care";
  const reportListParams=new URLSearchParams(params);
  for(const key of ['report','report_revision','attention_notification_id','focus'])reportListParams.delete(key);
  const pageTitle=intake?'Record a concern':caseId?'Concern details':reportId?'Message report':baseTitle;
  const backTo=intake||caseId?`/areas/care/concerns?${listParams}`:reportId?`/areas/care/concerns?${reportListParams}`:"/areas/care";
  const query = useQuery({ queryKey: [...scope, "workspace"], queryFn: () => getCareWorkspace(schoolId) });
  const refresh = async () => { await query.refetch({ throwOnError: true }); await queryClient.invalidateQueries({ queryKey: ["notifications"] }); };
  const metrics = useMemo(() => ({ open: query.data?.cases.filter((item) => item.status !== "closed").length ?? 0, reporting: query.data?.cases.filter((item) => ["assessment_required","reporting_required"].includes(item.reporting_state)).length ?? 0 }), [query.data]);
  if (query.isPending) return <OperationsShell active="areas" title={pageTitle} subtitle={schoolName} backTo={backTo}><ScreenLoading /></OperationsShell>;
  if (!query.data || query.error instanceof ApiError && [401, 403, 404, 410].includes(query.error.status)) return <OperationsShell active="areas" title={pageTitle} subtitle={schoolName} backTo={backTo}><CarePendingReceipts schoolId={schoolId} scope={scope} onConfirmed={refresh} /><LiveRouteError error={query.error ?? new Error("Protected workspace unavailable") } onRetry={query.refetch} /></OperationsShell>;
  const data = query.data;
  return <OperationsShell active="areas" title={pageTitle} subtitle={schoolName} backTo={backTo}>
    <main className="care-page"><SafetyBanner />
    {query.error && <p className="care-error" role="alert">The latest workspace could not be loaded. Current work is kept here. <button className="care-link" type="button" onClick={() => void query.refetch()}>Refresh</button></p>}
    {intake?<IntakePage key={schoolId} schoolId={schoolId} scope={scope} data={data} refresh={refresh} onClose={()=>navigate('cases')} onCreated={async id=>{await refresh();navigate('cases',id,false,true);}}/>:caseId?<CasePage key={`${schoolId}:${caseId}`} schoolId={schoolId} scope={scope} caseId={caseId} {...(Number.isInteger(caseRevision) && caseRevision > 0 ? { expectedRevision: caseRevision } : {})} onChanged={refresh} onTransferred={() => navigate('cases')}/>:reportId?messageReports:<>
    <CarePendingReceipts schoolId={schoolId} scope={scope} onConfirmed={refresh} onResume={(id, isIntake) => navigate('cases', isIntake ? undefined : id, isIntake)} />
    <nav className="care-tabs" aria-label="Restricted care sections"><button type="button" aria-current={tab==='cases'?'page':undefined} className={tab === "cases" ? "is-active" : ""} onClick={() => navigate("cases")}>Cases</button>{data.can_manage_team && <button type="button" aria-current={tab==='team'?'page':undefined} className={tab === "team" ? "is-active" : ""} onClick={() => navigate("team")}>Care team</button>}{messageReports && <button type="button" aria-current={tab==='message_reports'?'page':undefined} className={tab === "message_reports" ? "is-active" : ""} onClick={() => navigate("message_reports")}>Message reports</button>}</nav>
    {tab === "cases" && <><div className="care-toolbar"><span>{metrics.open} open{metrics.reporting>0?` · ${metrics.reporting} need reporting decisions`:''}</span><button className="care-primary" type="button" onClick={()=>navigate('cases',undefined,true)}><Plus size={18}/>Record a concern</button></div><section className="care-route-status"><span className={data.routes.primary ? "is-ready" : "is-missing"}>{data.routes.primary ? <CheckCircle2 /> : <AlertTriangle />} Primary route · {data.routes.primary} available</span><span className={data.routes.alternate ? "is-ready" : "is-missing"}>{data.routes.alternate ? <CheckCircle2 /> : <AlertTriangle />} Alternate route · {data.routes.alternate} available</span></section><CaseQueue cases={data.cases} onOpen={id => navigate('cases', id)} /></>}
    {tab === "team" && data.can_manage_team && <TeamPanel schoolId={schoolId} scope={scope} data={data} refresh={refresh} />}
    {tab === "message_reports" && messageReports}
    {tab==='team'&&!data.can_manage_team?<p className="care-error" role="alert">You do not have access to care-team settings.</p>:null}
    {tab==='message_reports'&&!messageReports?<p className="care-error" role="alert">Message reports are not available in this view.</p>:null}
    </>}
    <footer className="care-legal"><Clock3 /><p>{data.legal_notice} Case closure does not delete evidence or prove statutory compliance.</p></footer>
    </main>
  </OperationsShell>;
}

/** Compatibility export for bounded callers while canonical routes converge. */
export function RestrictedCarePage(props: ProtectedCareWorkspaceProps) {
  return <ProtectedCareWorkspace {...props} />;
}
