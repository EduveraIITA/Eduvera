import { useQuery } from "@tanstack/react-query";
import { BookOpenCheck, ChevronRight, History, KeyRound, Layers, Mail, Settings2, ShieldCheck, UsersRound, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getAdministration, personName, promoteClass, updateMember, type Administration, type Member } from "./api";
import { CatalogManager } from "./CatalogManager";
import "./office.css";
import "../onboarding/onboarding.css";
import "../more/more.css";

type Section = "setup" | "access" | "audit" | "promotion";
const sections: Array<{ id: Section; label: string; icon: typeof Settings2 }> = [{ id: "setup", label: "Academic setup", icon: BookOpenCheck }, { id: "access", label: "Account access", icon: KeyRound }, { id: "audit", label: "Administrative history", icon: History }, { id: "promotion", label: "Promote a class", icon: Layers }];
const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));
const formString = (data: FormData, field: string) => { const value = data.get(field); return typeof value === "string" ? value : ""; };
const auditReason = (item: Administration["audit"][number]) => typeof item.metadata.reason === "string" ? item.metadata.reason : "";

export default function AdministrationPage() {
  const auth = useAuth();
  const schools = auth.memberships.filter(member => member.role === "admin" || (member.role === "staff" && member.permissions?.includes("sis.manage")));
  const [selectedSchool, setSelectedSchool] = useState("");
  const [params] = useSearchParams();
  const schoolId = selectedSchool || schools.find(m => m.school_id === params.get("school"))?.school_id || schools[0]?.school_id || "";
  const canManageAccess = schools.find(m => m.school_id === schoolId)?.role === "admin";
  const available = sections.filter(item => canManageAccess || item.id !== "access");
  const section = available.find(item => item.id === params.get("section"));
  const portal = auth.hasPortal("principal") ? "principal" : "teacher";
  const base = '/' + portal + '/administration?school=' + encodeURIComponent(schoolId);
  const query = useQuery({ queryKey: ["office", "administration", schoolId], queryFn: () => getAdministration(schoolId), enabled: Boolean(schoolId) });
  const refresh = () => query.refetch().then(() => undefined);
  return <OperationsShell portal={portal} active="more" title={section?.label ?? "Institute settings"} schoolName={schools.find(s => s.school_id === schoolId)?.school_name} backTo={section?.id === "promotion" ? '/' + portal + '/students' : section ? base : '/' + portal + '/more'}>
    <div className="office-page">
      {schools.length > 1 ? <label className="office-field">Institution<select value={schoolId} onChange={event => setSelectedSchool(event.target.value)}>{schools.map(school => <option key={school.school_id} value={school.school_id}>{school.school_name}</option>)}</select></label> : null}
      {!schoolId ? <p className="office-alert">An active institution membership is required.</p> : query.isPending ? <ScreenLoading/> : query.isError ? <LiveRouteError error={query.error} onRetry={query.refetch}/> : query.data ? <>
        {!section ? <nav className="more-grid more-grid--list" aria-label="Institute settings">
          {available.filter(item => item.id !== "promotion").map(item => { const Icon = item.icon; return <Link key={item.id} className="more-tile" to={base + '&section=' + item.id}><span className="more-tile__icon"><Icon size={20}/></span><span className="more-tile__copy"><strong>{item.label}</strong></span><ChevronRight size={18}/></Link>; })}
          {canManageAccess ? <Link className="more-tile" to={'/principal/activation?school=' + encodeURIComponent(schoolId)}><span className="more-tile__icon"><ShieldCheck size={20}/></span><span className="more-tile__copy"><strong>Setup status</strong></span><ChevronRight size={18}/></Link> : null}
        </nav> : null}
        {section?.id === "setup" ? <CatalogManager schoolId={schoolId} data={query.data} refresh={refresh}/> : null}
        {section?.id === "promotion" ? <Promotion schoolId={schoolId} data={query.data} refresh={refresh}/> : null}
        {section?.id === "access" ? <Access schoolId={schoolId} data={query.data} refresh={refresh}/> : null}
        {section?.id === "audit" ? <section className="office-panel"><h2>Administrative history</h2>{query.data.audit.length ? <ul className="office-list office-list--cards">{query.data.audit.map(item => <li key={item.id}><div><strong>{item.action.replaceAll(".", " ")}</strong><span>{personName(item)}, {formatDate(item.created_at)}</span>{auditReason(item) ? <small>Reason: {auditReason(item)}</small> : null}</div></li>)}</ul> : <p className="office-empty">No administrative changes recorded yet.</p>}</section> : null}
      </> : null}
    </div>
  </OperationsShell>;
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
  const members = data.members.filter((member) => `${personName(member)} ${member.email}`.toLowerCase().includes(search.toLowerCase())).slice(0, limit);
  return <>
    <Link className="office-secondary" to={"/principal/invitations?from=settings&school=" + encodeURIComponent(schoolId)}><Mail size={18}/>Invitations</Link>
    <section className="office-panel"><div className="office-panel-heading"><span className="office-panel-icon"><UsersRound size={19} /></span><div><h2>School members</h2><p>Review active roles and assigned access.</p></div><b>{data.members.length}</b></div><label className="office-field office-search-field">Find a member<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(25); }} placeholder="Name or email" /></label>{members.length ? <ul className="office-list office-list--cards office-member-list">{members.map((member) => <li key={member.id}><div><strong>{personName(member)}</strong><span>{member.role}, {member.email}</span></div><span className={`office-status ${member.is_active ? "office-status--active" : "office-status--inactive"}`}>{member.is_active ? "Active" : "Inactive"}</span><button type="button" onClick={() => setSelected(member)}>Manage</button></li>)}</ul> : <p className="office-empty">No members match your search.</p>}{data.members.length > limit ? <button type="button" className="office-secondary office-add" onClick={() => setLimit(limit + 50)}>Show more</button> : null}</section>
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
  return <div className="office-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onCancel(); }}><section ref={sheet} className="office-sheet office-member-sheet" role="dialog" aria-modal="true" aria-labelledby="member-editor-title"><div className="office-sheet__handle" aria-hidden="true" /><header className="office-sheet__header"><div><span>MEMBERSHIP</span><h2 id="member-editor-title" ref={heading} tabIndex={-1}>Manage {personName(member)}</h2><p>{member.role} membership in this institution.</p></div><button type="button" aria-label="Close member editor" onClick={onCancel} disabled={busy}><X size={21} /></button></header><form className="office-form office-catalog-form" onSubmit={(event) => void submit(event)}><section className="office-impact" aria-label="Member access summary"><span><ShieldCheck size={19} /></span><div><strong>{member.is_active ? "Active institution member" : "Inactive institution member"}</strong><p>{member.email}</p></div></section><label className="office-check"><input type="checkbox" name="active" defaultChecked={member.is_active} /> Active institution membership</label>{member.role === "staff" ? <Link className="office-secondary" to="/principal/staff" onClick={onCancel}>Manage staff role</Link> : null}<p className="office-hint">The last active administrator cannot be deactivated. Deactivation ends active temporary exceptions.</p>{error ? <p className="office-alert" role="alert">{error}</p> : null}<div className="office-actions office-sheet__actions"><button type="button" className="office-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="office-primary" disabled={busy}>{busy ? "Saving..." : "Save membership"}</button></div></form></section></div>;
}
