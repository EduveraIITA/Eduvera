import { useEffect, useState } from "react";
import { ProductIcon } from "../../components/ProductIcon";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, Clock3, Languages, LogIn, LogOut, QrCode, Search, Settings2, UserRoundPlus } from "lucide-react";
import { authDestination, useAuth } from "../auth/AuthContext";
import { createGateVisitor, gateApprovalsQueryKey, gateCommand, getGateStaff, getGateStudent, getGateWorkspace, getVisitorApprovals, type GateStaff, type GateStudent, type Visitor, type VisitorFilter, type Workspace } from "./api";
import { GateActivityList } from "./GateActivityList";
import { GateApprovalInbox } from "./GateApprovalInbox";
import { GateFrame } from "./GateFrame";
import { GateStudentSearch } from "./GateStudentSearch";
import { GateVisitorForm } from "./GateVisitorForm";
import { GateVisitors } from "./GateVisitors";
import { GateVisitorQueueShortcut } from "./GateVisitorQueueShortcut";
import { visitorFilterFromUrl, visitorPageFromUrl } from "./GateVisitorNavigation";
import { gateError } from "./gateError";
import QRScanner from "./QRScanner";
import "./gate.css";
import { IN_OUT_MANAGE_PATH } from "./gateRoutes";

type Mode = "home" | "scan" | "choose" | "search" | "visitor" | "visitors" | "approvals" | "records" | "sent" | "recorded";
type GateSection = "operate" | "approvals" | "records";
const copy = {
  en: { title: "In & Out", scan: "Scan QR", manual: "Record manually", search: "Find student or staff", visitor: "Record a visitor", back: "Back", entry: "Record entry", exit: "Record exit", saved: "Movement recorded", retry: "Please try again", expired: "This pass is invalid, expired, or the approved pickup arrangement changed.", office: "Contact campus office", statusIn: "Inside", statusOut: "Outside", noMovement: "No movement recorded", operate: "Operate", approvals: "Approvals", records: "Records", done: "Done" },
  hi: { title: "प्रवेश और निकास", scan: "QR स्कैन करें", manual: "मैन्युअल दर्ज करें", search: "छात्र या स्टाफ खोजें", visitor: "आगंतुक दर्ज करें", back: "वापस", entry: "प्रवेश दर्ज करें", exit: "निकास दर्ज करें", saved: "आवागमन दर्ज हुआ", retry: "फिर कोशिश करें", expired: "यह पास अमान्य या समाप्त है, अथवा पिकअप व्यवस्था बदल गई है।", office: "कैंपस कार्यालय से संपर्क करें", statusIn: "अंदर", statusOut: "बाहर", noMovement: "कोई आवागमन दर्ज नहीं", operate: "संचालन", approvals: "अनुमतियाँ", records: "रिकॉर्ड", done: "पूर्ण" },
} as const;

