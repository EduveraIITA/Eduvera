import { useQuery } from "@tanstack/react-query";
import { ProductIcon, productIconForDestination } from "../../components/ProductIcon";
import { BookOpenCheck, Building2, CheckCircle2, ChevronRight, History, KeyRound, Layers, Mail, MapPin, Settings2, ShieldCheck, UsersRound, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { schoolOptions } from "../auth/schoolOptions";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getAdministration, getInstitutionSetup, personName, promoteClass, updateMember, type Administration, type Member } from "./api";
import { CampusReplicaManager } from "./CampusReplicaManager";
import { CatalogManager } from "./CatalogManager";
import { OperatingRules } from "./OperatingRules";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import "./office.css";
import "../onboarding/onboarding.css";
import "../more/more.css";

type Section = "campus" | "setup" | "access" | "audit" | "promotion" | "rules";
const sections: Array<{ id: Section; label: string; icon: typeof Settings2 }> = [{ id: "campus", label: "Campus & spaces", icon: Building2 }, { id: "setup", label: "Academic structure", icon: BookOpenCheck }, { id: "access", label: "Account access", icon: KeyRound }, { id: "audit", label: "Administrative history", icon: History }, { id: "promotion", label: "Promote a class", icon: Layers }];
const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));
const formString = (data: FormData, field: string) => { const value = data.get(field); return typeof value === "string" ? value : ""; };
const auditReason = (item: Administration["audit"][number]) => typeof item.metadata.reason === "string" ? item.metadata.reason : "";

export function administrationRoute(schoolId: string, section?: Section, rule?: string) {
  const routeParams = new URLSearchParams();
  if (schoolId) routeParams.set("school", schoolId);
  if (section === "rules" && rule) routeParams.set("rule", rule);
  const search = routeParams.toString();
  const base = section === "campus" ? "/more/setup/institution/campus"
    : section === "setup" ? "/more/setup/institution/academics"
    : section === "access" ? "/more/setup/people/access"
    : section === "audit" ? "/more/setup/institution/history"
    : section === "promotion" ? "/more/setup/institution/promotion"
    : section === "rules" ? "/more/setup/institution/operating-rules"
    : "/more/setup/institution";
  return `${base}${search ? `?${search}` : ""}`;
}

export function administrationBackTarget(schoolId: string, section?: Section, rule?: string | null) {
  if (section === "promotion") return "/areas/people/records";
  if (section === "rules" && rule) return administrationRoute(schoolId, "rules");
  if (section) return administrationRoute(schoolId);
  return "/more";
}

export function campusGuidanceBackTarget(params: URLSearchParams, campusIds: readonly string[]): string | undefined {
  const step = params.get("setup_step");
  if (params.get("setup") !== "whole-campus" || !step || !["find", "layout", "connect", "share"].includes(step)) return undefined;
  const campusId = params.get("campus_id");
  const next = new URLSearchParams({ step: campusId && !campusIds.includes(campusId) ? "find" : step });
  if (campusId && campusIds.includes(campusId)) next.set("campus_id", campusId);
  return `/more/setup/whole-campus?${next}`;
}

