import { useQuery } from "@tanstack/react-query";
import { BookOpenCheck, CalendarRange, ChevronRight, GraduationCap, History, KeyRound, Layers, Mail, School, Settings2, ShieldCheck, UserRoundCheck, UsersRound, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { createInvitation, getAdministration, personName, promoteClass, revokeInvitation, updateMember, type Administration, type Member } from "./api";
import { CatalogManager } from "./CatalogManager";
import "./office.css";
import "../onboarding/onboarding.css";

type Section = "setup" | "access" | "audit";
const sections: Array<{ id: Section; label: string; icon: typeof Settings2 }> = [{ id: "setup", label: "Setup", icon: BookOpenCheck }, { id: "access", label: "Access", icon: KeyRound }, { id: "audit", label: "History", icon: History }];
const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));
const formString = (data: FormData, field: string) => { const value = data.get(field); return typeof value === "string" ? value : ""; };
const auditReason = (item: Administration["audit"][number]) => typeof item.metadata.reason === "string" ? item.metadata.reason : "";

export default function AdministrationPage() {
  const auth = useAuth();
  const schools = auth.memberships.filter((member) => (member.role === "admin" || (member.role === "staff" && member.permissions?.includes("sis.manage"))));
  const [schoolId, setSchoolId] = useState("");
  const [params, setParams] = useSearchParams();
  const requested=params.get("school");
  const currentSchoolId = schoolId || schools.find(m=>m.school_id===requested)?.school_id || schools[0]?.school_id || "";
  const canManageAccess = schools.find(m=>m.school_id===currentSchoolId)?.role==='admin';
  const availableSections=canManageAccess ? sections : sections.filter(s=>s.id!=='access');
  const section = availableSections.some((item) => item.id === params.get("section")) ? params.get("section") as Section : "setup";
  const query = useQuery({ queryKey: ["office", "administration", currentSchoolId], queryFn: () => getAdministration(currentSchoolId), enabled: Boolean(currentSchoolId) });
  const refresh = () => query.refetch().then(() => undefined);
  const activeTerm = query.data?.terms.find((term) => term.is_active) ?? query.data?.terms[0];
  const pendingInvitations = query.data?.invitations.filter((item) => !item.accepted_at && !item.revoked_at && new Date(item.expires_at) > new Date()).length ?? 0;
  return <OperationsShell portal={auth.hasPortal("principal") ? "principal" : "teacher"} active="more" title="School administration" subtitle="Leadership workspace" schoolName={schools.find((school) => school.school_id === currentSchoolId)?.school_name} backTo={auth.hasPortal("principal") ? "/principal/more" : "/teacher/more"} contentHasHeading>
    <div className="office-page">
      {auth.hasPortal("principal") ? <Link className="office-secondary" to="/principal/roles"><ShieldCheck size={18} /> Roles & permissions</Link> : null}
      <header className="office-hero office-hero--admin">
        <div className="office-hero__signal" aria-label={activeTerm ? `Current academic term ${activeTerm.name}` : "No academic term configured"}><span className="office-hero__signal-icon"><CalendarRange size={20} /></span><span>Current term</span><strong>{activeTerm ? activeTerm.name : "Not configured"}</strong></div>
      </header>
      {schools.length > 1 ? <label className="office-field office-context-field">School<select value={currentSchoolId} onChange={(event) => setSchoolId(event.target.value)}>{schools.map((school) => <option key={school.school_id} value={school.school_id}>{school.school_name}</option>)}</select></label> : null}
      {!currentSchoolId ? <p className="office-alert">An active school administrator membership is required.</p> : query.isPending ? <ScreenLoading /> : query.isError ? <LiveRouteError error={query.error} onRetry={query.refetch} /> : query.data ? <>
        <section className="office-metric-grid" aria-label="School overview">
          <div><span className="office-metric-icon"><GraduationCap size={19} /></span><strong>{query.data.students.length}</strong><small>Students</small></div>
          <div><span className="office-metric-icon"><School size={19} /></span><strong>{query.data.classes.length}</strong><small>Classes</small></div>
          <div><span className="office-metric-icon"><BookOpenCheck size={19} /></span><strong>{query.data.subjects.length}</strong><small>Subjects</small></div>
          <div><span className="office-metric-icon"><UserRoundCheck size={19} /></span><strong>{query.data.members.filter((member) => member.is_active).length}</strong><small>Active staff</small></div>
        </section>
        {pendingInvitations ? <p className="office-notice"><Mail size={16} /><span><strong>{pendingInvitations} invitation{pendingInvitations === 1 ? "" : "s"} pending.</strong> Review them under Access.</span></p> : null}
        <nav className="office-tabs office-section-tabs" aria-label="Administration sections">{availableSections.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} aria-current={section === item.id ? "page" : undefined} className={section === item.id ? "is-active" : ""} onClick={() => setParams({ section: item.id })}><Icon size={16} />{item.label}</button>; })}</nav>
        <div className="office-section-content">{section === "setup" ? <><Setup schoolId={currentSchoolId} data={query.data} refresh={refresh} /><Promotion schoolId={currentSchoolId} data={query.data} refresh={refresh} /></> : section === "access" ? <Access schoolId={currentSchoolId} data={query.data} refresh={refresh} /> : <section className="office-panel"><div className="office-panel-heading"><span className="office-panel-icon"><History size={19} /></span><div><h2>Administrative history</h2><p>Accountable changes recorded by the school.</p></div><b>{query.data.audit.length}</b></div>{query.data.audit.length ? <ul className="office-list office-list--cards">{query.data.audit.map((item) => <li key={item.id}><div><strong>{item.action.replaceAll(".", " ")}</strong><span>{personName(item)}, {formatDate(item.created_at)}</span>{auditReason(item) ? <small className="office-audit-reason">Reason: {auditReason(item)}</small> : null}</div></li>)}</ul> : <p className="office-empty">No administrative changes recorded yet.</p>}</section>}</div>
      </> : null}
    </div>
  </OperationsShell>;
}