export function WorkspaceInOutOperateRoute() {
  const auth = useAuth();
  const activeMembership = auth.memberships.find((item) => item.school_id === auth.user?.active_school_id);
  const member = activeMembership
    ? activeMembership.permissions?.includes("gate.manage") || activeMembership.role === "admin" ? activeMembership : undefined
    : auth.user?.active_school_id ? undefined : auth.memberships.find((item) => item.permissions?.includes("gate.manage") || item.role === "admin");
  const school = member?.school_id ?? "";
  const languageKey = `thatcampus:in-out-language:${auth.user?.id ?? "account"}:${school}`;
  const [language, setLanguage] = useState<"en" | "hi">(() => localStorage.getItem(languageKey) === "hi" ? "hi" : "en");
  const hindi = language === "hi";
  const t = copy[language];
  const [localMode, setMode] = useState<Mode>("home");
  const [routeParams, setRouteParams] = useSearchParams();
  const requestedSection = routeParams.get("section");
  const mode = requestedSection === "approvals" || requestedSection === "records" || requestedSection === "visitors" ? requestedSection : localMode;
  const visitorFilter = visitorFilterFromUrl(routeParams.get("visitor_filter"));
  const visitorPage = visitorPageFromUrl(routeParams.get("visitor_page"));
  const requestedVisitorId = routeParams.get("visitor") ?? "";
  const [student, setStudent] = useState<GateStudent | null>(null);
  const [staff, setStaff] = useState<GateStaff | null>(null);
  const [qr, setQr] = useState<string>();
  const [passKind, setPassKind] = useState<"student" | "pickup">("student");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [visitorRequestId, setVisitorRequestId] = useState(() => crypto.randomUUID());
  const [visitorResult, setVisitorResult] = useState<Visitor | null>(null);
  const client = useQueryClient();
  const workspace = useQuery({ queryKey: ["gate", auth.user?.id, school, visitorFilter, visitorPage, requestedVisitorId], queryFn: ({ signal }) => getGateWorkspace(school, { visitorFilter, visitorPage, visitorId: requestedVisitorId || undefined, signal }), enabled: Boolean(school), refetchInterval: 30_000, retry: false });
  const approvals = useQuery({ queryKey: gateApprovalsQueryKey(auth.user?.id, auth.user?.active_school_id), queryFn: ({ signal }) => getVisitorApprovals(signal), enabled: Boolean(school), refetchInterval: 30_000, retry: false });
  useEffect(() => { if (!success) return; const timer = window.setTimeout(() => setSuccess(""), 4_000); return () => window.clearTimeout(timer); }, [success]);
  const focusedVisitor = requestedVisitorId
    ? workspace.data?.focused_visitor === undefined ? workspace.data?.visitors.find((visitor) => visitor.id === requestedVisitorId) ?? null : workspace.data.focused_visitor
    : visitorResult;
  if (!member) return <Navigate to={authDestination(auth)} replace />;

  function clearSelection() { setStudent(null); setStaff(null); setQr(undefined); setPassKind("student"); }
  function reset() { setMode("home"); clearSelection(); setError(""); setVisitorResult(null); setRouteParams({}, { replace: true }); setCommandId(crypto.randomUUID()); setVisitorRequestId(crypto.randomUUID()); }
  function openSection(next: GateSection) { const mode = next === "operate" ? "home" : next; setMode(mode); clearSelection(); setError(""); setSuccess(""); setVisitorResult(null); setRouteParams(mode === "home" ? {} : { section: mode }, { replace: true }); }
  function openVisitorQueue() { clearSelection(); setError(""); setVisitorResult(null); setMode("visitors"); setRouteParams({ section: "visitors", visitor_filter: "active" }); }
  function changeVisitorFilter(filter: VisitorFilter) { setVisitorResult(null); setRouteParams(current => { const next = new URLSearchParams(current); next.set("visitor_filter", filter); next.delete("visitor_page"); next.delete("visitor"); return next; }); }
  function changeVisitorPage(page: number) { setVisitorResult(null); setRouteParams(current => { const next = new URLSearchParams(current); next.set("visitor_page", String(page)); next.delete("visitor"); return next; }); }
  function updateVisitor(visitor: Visitor) {
    client.setQueriesData<Workspace>({ queryKey: ["gate", auth.user?.id, school] }, (current) => {
      if (!current) return current;
      const visitors = current.visitors.some((item) => item.id === visitor.id) ? current.visitors.map((item) => item.id === visitor.id ? visitor : item) : current.visitor_pagination ? current.visitors : [visitor, ...current.visitors];
      return { ...current, visitors, focused_visitor: current.focused_visitor?.id === visitor.id ? visitor : current.focused_visitor, pending: current.visitor_counts ? current.pending : visitors.filter((item) => item.state === "pending").length };
    });
    void client.invalidateQueries({ queryKey: ["gate", auth.user?.id, school] });
    void client.invalidateQueries({ queryKey: ["gate-admin", school] });
  }
  async function scan(value: string) {
    setBusy(true); setError("");
    try {
      const result = await gateCommand<{ student: GateStudent; kind: "student" | "pickup" } | { visitor: Visitor; kind: "visitor" }>(school, "scan", { qr: value });
      if (result.kind === "visitor") { setVisitorResult(result.visitor); setMode("visitors"); return; }
      setStudent(result.student); setStaff(null); setPassKind(result.kind); setQr(value); setCommandId(crypto.randomUUID());
    } catch (failure) { setError(gateError(failure, hindi, t.expired)); setMode("home"); }
    finally { setBusy(false); }
  }
  async function selectStudent(id: string) {
    setBusy(true); setError("");
    try { setStudent(await getGateStudent(school, id)); setStaff(null); setPassKind("student"); setCommandId(crypto.randomUUID()); }
    catch (failure) { setError(gateError(failure, hindi, t.retry)); }
    finally { setBusy(false); }
  }
  async function selectStaff(match: GateStaff) {
    setBusy(true); setError("");
    try { setStaff(await getGateStaff(school, match.id)); setStudent(null); setCommandId(crypto.randomUUID()); }
    catch (failure) { setError(gateError(failure, hindi, t.retry)); }
    finally { setBusy(false); }
  }
  async function recordStudent(direction: "in" | "out") {
    if (!student || busy) return;
    setBusy(true); setError("");
    try { await gateCommand(school, "movements", { student_id: student.id, direction, qr: direction === "out" ? qr : undefined, identity_verified: true, command_id: commandId }); reset(); setSuccess(t.saved); await workspace.refetch(); }
    catch (failure) { setError(gateError(failure, hindi, direction === "out" ? t.expired : t.retry)); }
    finally { setBusy(false); }
  }
  async function recordStaff(direction: "in" | "out") {
    if (!staff || busy) return;
    setBusy(true); setError("");
    try { await gateCommand(school, "staff-movements", { staff_profile_id: staff.id, direction, identity_verified: true, command_id: commandId }); reset(); setSuccess(t.saved); await workspace.refetch(); }
    catch (failure) { setError(gateError(failure, hindi, t.retry)); }
    finally { setBusy(false); }
  }
  async function createVisitor(form: FormData) {
    form.set("request_id", visitorRequestId); setBusy(true); setError("");
    try { const result = await createGateVisitor(school, form); updateVisitor(result); setVisitorResult(result); setMode(result.state === "inside" ? "recorded" : "sent"); setVisitorRequestId(crypto.randomUUID()); }
    catch (failure) { setError(gateError(failure, hindi, t.retry)); }
    finally { setBusy(false); }
  }
  async function moveVisitor(visitor: Visitor, action: "in" | "out") {
    setBusy(true); setError("");
    try { const result = await gateCommand<{ saved: boolean; visitor: Visitor }>(school, `visitors/${visitor.id}/${action}`, { expected_revision: visitor.revision }); updateVisitor(result.visitor); reset(); setSuccess(t.saved); }
    catch (failure) { setError(gateError(failure, hindi, t.retry)); await workspace.refetch(); }
    finally { setBusy(false); }
  }

  const studentCanEnter = Boolean(student && student.direction !== "in");
  const studentCanExit = Boolean(student && passKind === "pickup" && student.direction === "in" && student.plan_state === "ready");
  const languageControl = <button className="gate-language" onClick={() => { const next = hindi ? "en" : "hi"; setLanguage(next); localStorage.setItem(languageKey, next); }} aria-label="Switch Hindi / English"><Languages size={17} />{hindi ? "English" : "हिन्दी"}</button>;
  const activeMode = mode === "approvals" ? "approvals" : mode === "records" ? "records" : "operate";
  const visitorList = requestedVisitorId && !workspace.isPending && !workspace.isError && !focusedVisitor
    ? <section role="status" className="gate-visitor-empty"><h2>{hindi ? "आगंतुक उपलब्ध नहीं" : "Visitor unavailable"}</h2><p>{hindi ? "यह रिकॉर्ड इस परिसर में उपलब्ध नहीं है।" : "This visitor record is not available in this campus."}</p><button type="button" onClick={openVisitorQueue}>{hindi ? "आगंतुक सूची खोलें" : "Open visitor queue"}</button></section>
    : <GateVisitors visitors={focusedVisitor ? [focusedVisitor] : workspace.data?.visitors ?? []} hindi={hindi} busy={busy} onMove={(visitor, action) => void moveVisitor(visitor, action)} loading={workspace.isPending} counts={focusedVisitor ? undefined : workspace.data?.visitor_counts} pagination={focusedVisitor ? undefined : workspace.data?.visitor_pagination} onFilterChange={changeVisitorFilter} onPageChange={changeVisitorPage} />;

  return <GateFrame member={member} hindi={hindi} languageControl={languageControl}>
    <section className="gate-shell gate-workspace" aria-label={t.title} lang={hindi ? "hi" : "en"}>
      <nav className="gate-workspace-tabs" aria-label={hindi ? "प्रवेश और निकास" : "In & Out workspaces"}>
        <button type="button" aria-current={activeMode === "operate" ? "page" : undefined} onClick={() => openSection("operate")}><QrCode size={18} />{t.operate}</button>
        <button type="button" aria-current={activeMode === "approvals" ? "page" : undefined} onClick={() => openSection("approvals")}><ClipboardCheck size={18} />{t.approvals}{approvals.data?.length ? <span>{approvals.data.length}</span> : null}</button>
        <button type="button" aria-current={activeMode === "records" ? "page" : undefined} onClick={() => openSection("records")}><Clock3 size={18} />{t.records}</button>
      </nav>
      {mode !== "home" && mode !== "approvals" && mode !== "records" ? <button type="button" className="gate-back" disabled={busy} onClick={reset}><ArrowLeft size={20} />{t.back}</button> : null}
      {success ? <p className="gate-success" role="status"><CheckCircle2 size={19} />{success}</p> : null}
      {error ? <p className="gate-error" role="alert">{error}</p> : null}
      {workspace.isError ? <p className="gate-error" role="alert">{hindi ? "रिकॉर्ड लोड नहीं हुए।" : "In & Out records could not load."} <button type="button" onClick={() => void workspace.refetch()}>{t.retry}</button></p> : null}
      {busy ? <p className="gate-search-status" role="status">{hindi ? "कृपया रुकें…" : "Please wait…"}</p> : null}

      {student ? <section className="gate-person-detail" aria-labelledby="gate-person-name"><div className="gate-detail-identity">{student.avatar_url ? <img src={student.avatar_url} alt="" /> : <span className="gate-detail-avatar">{student.name.slice(0, 1)}</span>}<span className="gate-type-pill is-student">{hindi ? "छात्र" : "Student"}</span><h2 id="gate-person-name">{student.name}</h2><p>{student.class_label} · {student.admission_number}</p></div><div className="gate-detail-facts"><div><span>{hindi ? "कक्षा" : "Class"}</span><strong>{student.class_label || "—"}</strong></div><div><span>{hindi ? "प्रवेश संख्या" : "Admission no."}</span><strong>{student.admission_number}</strong></div><div><span>{hindi ? "स्थिति" : "Latest boundary record"}</span><strong>{student.direction === "in" ? t.statusIn : student.direction === "out" ? t.statusOut : t.noMovement}</strong></div></div>{passKind === "pickup" && student.collector_name ? <div className="gate-collector">{student.collector_photo ? <img src={student.collector_photo} alt="" /> : null}<strong>{student.collector_name}</strong><p>{hindi ? "स्वीकृत रिकॉर्ड से पहचान मिलाएँ।" : "Match the collecting person with the approved record before exit."}</p></div> : null}<div className="gate-detail-actions"><button className="gate-primary" disabled={!studentCanEnter || busy} onClick={() => void recordStudent("in")}><LogIn size={17} />{t.entry}</button><button className="gate-danger" disabled={!studentCanExit || busy} onClick={() => void recordStudent("out")}><LogOut size={17} />{t.exit}</button></div></section>
      : staff ? <section className="gate-person-detail" aria-labelledby="gate-staff-name"><div className="gate-detail-identity">{staff.avatar_url ? <img src={staff.avatar_url} alt="" /> : <span className="gate-detail-avatar">{staff.name.slice(0, 1)}</span>}<span className="gate-type-pill is-staff">{hindi ? "स्टाफ" : "Staff"}</span><h2 id="gate-staff-name">{staff.name}</h2><p>{staff.designation}</p></div><div className="gate-detail-facts"><div><span>{hindi ? "कर्मचारी आईडी" : "Employee ID"}</span><strong>{staff.staff_code}</strong></div><div><span>{hindi ? "विभाग" : "Department"}</span><strong>{staff.department || "—"}</strong></div><div><span>{hindi ? "स्थिति" : "Latest boundary record"}</span><strong>{staff.direction === "in" ? t.statusIn : staff.direction === "out" ? t.statusOut : t.noMovement}</strong></div></div><div className="gate-detail-actions"><button className="gate-primary" disabled={staff.direction === "in" || busy} onClick={() => void recordStaff("in")}><LogIn size={17} />{t.entry}</button><button className="gate-danger" disabled={staff.direction !== "in" || busy} onClick={() => void recordStaff("out")}><LogOut size={17} />{t.exit}</button></div></section>
      : mode === "home" ? <div className="gate-home-content"><div className="gate-actions"><button className="gate-action gate-action--scan" disabled={busy} onClick={() => setMode("scan")}><span className="gate-action-icon"><QrCode /></span><span className="gate-action-copy"><strong>{t.scan}</strong><small>{hindi ? "छात्र, पिकअप या आगंतुक पास" : "Student, pickup or visitor pass"}</small></span><ArrowRight className="gate-action-arrow" size={20} /></button><button className="gate-action" disabled={busy} onClick={() => setMode("choose")}><span className="gate-action-icon"><UserRoundPlus /></span><span className="gate-action-copy"><strong>{t.manual}</strong><small>{hindi ? "किसी व्यक्ति को खोजें या आगंतुक जोड़ें" : "Find a person or add a visitor"}</small></span><ArrowRight className="gate-action-arrow" size={18} /></button></div><GateVisitorQueueShortcut visitors={workspace.data?.visitors ?? []} counts={workspace.data?.visitor_counts} hindi={hindi} busy={busy} onOpen={openVisitorQueue} /><section className="gate-recent" aria-labelledby="gate-recent-title"><header><h2 id="gate-recent-title">{hindi ? "हाल की गतिविधि" : "Recent activity"}</h2><button type="button" onClick={() => openSection("records")}>{hindi ? "सभी देखें" : "View all"}<ArrowRight size={16} /></button></header><GateActivityList items={workspace.data?.activity ?? []} hindi={hindi} limit={5} /></section>{member.role === "admin" ? <Link className="gate-admin-link" to={IN_OUT_MANAGE_PATH}><Settings2 size={16} />{hindi ? "सेटअप और पास प्रबंधित करें" : "Manage passes and access"}<ArrowRight size={16} /></Link> : null}</div>
      : mode === "scan" ? <section className="gate-scan-panel"><header className="gate-section-heading"><span className="gate-section-icon"><ProductIcon name="gate" size={28} /></span><div><h2>{t.scan}</h2><p>{hindi ? "QR को फ्रेम में रखें।" : "Align the pass inside the frame."}</p></div></header><QRScanner hindi={hindi} onScan={(value) => void scan(value)} /><button type="button" className="gate-manual-search" onClick={() => setMode("choose")}><Search size={18} />{t.manual}<ArrowRight size={18} /></button></section>
      : mode === "choose" ? <section className="gate-manual-panel"><button type="button" className="gate-manual-option" onClick={() => setMode("search")}><span className="gate-action-icon"><Search /></span><span><strong>{t.search}</strong><small>{hindi ? "पहचान जाँचकर आवागमन दर्ज करें" : "Verify identity, then record entry or exit"}</small></span><ArrowRight size={18} /></button><button type="button" className="gate-manual-option is-visitor" onClick={() => setMode("visitor")}><span className="gate-action-icon gate-action-icon--visitor"><UserRoundPlus /></span><span><strong>{t.visitor}</strong><small>{hindi ? "विवरण दर्ज करें और जरूरत पर अनुमति माँगें" : "Capture details and request approval when required"}</small></span><ArrowRight size={18} /></button><button type="button" className="gate-manual-option" onClick={openVisitorQueue}><span className="gate-action-icon"><Clock3 /></span><span><strong>{hindi ? "गेट पर आगंतुक" : "Visitors at the gate"}</strong><small>{hindi ? "स्वीकृत या अंदर मौजूद आगंतुक" : "Approved and currently inside visitors"}</small></span><ArrowRight size={18} /></button></section>
      : mode === "search" ? <GateStudentSearch school={school} hindi={hindi} busy={busy} onSelect={(match) => void selectStudent(match.id)} onSelectStaff={(match) => void selectStaff(match)} />
      : mode === "visitor" ? <GateVisitorForm hosts={workspace.data?.hosts ?? []} hindi={hindi} busy={busy} onSubmit={(form) => void createVisitor(form)} />
      : mode === "visitors" ? visitorList
      : mode === "approvals" ? <GateApprovalInbox hindi={hindi} />
      : mode === "records" ? <section className="gate-records"><header className="gate-section-heading"><span className="gate-section-icon"><ProductIcon name="records" size={28} /></span><div><h2>{hindi ? "हाल के रिकॉर्ड" : "Recent records"}</h2><p>{hindi ? "ये सीमा पर दर्ज वास्तविक आवागमन हैं।" : "Accepted boundary movements, with their recorded time."}</p></div></header><GateActivityList items={workspace.data?.activity ?? []} hindi={hindi} /><div className="gate-visitor-log"><h3>{hindi ? "आगंतुक" : "Visitors"}</h3>{visitorList}</div></section>
      : <section className="gate-visitor-result" role="status"><CheckCircle2 size={32} /><h2>{mode === "recorded" ? (hindi ? "आगंतुक प्रवेश दर्ज हुआ" : "Visitor entry recorded") : (hindi ? "अनुमति अनुरोध भेजा गया" : "Approval request sent")}</h2>{visitorResult ? <p><strong>{visitorResult.name}</strong>{visitorResult.host_name ? ` · ${visitorResult.host_name}` : ""}</p> : null}<button type="button" className="gate-primary" onClick={reset}>{t.done}</button></section>}
      {(error || student || staff) && workspace.data?.office?.phone ? <a className="gate-office" href={`tel:${workspace.data.office.phone}`}>{t.office}</a> : null}
    </section>
  </GateFrame>;
}

/** Temporary source alias while bookmark routes converge. */
export default function GatePage() { return <WorkspaceInOutOperateRoute />; }