export default function AdministrationPage({ setupBackTo, accessBackTo }: { setupBackTo?: string; accessBackTo?: string } = {}) {
  const auth = useAuth();
  const environment = useOptionalExecutionEnvironment();
  const worldKey = executionEnvironmentIdentity(environment ?? { mode: "live" });
  const location = useLocation();
  const memberships = auth.memberships.filter(member => member.role === "admin" || member.permissions?.includes("sis.manage"));
  const schools = schoolOptions(memberships);
  const [selectedSchool, setSelectedSchool] = useState("");
  const [params] = useSearchParams();
  const guidedCampusRoute = location.pathname.endsWith("/campus") && params.get("setup") === "whole-campus"
    && ["find", "layout", "connect", "share"].includes(params.get("setup_step") ?? "");
  const currentInstitutionId = environment?.institutionId ?? auth.user?.active_school_id;
  const schoolId = guidedCampusRoute ? schools.find(member => member.school_id === currentInstitutionId)?.school_id ?? ""
    : selectedSchool || schools.find(m => m.school_id === params.get("school"))?.school_id || schools[0]?.school_id || "";
  const guidedInstitutionMismatch = guidedCampusRoute && Boolean(params.get("school") && params.get("school") !== schoolId);
  const canManageAccess = memberships.some(m => m.school_id === schoolId && m.role === "admin");
  const available = [...sections, { id: "rules" as const, label: "Operating rules", icon: Settings2 }].filter(item => canManageAccess || (item.id !== "access" && item.id !== "rules"));
  const routeSection: Section | undefined = location.pathname === "/more/setup/people" || location.pathname.endsWith("/access") ? "access"
    : location.pathname.endsWith("/campus") ? "campus"
    : location.pathname.endsWith("/academics") ? "setup"
    : location.pathname.endsWith("/history") ? "audit"
    : location.pathname.endsWith("/promotion") ? "promotion"
    : location.pathname.endsWith("/operating-rules") ? "rules"
    : undefined;
  const section = available.find(item => item.id === (routeSection ?? params.get("section")));
  const selectedRule = params.get("rule");
  const query = useQuery({ queryKey: ["office", "administration", worldKey, schoolId], queryFn: () => getAdministration(schoolId), enabled: Boolean(schoolId) && !guidedInstitutionMismatch });
  const setupQuery = useQuery({ queryKey: executionEnvironmentQueryKey(environment ?? { mode: "live" }, ["institution-setup", schoolId]), queryFn: () => getInstitutionSetup(schoolId), enabled: Boolean(schoolId) && !guidedInstitutionMismatch });
  const refresh = () => query.refetch().then(() => undefined);
  const canGuide = !guidedInstitutionMismatch && schoolId === currentInstitutionId
    && memberships.some(member => member.school_id === schoolId && member.role === "admin" && member.access_scope !== "assigned_work");
  const guideBackTo = section?.id === "campus" && canGuide
    ? campusGuidanceBackTarget(params, setupQuery.data?.campuses.filter(campus => campus.status === "active").map(campus => campus.id) ?? []) : undefined;
  const backTo = guideBackTo ?? (section?.id === "access" && accessBackTo
    ? accessBackTo
    : !section && setupBackTo
      ? setupBackTo
      : administrationBackTarget(schoolId, section?.id, selectedRule));
  return <OperationsShell active="more" title={section?.label ?? "Campus foundation"} schoolName={schools.find(s => s.school_id === schoolId)?.school_name} backTo={backTo}>
    <div className="office-page">
      {guideBackTo ? <aside className="office-panel"><strong>Build your campus as you go</strong><p className="office-hint">Add only the places you need now. Rooms, equipment and other details can be added here later.</p><Link className="office-secondary" to={guideBackTo}>Return to campus guide<ChevronRight size={18}/></Link></aside> : null}
      {schools.length > 1 && !guidedCampusRoute ? <label className="office-field">Institution<select value={schoolId} onChange={event => setSelectedSchool(event.target.value)}>{schools.map(school => <option key={school.school_id} value={school.school_id}>{school.school_name}</option>)}</select></label> : null}
      {guidedInstitutionMismatch ? <section className="office-alert" role="alert"><h2>Your campus context has changed</h2><p>Return to the campus guide and choose the current campus before editing.</p><Link to="/more/setup/whole-campus">Return to campus guide</Link></section> : !schoolId ? <p className="office-alert">An active institution membership is required.</p> : query.isPending ? <ScreenLoading/> : query.isError ? <LiveRouteError error={query.error} onRetry={query.refetch}/> : query.data ? <>
        {!section ? <div className="office-setup-home"><section className="office-setup-home__intro"><div><span className="office-eyebrow"><MapPin size={13}/>INSTITUTE SETUP</span><h2>Set up only what you use</h2><p>Begin with one class or map every branch. Existing people, places and classes stay connected as you expand.</p></div>{setupQuery.data ? <div className="office-setup-home__connection"><CheckCircle2 size={19}/><span><strong>Connected setup</strong><small>{setupQuery.data.readiness.filter((item)=>item.complete).length} areas ready</small></span></div>:null}</section>
          {setupQuery.data ? <section className="office-setup-home__metrics" aria-label="Institution setup summary"><div><strong>{setupQuery.data.summary.campuses}</strong><span>Campuses</span></div><div><strong>{setupQuery.data.summary.spaces}</strong><span>Spaces</span></div><div><strong>{setupQuery.data.summary.classes}</strong><span>Classes</span></div><div><strong>{setupQuery.data.summary.staff}</strong><span>Staff</span></div></section>:null}
          <section className="office-setup-domain"><h3>Campus foundation</h3><nav className="more-grid more-grid--list" aria-label="Campus foundation"><SetupLink icon={Building2} title="Campus & spaces" detail="Branches, buildings, rooms and equipment" to={administrationRoute(schoolId, "campus")} status={setupQuery.data?.readiness.find((item)=>item.key==="spaces")?.detail}/><SetupLink icon={BookOpenCheck} title="Academic structure" detail="Terms, classes and subjects" to={administrationRoute(schoolId, "setup")}/><SetupLink icon={UsersRound} title="People & responsibilities" detail="Staff records, scoped work and fallback" to="/more/setup/responsibilities"/>{canManageAccess ? <SetupLink icon={KeyRound} title="Account access" detail="Administrators, staff and invitations" to={administrationRoute(schoolId, "access")}/> : null}</nav></section>
          <section className="office-setup-domain"><h3>Growth & trust</h3><nav className="more-grid more-grid--list" aria-label="Growth and trust">{canManageAccess ? <><SetupLink icon={CheckCircle2} title="Capabilities" detail="Working now, useful next and capabilities available anytime" to="/more/setup/capabilities"/><SetupLink icon={ShieldCheck} title="Organisation verification" detail="Verify only when a trusted feature needs it" to="/more/verification"/><SetupLink icon={Settings2} title="Operating rules" detail="Automatic behaviour and exception handling" to={administrationRoute(schoolId, "rules")}/></> : null}<SetupLink icon={History} title="Administrative history" detail="Audited configuration changes" to={administrationRoute(schoolId, "audit")}/></nav></section>
        </div> : null}
        {section?.id === "campus" ? <CampusReplicaManager key={`${worldKey}:${schoolId}`} schoolId={schoolId} initialCampusId={params.get("campus_id") ?? undefined}/> : null}
        {section?.id === "setup" ? <CatalogManager schoolId={schoolId} data={query.data} refresh={refresh}/> : null}
        {section?.id === "rules" && canManageAccess ? <OperatingRules key={schoolId} schoolId={schoolId}/> : null}
        {section?.id === "promotion" ? <Promotion schoolId={schoolId} data={query.data} refresh={refresh}/> : null}
        {section?.id === "access" ? <Access schoolId={schoolId} data={query.data} refresh={refresh}/> : null}
        {section?.id === "audit" ? <section className="office-panel"><h2>Administrative history</h2>{query.data.audit.length ? <ul className="office-list office-list--cards">{query.data.audit.map(item => <li key={item.id}><div><strong>{item.action.replaceAll(".", " ")}</strong><span>{personName(item)}, {formatDate(item.created_at)}</span>{auditReason(item) ? <small>Reason: {auditReason(item)}</small> : null}</div></li>)}</ul> : <p className="office-empty">No administrative changes recorded yet.</p>}</section> : null}
      </> : null}
    </div>
  </OperationsShell>;
}