function Setup({ schoolId, data, refresh }: { schoolId: string; data: Administration; refresh: () => Promise<void> }) {
  const auth=useAuth();const portal=auth.hasPortal("principal")?"principal":"teacher";
  return <>
    {portal==='principal'?<section className="office-panel"><h2>Get your institution ready</h2><ol className="onboarding-steps"><li><strong>1. Academic setup</strong><span>Create the active term, classes and subjects below.</span></li><li><strong>2. Enroll & invite</strong><span><Link to="/principal/students">Enroll students</Link> and <Link to="/principal/invitations">invite staff and families</Link>.</span></li><li><strong>3. Delegate</strong><span><Link to="/principal/roles">Create a role</Link> with Invite school members and school records permissions.</span></li></ol></section>:null}
    <div className="office-link-grid"><Link to={`/${portal}/students`}><span className="office-link-icon"><UsersRound size={20} /></span><span><strong>Students and guardians</strong><small>Open directory and enrolment</small></span><ChevronRight size={18} /></Link><Link to={`/${portal}/students/import`}><span className="office-link-icon"><Layers size={20} /></span><span><strong>Import students</strong><small>Review a bulk enrolment</small></span><ChevronRight size={18} /></Link></div>
    <CatalogManager schoolId={schoolId} data={data} refresh={refresh} />
  </>;
}

