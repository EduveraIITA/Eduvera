import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, FileLock2, PhoneCall, Plus, ShieldAlert, ShieldCheck, UserRoundCog, X } from "lucide-react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { actOnCareCase, assignCareRole, getCareCase, getCareWorkspace, openCareCase, revokeCareRole, type CareCaseSummary, type CareWorkspace } from "./api";
import "./restricted-care.css";

type Portal = "teacher" | "principal";
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

function IntakeDialog({ schoolId, data, onClose, onCreated }: { schoolId: string; data: CareWorkspace; onClose: () => void; onCreated: (caseId: string) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState({ student_id: "", intake_route: "primary", source_kind: "staff_observation", urgency: "priority", concern_category: "emotional_wellbeing", safety_state: "unknown", ordinary_handler_involved: false, details: "" });
  const mutation = useMutation({ mutationFn: () => openCareCase(schoolId, { ...form, student_id: form.student_id || null, observed_at: null }), onSuccess: (result) => onCreated(result.id) });
  useEffect(() => { closeRef.current?.focus(); }, []);
  const set = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="care-modal" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="care-intake-title" className="care-sheet">
    <header><div><small>Protected intake</small><h2 id="care-intake-title">Record a concern</h2></div><button ref={closeRef} type="button" aria-label="Close concern form" onClick={onClose}><X /></button></header>
    <div className="care-sheet__body">
      <aside className="care-form-warning"><ShieldAlert /><p>Record what was seen, heard or disclosed. Do not investigate, confront an alleged person, promise secrecy or delay urgent external help.</p></aside>
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
      {mutation.error && <p className="care-error" role="alert">{mutation.error.message}</p>}
    </div>
    <footer><button type="button" className="care-secondary" onClick={onClose}>Cancel</button><button type="button" className="care-primary" disabled={mutation.isPending || form.details.trim().length < 20} onClick={() => mutation.mutate()}>{mutation.isPending ? "Recording…" : "Record in protected workspace"}</button></footer>
  </section></div>;
}

function CaseDialog({ schoolId, caseId, onClose, onChanged }: { schoolId: string; caseId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [actionKind, setActionKind] = useState("case_note");
  const [note, setNote] = useState("");
  const [authority, setAuthority] = useState("local_police");
  const query = useQuery({ queryKey: ["restricted-care", "case", schoolId, caseId], queryFn: () => getCareCase(schoolId, caseId) });
  const mutation = useMutation({ mutationFn: (input: Record<string, unknown>) => actOnCareCase(schoolId, caseId, input), onSuccess: async () => { setNote(""); await query.refetch(); await onChanged(); } });
  useEffect(() => { closeRef.current?.focus(); }, []);
  if (query.isPending) return <div className="care-modal"><section className="care-sheet care-sheet--detail"><ScreenLoading /></section></div>;
  if (query.error || !query.data) return <div className="care-modal"><section className="care-sheet care-sheet--detail"><LiveRouteError error={query.error ?? new Error("Case unavailable") } onRetry={query.refetch} /></section></div>;
  const detail = query.data; const item = detail.case; const full = detail.access.access_level === "full";
  const submit = () => {
    const common = { expected_revision: item.revision };
    if (actionKind === "reporting_required" || actionKind === "not_applicable") mutation.mutate({ action: "reporting_decision", reporting_state: actionKind, rationale: note, ...common });
    else if (actionKind === "external_report") mutation.mutate({ action: "external_report", authority_type: authority, reported_at: new Date().toISOString(), reference: note, ...common });
    else if (["triage","active","closed"].includes(actionKind)) mutation.mutate({ action: "transition", status: actionKind, note, ...common });
    else mutation.mutate({ action: "add_entry", entry_type: actionKind, note, ...common });
  };
  return <div className="care-modal"><section role="dialog" aria-modal="true" aria-labelledby="care-case-title" className="care-sheet care-sheet--detail">
    <header><div><small>Restricted case · {title(item.status)}</small><h2 id="care-case-title">{item.subject_name}</h2></div><button ref={closeRef} type="button" aria-label="Close case" onClick={onClose}><X /></button></header>
    <div className="care-sheet__body">
      <div className="care-detail-summary"><span><b>{title(item.urgency)}</b><small>{title(item.concern_category)}</small></span><span><b>{title(item.reporting_state)}</b><small>Owner: {item.owner_name}</small></span></div>
      {item.reporting_state === "assessment_required" && <aside className="care-assessment"><AlertTriangle /><p><strong>Reporting assessment is still open.</strong> The software cannot decide the legal duty. For suspected POCSO offences, authorised staff must follow the immediate statutory reporting process.</p></aside>}
      {!full && <aside className="care-receipt"><FileLock2 /><p><strong>Reporter receipt</strong>Your access is limited to the intake you recorded. Later handling notes are visible only to assigned restricted-care staff.</p></aside>}
      <section className="care-timeline"><h3>Protected record</h3>{detail.entries.map((entry) => <article key={entry.id}><span className="care-timeline__mark"><ShieldCheck size={16} /></span><div><small>{title(entry.entry_type)} · {formatDateTime(entry.created_at)}</small><p>{entry.note}</p></div></article>)}</section>
      {full && detail.external_reports.length > 0 && <section className="care-reports"><h3>External reporting evidence</h3>{detail.external_reports.map((report) => <p key={report.id}><b>{title(report.authority_type)}</b><span>{formatDateTime(report.reported_at)} · {report.reference}</span></p>)}</section>}
      {full && <section className="care-action-panel"><h3>Record next action</h3><div className="care-form-grid"><label>Action<select value={actionKind} onChange={(event) => setActionKind(event.target.value)}><option value="safety_action">Safety action</option><option value="contact">Contact record</option><option value="case_note">Case note</option><option value="reporting_required">Reporting required</option><option value="not_applicable">Reporting assessed as not applicable</option><option value="external_report">Record external report</option><option value="triage">Move to triage</option><option value="active">Mark active</option><option value="closed">Close with outcome</option></select></label>{actionKind === "external_report" && <label>Authority<select value={authority} onChange={(event) => setAuthority(event.target.value)}><option value="sjpu">SJPU</option><option value="local_police">Local police</option><option value="child_welfare_committee">Child Welfare Committee</option><option value="child_helpline">Child Helpline</option><option value="other">Other authority</option></select></label>}</div><label>{actionKind === "external_report" ? "Report reference" : "Factual note / rationale"}<textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></label>{mutation.error && <p className="care-error" role="alert">{mutation.error.message}</p>}<button type="button" className="care-primary" disabled={mutation.isPending || note.trim().length < (actionKind === "external_report" ? 3 : 10)} onClick={submit}>{mutation.isPending ? "Saving…" : "Save protected action"}</button></section>}
    </div>
  </section></div>;
}

function TeamPanel({ schoolId, data, refresh }: { schoolId: string; data: CareWorkspace; refresh: () => Promise<void> }) {
  const [member, setMember] = useState(data.candidates[0]?.id ?? ""); const [role, setRole] = useState("designated_lead"); const [route, setRoute] = useState("primary");
  const [revokeId, setRevokeId] = useState<string | null>(null); const [reason, setReason] = useState("");
  const assign = useMutation({ mutationFn: () => assignCareRole(schoolId, { user_id: member, role_kind: role, route_kind: route, valid_from: new Date().toISOString().slice(0, 10), valid_until: null }), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (assignment: { id: string; revision: number }) => revokeCareRole(schoolId, assignment.id, assignment.revision, reason), onSuccess: async () => { setRevokeId(null); setReason(""); await refresh(); } });
  return <section className="care-team"><header><div><small>Purpose-specific access</small><h2>Restricted care team</h2></div><ShieldCheck /></header><p>Job title alone does not open case records. These dated assignments configure who receives primary and alternate intakes; each case still grants explicit access.</p>
    <div className="care-team-form"><label>Staff member<select value={member} onChange={(event) => setMember(event.target.value)}>{data.candidates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}</select></label><label>Care role<select value={role} onChange={(event) => setRole(event.target.value)}>{["designated_lead","deputy_lead","institution_head","counsellor","external_liaison"].map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label><label>Intake route<select value={route} onChange={(event) => setRoute(event.target.value)}><option value="primary">Primary route</option><option value="alternate">Alternate route</option></select></label><button type="button" className="care-primary" disabled={!member || assign.isPending} onClick={() => assign.mutate()}><Plus size={18} /> Add assignment</button></div>
    {(assign.error || revoke.error) && <p className="care-error" role="alert">{(assign.error ?? revoke.error)?.message}</p>}
    <div className="care-team-list">{data.team.map((item) => <article key={item.id} className={item.status === "revoked" ? "is-revoked" : ""}><span className="care-team-list__avatar"><UserRoundCog /></span><div><strong>{item.member_name}</strong><small>{title(item.role_kind)} · {title(item.route_kind)}</small><small>From {new Date(`${item.valid_from}T00:00:00`).toLocaleDateString("en-IN")}{item.valid_until ? ` to ${new Date(`${item.valid_until}T00:00:00`).toLocaleDateString("en-IN")}` : ""}</small></div><em>{item.status}</em>{item.status === "active" && (revokeId === item.id ? <span className="care-revoke"><input aria-label={`Reason to revoke ${item.member_name}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for revocation" /><button type="button" disabled={reason.trim().length < 12} onClick={() => revoke.mutate(item)}>Confirm</button></span> : <button type="button" className="care-link" onClick={() => setRevokeId(item.id)}>Revoke</button>)}</article>)}</div>
  </section>;
}

export function RestrictedCarePage({ portal, schoolId, schoolName, messageReports }: { portal: Portal; schoolId: string; schoolName?: string; messageReports?: ReactNode }) {
  const queryClient = useQueryClient(); const [tab, setTab] = useState<Tab>("cases"); const [intake, setIntake] = useState(false); const [caseId, setCaseId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["restricted-care", "workspace", schoolId], queryFn: () => getCareWorkspace(schoolId) });
  const refresh = async () => { await query.refetch(); await queryClient.invalidateQueries({ queryKey: ["notifications"] }); };
  const metrics = useMemo(() => ({ open: query.data?.cases.filter((item) => item.status !== "closed").length ?? 0, reporting: query.data?.cases.filter((item) => ["assessment_required","reporting_required"].includes(item.reporting_state)).length ?? 0 }), [query.data]);
  if (query.isPending) return <OperationsShell portal={portal} active="safeguarding" title={portal === "principal" ? "Student concerns" : "Restricted care"} subtitle={schoolName}><ScreenLoading /></OperationsShell>;
  if (query.error || !query.data) return <OperationsShell portal={portal} active="safeguarding" title={portal === "principal" ? "Student concerns" : "Restricted care"} subtitle={schoolName}><LiveRouteError error={query.error ?? new Error("Protected workspace unavailable") } onRetry={query.refetch} /></OperationsShell>;
  const data = query.data;
  return <OperationsShell portal={portal} active="safeguarding" title={portal === "principal" ? "Student concerns" : "Restricted care"} subtitle={schoolName}>
    <main className="care-page"><SafetyBanner /><section className="care-overview"><div><small>Your assigned cases</small><strong>{metrics.open}</strong><span>open cases</span></div><div><small>Needs reporting decision</small><strong>{metrics.reporting}</strong><span>assigned to you</span></div><button type="button" onClick={() => setIntake(true)}><Plus /> Record a concern</button></section>
    <nav className="care-tabs" aria-label="Restricted care sections"><button type="button" className={tab === "cases" ? "is-active" : ""} onClick={() => setTab("cases")}>Cases</button>{data.can_manage_team && <button type="button" className={tab === "team" ? "is-active" : ""} onClick={() => setTab("team")}>Care team</button>}{messageReports && <button type="button" className={tab === "message_reports" ? "is-active" : ""} onClick={() => setTab("message_reports")}>Message reports</button>}</nav>
    {tab === "cases" && <><section className="care-route-status"><span className={data.routes.primary ? "is-ready" : "is-missing"}>{data.routes.primary ? <CheckCircle2 /> : <AlertTriangle />} Primary route · {data.routes.primary} available</span><span className={data.routes.alternate ? "is-ready" : "is-missing"}>{data.routes.alternate ? <CheckCircle2 /> : <AlertTriangle />} Alternate route · {data.routes.alternate} available</span></section><section className="care-queue"><header><div><small>Restricted to explicit assignments</small><h2>My protected cases</h2></div><FileLock2 /></header>{data.cases.length ? data.cases.map((item) => <CaseCard key={item.id} item={item} onOpen={() => setCaseId(item.id)} />) : <div className="care-empty"><ShieldCheck /><strong>No assigned cases</strong><p>This does not mean the institution has no concerns. You only see cases explicitly assigned to you.</p></div>}</section></>}
    {tab === "team" && data.can_manage_team && <TeamPanel schoolId={schoolId} data={data} refresh={refresh} />}
    {tab === "message_reports" && messageReports}
    <footer className="care-legal"><Clock3 /><p>{data.legal_notice} Case closure does not delete evidence or prove statutory compliance.</p></footer>
    {intake && <IntakeDialog schoolId={schoolId} data={data} onClose={() => setIntake(false)} onCreated={(id) => { setIntake(false); setCaseId(id); void refresh(); }} />}
    {caseId && <CaseDialog schoolId={schoolId} caseId={caseId} onClose={() => setCaseId(null)} onChanged={refresh} />}
    </main>
  </OperationsShell>;
}