function SetupLink({ title, detail, to, status }: { icon: typeof Settings2; title: string; detail: string; to: string; status?: string }) {
  return <Link className="more-tile office-setup-link" to={to}><span className="more-tile__icon"><ProductIcon name={productIconForDestination(to, title === "Academic structure" ? "learning" : "settings")} size={28}/></span><span className="more-tile__copy"><strong>{title}</strong><small>{detail}</small></span>{status ? <b>{status}</b>:null}<ChevronRight size={18}/></Link>;
}

function Promotion({ schoolId, data, refresh }: { schoolId: string; data: Administration; refresh: () => Promise<void> }) {
  const [preview, setPreview] = useState<{ count: number; source_term_id: string; target_term_id: string; mappings: Array<{ from_class_id: string; to_class_id: string }> } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (data.terms.length < 2 || data.classes.length < 2) return <p className="office-empty">Create the next academic term and destination classes in Academic setup before promoting students.</p>;
  async function examine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setPreview(null); setReviewed(false);
    const values = new FormData(event.currentTarget);
    const input = { source_term_id: formString(values, "source_term_id"), target_term_id: formString(values, "target_term_id"), mappings: [{ from_class_id: formString(values, "from_class_id"), to_class_id: formString(values, "to_class_id") }], confirm: false };
    try { const result = await promoteClass(schoolId, input); setPreview({ ...input, count: result.count }); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!preview) return; setBusy(true); setError("");
    try { await promoteClass(schoolId, { ...preview, confirm: true }); await refresh(); setPreview(null); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="office-panel"><div className="office-disclosure__body"><p className="office-hint">Preview the change first. Existing enrolments remain in history, and conflicts stop the promotion.</p><form className="office-form" onSubmit={(event) => void examine(event)}><div className="office-form-grid"><label className="office-field">From term<select name="source_term_id" required onChange={() => setPreview(null)}>{data.terms.map((term) => <option key={term.id} value={term.id}>{term.name}, {term.academic_year}</option>)}</select></label><label className="office-field">To term<select name="target_term_id" required onChange={() => setPreview(null)}>{data.terms.map((term) => <option key={term.id} value={term.id}>{term.name}, {term.academic_year}</option>)}</select></label><label className="office-field">From class<select name="from_class_id" required onChange={() => setPreview(null)}>{data.classes.map((section) => <option key={section.id} value={section.id}>Class {section.grade}{section.section}, {section.academic_year}</option>)}</select></label><label className="office-field">To class<select name="to_class_id" required onChange={() => setPreview(null)}>{data.classes.map((section) => <option key={section.id} value={section.id}>Class {section.grade}{section.section}, {section.academic_year}</option>)}</select></label></div><button className="office-secondary" type="submit" disabled={busy}>{busy ? "Checking…" : "Preview promotion"}</button></form>{preview ? <div className="office-confirm"><strong>{preview.count} students would be promoted</strong><p>Review the selected classes and terms before applying this school record change.</p><label className="office-check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed the target class and term.</label><button type="button" className="office-primary" disabled={busy || !reviewed} onClick={() => void confirm()}>{busy ? "Promoting…" : "Confirm promotion"}</button></div> : null}{error ? <p className="office-alert" role="alert">{error}</p> : null}</div></section>;
}


function Access({ schoolId, data, refresh }: { schoolId: string; data: Administration; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<Member | null>(null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(25);
  const accountMembers = data.members.filter((member) => member.role === "admin" || member.role === "staff");
  const members = accountMembers.filter((member) => `${personName(member)} ${member.email}`.toLowerCase().includes(search.toLowerCase())).slice(0, limit);
  return <>
    <Link className="office-secondary" to={"/more/setup/people/invitations?from=settings&school=" + encodeURIComponent(schoolId)}><Mail size={18}/>Invitations</Link>
    <section className="office-panel"><div className="office-panel-heading"><span className="office-panel-icon"><UsersRound size={19} /></span><div><h2>Administrator & staff access</h2><p>Learner and guardian accounts remain with their connected student records.</p></div><b>{accountMembers.length}</b></div><label className="office-field office-search-field">Find an administrator or staff member<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(25); }} placeholder="Name or email" /></label>{members.length ? <ul className="office-list office-list--cards office-member-list">{members.map((member) => <li key={member.id}><div><strong>{personName(member)}</strong><span>{member.role}, {member.email}</span></div><span className={`office-status ${member.is_active ? "office-status--active" : "office-status--inactive"}`}>{member.is_active ? "Active" : "Inactive"}</span><button type="button" onClick={() => setSelected(member)}>Manage</button></li>)}</ul> : <p className="office-empty">No administrators or staff match your search.</p>}{accountMembers.length > limit ? <button type="button" className="office-secondary office-add" onClick={() => setLimit(limit + 50)}>Show more</button> : null}</section>
    {selected ? <MemberEditor member={selected} onCancel={() => setSelected(null)} onSave={async (values) => { await updateMember(schoolId, selected.id, values); setSelected(null); await refresh().catch(() => undefined); }} /> : null}
  </>;
}

export function MemberEditor({ member, onCancel, onSave }: { member: Member; onCancel: () => void; onSave: (values: { is_active: boolean }) => Promise<void> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    heading.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
      if (event.key !== "Tab" || !sheet.current) return;
      const controls = [...sheet.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", handleKey); };
  }, [busy, onCancel]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = new FormData(event.currentTarget);
    try { await onSave({ is_active: values.has("active") }); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="office-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onCancel(); }}><section ref={sheet} className="office-sheet office-member-sheet" role="dialog" aria-modal="true" aria-labelledby="member-editor-title"><div className="office-sheet__handle" aria-hidden="true" /><header className="office-sheet__header"><div><span>MEMBERSHIP</span><h2 id="member-editor-title" ref={heading} tabIndex={-1}>Manage {personName(member)}</h2><p>{member.role} membership in this institution.</p></div><button type="button" aria-label="Close member editor" onClick={onCancel} disabled={busy}><X size={21} /></button></header><form className="office-form office-catalog-form" onSubmit={(event) => void submit(event)}><section className="office-impact" aria-label="Member access summary"><span><ShieldCheck size={19} /></span><div><strong>{member.is_active ? "Active institution member" : "Inactive institution member"}</strong><p>{member.email}</p></div></section><label className="office-check"><input type="checkbox" name="active" defaultChecked={member.is_active} /> Active institution membership</label>{member.role === "staff" ? <Link className="office-secondary" to="/more/setup/responsibilities" onClick={onCancel}>Manage responsibilities</Link> : null}<p className="office-hint">The last active administrator cannot be deactivated. Deactivation ends active temporary exceptions.</p>{error ? <p className="office-alert" role="alert">{error}</p> : null}<div className="office-actions office-sheet__actions"><button type="button" className="office-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="office-primary" disabled={busy}>{busy ? "Saving..." : "Save membership"}</button></div></form></section></div>;
}