function Promotion({ schoolId, data, refresh }: { schoolId: string; data: Administration; refresh: () => Promise<void> }) {
  const [preview, setPreview] = useState<{ count: number; source_term_id: string; target_term_id: string; mappings: Array<{ from_class_id: string; to_class_id: string }> } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (data.terms.length < 2 || data.classes.length < 2) return null;
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
  return <details className="office-disclosure"><summary><span className="office-panel-icon"><Layers size={19} /></span><span><strong>Promote a class</strong><small>Move a reviewed class into its next term.</small></span><ChevronRight size={18} /></summary><div className="office-disclosure__body"><p className="office-hint">Preview the change first. Existing enrolments remain in history, and conflicts stop the promotion.</p><form className="office-form" onSubmit={(event) => void examine(event)}><div className="office-form-grid"><label className="office-field">From term<select name="source_term_id" required onChange={() => setPreview(null)}>{data.terms.map((term) => <option key={term.id} value={term.id}>{term.name}, {term.academic_year}</option>)}</select></label><label className="office-field">To term<select name="target_term_id" required onChange={() => setPreview(null)}>{data.terms.map((term) => <option key={term.id} value={term.id}>{term.name}, {term.academic_year}</option>)}</select></label><label className="office-field">From class<select name="from_class_id" required onChange={() => setPreview(null)}>{data.classes.map((section) => <option key={section.id} value={section.id}>Class {section.grade}{section.section}, {section.academic_year}</option>)}</select></label><label className="office-field">To class<select name="to_class_id" required onChange={() => setPreview(null)}>{data.classes.map((section) => <option key={section.id} value={section.id}>Class {section.grade}{section.section}, {section.academic_year}</option>)}</select></label></div><button className="office-secondary" type="submit" disabled={busy}>{busy ? "Checking…" : "Preview promotion"}</button></form>{preview ? <div className="office-confirm"><strong>{preview.count} students would be promoted</strong><p>Review the selected classes and terms before applying this school record change.</p><label className="office-check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed the target class and term.</label><button type="button" className="office-primary" disabled={busy || !reviewed} onClick={() => void confirm()}>{busy ? "Promoting…" : "Confirm promotion"}</button></div> : null}{error ? <p className="office-alert" role="alert">{error}</p> : null}</div></details>;
}


function Access({ schoolId, data, refresh }: { schoolId: string; data: Administration; refresh: () => Promise<void> }) {
  const [role, setRole] = useState("staff");
  const [invite, setInvite] = useState<{ token: string; email: string; expires_at: string } | null>(null);
  const [selected, setSelected] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(25);
  const members = data.members.filter((member) => `${personName(member)} ${member.email}`.toLowerCase().includes(search.toLowerCase())).slice(0, limit);
  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const emailValue = new FormData(event.currentTarget).get("email");
    const email = typeof emailValue === "string" ? emailValue : "";
    try { const result = await createInvitation(schoolId, { email, role }); setInvite({ ...result, email }); await refresh(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <section className="office-panel"><div className="office-panel-heading"><span className="office-panel-icon"><Mail size={19} /></span><div><h2>Invite a school member</h2><p>Single-use access code, valid for 72 hours.</p></div></div><form className="office-form office-invite-form" onSubmit={(event) => void submitInvite(event)}><label className="office-field">Email<input type="email" name="email" required autoComplete="email" placeholder="name@school.com" /></label><label className="office-field">Role<select value={role} onChange={(event) => setRole(event.target.value)}><option value="staff">Staff</option><option value="admin">Administrator</option><option value="guardian">Guardian</option><option value="student">Student</option></select></label><button className="office-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create invitation"}</button></form>{invite ? <div className="office-secret" role="status"><strong>Invitation ready for {invite.email}</strong><p>Open {window.location.origin}/join and enter this code. It expires {formatDate(invite.expires_at)}.</p><code>{invite.token}</code><button type="button" className="office-secondary" onClick={() => void navigator.clipboard.writeText(invite.token)}>Copy code</button></div> : null}{error ? <p className="office-alert" role="alert">{error}</p> : null}</section>
    <details className="office-disclosure"><summary><span className="office-panel-icon"><Mail size={19} /></span><span><strong>Invitations</strong><small>{data.invitations.length ? `${data.invitations.length} invitation${data.invitations.length === 1 ? "" : "s"}` : "No invitations"}</small></span><ChevronRight size={18} /></summary><div className="office-disclosure__body">{data.invitations.length ? <ul className="office-list office-list--cards">{data.invitations.map((item) => { const pending = !item.accepted_at && !item.revoked_at && new Date(item.expires_at) > new Date(); const state = item.accepted_at ? "Accepted" : item.revoked_at ? "Revoked" : pending ? "Pending" : "Expired"; return <li key={item.id}><div><strong>{item.email}</strong><span>{item.role}, expires {formatDate(item.expires_at)}</span></div><span className={`office-status office-status--${state.toLowerCase()}`}>{state}</span>{pending ? <button type="button" disabled={busy} onClick={() => { setBusy(true); setError(""); void revokeInvitation(schoolId, item.id).then(refresh).catch((cause: Error) => setError(cause.message)).finally(() => setBusy(false)); }}>Revoke</button> : null}</li>; })}</ul> : <p className="office-empty">No invitations yet.</p>}</div></details>
    <section className="office-panel"><div className="office-panel-heading"><span className="office-panel-icon"><UsersRound size={19} /></span><div><h2>School members</h2><p>Review active roles and assigned access.</p></div><b>{data.members.length}</b></div><label className="office-field office-search-field">Find a member<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(25); }} placeholder="Name or email" /></label>{members.length ? <ul className="office-list office-list--cards office-member-list">{members.map((member) => <li key={member.id}><div><strong>{personName(member)}</strong><span>{member.role}, {member.email}</span></div><span className={`office-status ${member.is_active ? "office-status--active" : "office-status--inactive"}`}>{member.is_active ? "Active" : "Inactive"}</span><button type="button" onClick={() => setSelected(member)}>Manage</button></li>)}</ul> : <p className="office-empty">No members match your search.</p>}{data.members.length > limit ? <button type="button" className="office-secondary office-add" onClick={() => setLimit(limit + 50)}>Show more</button> : null}</section>
    {selected ? <MemberEditor member={selected} grants={data.grants.filter((grant) => grant.user_id === selected.user_id).map((grant) => grant.permission)} onCancel={() => setSelected(null)} onSave={async (values) => { await updateMember(schoolId, selected.id, values); setSelected(null); await refresh().catch(() => undefined); }} /> : null}
  </>;
}

