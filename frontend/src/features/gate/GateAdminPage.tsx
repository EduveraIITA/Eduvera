import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, Clock3, QrCode, ShieldCheck, UsersRound } from "lucide-react";
import QRCode from "qrcode";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { authDestination, useAuth } from "../auth/AuthContext";
import { GateActivityList } from "./GateActivityList";
import { GateVisitorFilters, GateVisitorPagination, visitorFilterFromUrl, visitorPageFromUrl } from "./GateVisitorNavigation";
import { findGateStudents, gateCommand, getGateWorkspace, type GateStudentMatch, type QRPass, type VisitorFilter } from "./api";
import "./gate.css";
import { IN_OUT_OPERATE_PATH, IN_OUT_WORKSPACE_PATH } from "./gateRoutes";

export function WorkspaceInOutManageRoute() {
  const auth = useAuth();
  const activeMembership = auth.memberships.find((item) => item.school_id === auth.user?.active_school_id);
  const member = activeMembership
    ? activeMembership.role === "admin" ? activeMembership : undefined
    : auth.user?.active_school_id ? undefined : auth.memberships.find((item) => item.role === "admin");
  const school = member?.school_id ?? "";
  const [params, setParams] = useSearchParams();
  const visitorFilter = visitorFilterFromUrl(params.get("visitor_filter"));
  const visitorPage = visitorPageFromUrl(params.get("visitor_page"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<GateStudentMatch[]>([]);
  const [pass, setPass] = useState<{ image: string; data: QRPass }>();
  const workspace = useQuery({ queryKey: ["gate-admin", school, visitorFilter, visitorPage], queryFn: ({ signal }) => getGateWorkspace(school, { visitorFilter, visitorPage, signal }), enabled: Boolean(school), refetchInterval: 10_000, retry: false });
  if (!member) return <Navigate to={authDestination(auth)} replace />;

  function changeVisitorFilter(filter: VisitorFilter) { setParams(current => { const next = new URLSearchParams(current); next.set("visitor_filter", filter); next.delete("visitor_page"); return next; }); }
  function changeVisitorPage(page: number) { setParams(current => { const next = new URLSearchParams(current); next.set("visitor_page", String(page)); return next; }); }

  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { setStudents(await findGateStudents(school, query)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Student search could not be completed."); }
    finally { setBusy(false); }
  }
  async function issue(studentId: string, kind: "student" | "pickup") {
    setBusy(true); setError("");
    try { const data = await gateCommand<QRPass>(school, "passes", { student_id: studentId, kind }); setPass({ data, image: await QRCode.toDataURL(data.qr, { width: 320, margin: 2 }) }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The pass could not be issued."); }
    finally { setBusy(false); }
  }
  async function visitorPass(id: string) {
    setBusy(true); setError("");
    try { const data = await gateCommand<QRPass>(school, `visitors/${id}/pass`); setPass({ data, image: await QRCode.toDataURL(data.qr, { width: 320, margin: 2 }) }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The visitor pass could not be issued."); }
    finally { setBusy(false); }
  }
  async function decide(id: string, action: "approve" | "deny", revision: number) {
    setBusy(true); setError("");
    try { await gateCommand(school, `visitors/${id}/${action}`, { expected_revision: revision }); await workspace.refetch(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The visitor decision could not be saved."); await workspace.refetch(); }
    finally { setBusy(false); }
  }

  return <OperationsShell active="areas" title="In & Out management" subtitle="Passes, visitor decisions and operating records" schoolName={member.school_name} backTo={IN_OUT_WORKSPACE_PATH}>
    <div className="operations-stack gate-management">
      <nav className="gate-management-links" aria-label="In & Out management links">
        <Link to={IN_OUT_OPERATE_PATH}><QrCode size={18} /><span><strong>Open checkpoint</strong><small>Scan passes and record movements</small></span><ArrowRight size={17} /></Link>
        <Link to="/more/setup/responsibilities"><UsersRound size={18} /><span><strong>Assign In & Out responsibility</strong><small>Scope who may operate a checkpoint</small></span><ArrowRight size={17} /></Link>
      </nav>
      {error ? <p className="gate-error" role="alert">{error}</p> : null}
      <section className="gate-admin-section" aria-labelledby="gate-passes-title"><header className="gate-section-heading"><span className="gate-section-icon"><QrCode size={22} /></span><div><h2 id="gate-passes-title">Student and pickup passes</h2><p>Pickup passes require an approved current departure plan, expire after 15 minutes and can be used once.</p></div></header><form className="gate-form gate-admin-search" onSubmit={(event) => void search(event)}><label>Find student<input value={query} minLength={2} maxLength={100} required onChange={(event) => setQuery(event.target.value)} /></label><button className="gate-primary" disabled={busy}>Search</button></form><div className="gate-list">{students.map((student) => <article key={student.id} className="gate-management-person"><span><strong>{student.name}</strong><small>{student.class_label} · {student.admission_number}</small></span><div><button disabled={busy} onClick={() => void issue(student.id, "student")}>Student QR</button><button disabled={busy || student.plan_state !== "ready"} onClick={() => void issue(student.id, "pickup")}>Pickup QR</button></div></article>)}</div>{pass ? <section className="gate-qr" aria-labelledby="gate-pass-title"><h3 id="gate-pass-title">{pass.data.name}</h3><img src={pass.image} alt={`${pass.data.kind} QR pass`} /><p>Expires {new Date(pass.data.expires_at).toLocaleString()}</p><a href={pass.image} download={`thatcampus-${pass.data.kind}-qr.png`}>Download QR</a><button onClick={() => setPass(undefined)}>Close</button></section> : null}</section>
      <section className="gate-admin-section" aria-labelledby="gate-visitors-title"><header className="gate-section-heading"><span className="gate-section-icon"><BadgeCheck size={22} /></span><div><h2 id="gate-visitors-title">Visitor decisions and passes</h2><p>Approval records remain separate from physical entry and exit evidence.</p></div></header>{workspace.isError ? <p role="alert" className="gate-error">Visitors could not load. <button onClick={() => void workspace.refetch()}>Try again</button></p> : null}{workspace.isPending ? <p role="status">Loading visitors…</p> : null}{workspace.data?.visitor_counts ? <GateVisitorFilters filter={visitorFilter} counts={workspace.data.visitor_counts} hindi={false} busy={busy || workspace.isFetching} onChange={changeVisitorFilter} /> : null}<div className="gate-list">{workspace.data?.visitors.map((visitor) => <article key={visitor.id} className="gate-management-person"><span><strong>{visitor.name}</strong><small>{visitor.purpose} · {visitor.state}</small></span><div>{["approved", "inside"].includes(visitor.state) ? <button disabled={busy} onClick={() => void visitorPass(visitor.id)}>Visitor QR</button> : null}{visitor.state === "pending" ? <><button disabled={busy} onClick={() => void decide(visitor.id, "approve", visitor.revision)}>Approve</button><button disabled={busy} onClick={() => void decide(visitor.id, "deny", visitor.revision)}>Decline</button></> : null}</div></article>)}</div><GateVisitorPagination pagination={workspace.data?.visitor_pagination} hindi={false} busy={busy || workspace.isFetching} onChange={changeVisitorPage} /></section>
      <section className="gate-admin-section" aria-labelledby="gate-records-title"><header className="gate-section-heading"><span className="gate-section-icon"><Clock3 size={22} /></span><div><h2 id="gate-records-title">Recent operating records</h2><p>Accepted boundary events are evidence of entry or exit; they are not classroom attendance.</p></div></header><GateActivityList items={workspace.data?.activity ?? []} /></section>
      <p className="gate-safety-note"><ShieldCheck size={17} />Accepted records remain in the audit trail. A dedicated correction action is not yet available in this workspace.</p>
    </div>
  </OperationsShell>;
}

/** Temporary source alias while bookmark routes converge. */
export default function GateAdminPage() { return <WorkspaceInOutManageRoute />; }