export function MemberEditor({ member, grants, onCancel, onSave }: { member: Member; grants: string[]; onCancel: () => void; onSave: (values: { is_active: boolean; permissions: string[] }) => Promise<void> }) {
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
    try { await onSave({ is_active: values.has("active"), permissions: ["sis.manage", "fees.manage"].filter((permission) => values.has(permission)) }); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="office-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onCancel(); }}><section ref={sheet} className="office-sheet office-member-sheet" role="dialog" aria-modal="true" aria-labelledby="member-editor-title"><div className="office-sheet__handle" aria-hidden="true" /><header className="office-sheet__header"><div><span>ACCESS CONTROL</span><h2 id="member-editor-title" ref={heading} tabIndex={-1}>Manage {personName(member)}</h2><p>{member.role} membership and delegated school permissions.</p></div><button type="button" aria-label="Close member editor" onClick={onCancel} disabled={busy}><X size={21} /></button></header><form className="office-form office-catalog-form" onSubmit={(event) => void submit(event)}><section className="office-impact" aria-label="Member access summary"><span><ShieldCheck size={19} /></span><div><strong>{member.is_active ? "Active school member" : "Inactive school member"}</strong><p>{member.email}</p></div></section><label className="office-check"><input type="checkbox" name="active" defaultChecked={member.is_active} /> Active school membership</label>{member.role === "staff" ? <><label className="office-check"><input type="checkbox" name="sis.manage" defaultChecked={grants.includes("sis.manage")} /> Manage school records</label><label className="office-check"><input type="checkbox" name="fees.manage" defaultChecked={grants.includes("fees.manage")} /> Manage fees</label></> : null}<p className="office-hint">The last active administrator cannot be deactivated. Removing access also revokes pending invitations for this account.</p>{error ? <p className="office-alert" role="alert">{error}</p> : null}<div className="office-actions office-sheet__actions"><button type="button" className="office-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="office-primary" disabled={busy}>{busy ? "Saving..." : "Save access"}</button></div></form></section></div>;
}
