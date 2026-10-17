import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, ChevronRight, Grid2X2, Info, List, LockKeyhole, Search, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { AttentionBadge, attentionCount, attentionDestination, attentionLabel, combineAttentionCounts } from "../attention/AttentionBadge";
import type { AttentionModule } from "../attention/api";
import { useAttention } from "../attention/useAttention";
import { getAccessibleStudents } from "../school/api";
import { useOptionalAuth, type Portal } from "../auth/AuthContext";
import { currentStaffMembership, teacherToolIsVisible } from "../auth/staffAccess";
import { useProFeatures } from "../auth/useProFeatures";
import { toolsFor, type Tool } from "./tools";
import { groupTools, searchTools } from "./navigation";
import { getActivation } from "../activation/api";
import "./more.css";

type MoreLayout = "grid" | "list";
const layoutKey = (userId: string) => `omnischool:more-layout:${userId}`;
function savedLayout(userId: string): MoreLayout {
  try { return window.localStorage.getItem(layoutKey(userId)) === "grid" ? "grid" : "list"; }
  catch { return "list"; }
}

function withStudentScope(path: string | undefined, studentId: string | undefined) {
  if (!path || !studentId || !path.startsWith("/parent/")) return path;
  const destination = new URL(path, window.location.origin);
  if (!destination.searchParams.has("student_id")) destination.searchParams.set("student_id", studentId);
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function ToolTile({ tool, studentId, attention }: { tool: Tool; studentId?: string; attention?: AttentionModule }) {
  const Icon = tool.icon;
  const location = useLocation();
  const cataloguePath = tool.path === "/account/security" ? `/account/security?from=${encodeURIComponent(location.pathname + location.search)}` : tool.path && studentId && tool.path.startsWith("/parent/")
    ? `${tool.path}${tool.path.includes("?") ? "&" : "?"}student_id=${encodeURIComponent(studentId)}` : tool.path;
  const pureNewSequence = Boolean(attention?.new)
    && !attention?.action_required
    && !attention?.exceptions;
  // New-only modules can be reviewed progressively: open the oldest/highest
  // priority exact record, clear it only after that record loads, then let the
  // server expose the next unread record. Multi-action modules still open their
  // queue so people can choose and prioritise rather than getting trapped on
  // one unresolved task.
  const exactAttentionPath = tool.id !== "requests"
    && Boolean(attention?.first_item_href)
    && (attentionCount(attention) === 1 || pureNewSequence);
  const attentionPath = !exactAttentionPath
    ? attention?.href || cataloguePath
    : attention?.first_item_href ?? attentionDestination(attention, cataloguePath ?? "");
  const path = withStudentScope(attentionPath || undefined, studentId);
  const attentionState = attentionLabel(attention, tool.name.toLowerCase());
  const actionLabel = exactAttentionPath
    ? attention?.new && !attention.action_required && !attention.exceptions ? "Read" : "Review"
    : "Open";
  const body = <>
    <span className="more-tile__icon" aria-hidden="true"><Icon size={21} /></span>
    <span className="more-tile__copy"><strong>{tool.name}</strong><small>{tool.description}</small></span>
    <span className="more-tile__end">
      {path ? <AttentionBadge counts={attention} subject={tool.name.toLowerCase()} /> : null}
      {!path ? <span className="more-status"><LockKeyhole size={11} />{tool.planned === "desktop" ? "Desktop" : "Planned"}</span> : null}
      <span className="more-tile__open" aria-hidden="true">{path ? actionLabel : tool.planned === "desktop" ? "Desktop only" : "Coming soon"}<ArrowRight size={14} /></span>
      <ChevronRight className="more-tile__chevron" size={18} aria-hidden="true" />
    </span>
  </>;
  if (path) return <Link className={`more-tile more-tile--${tool.tone}`} to={path}
    aria-label={`${actionLabel} ${tool.name}${attentionState ? `, ${attentionState}` : ""}`}>{body}</Link>;
  return <article className={`more-tile more-tile--${tool.tone} more-tile--planned`}>{body}</article>;
}

/* The catalogue and layout choice are shared by parent, student and staff shells. */
export function MoreContent({ portal }: { portal: Portal }) {
  const auth = useOptionalAuth();
  const userId = auth?.user?.id ?? "anonymous";
  const [preference, setPreference] = useState(() => ({ userId, layout: savedLayout(userId) }));
  const layout = preference.userId === userId ? preference.layout : savedLayout(userId);
  const [params] = useSearchParams();
  const [search, setSearch] = useState("");
  const requestedStudentId = portal === "parent" ? params.get("student_id") ?? undefined : undefined;
  const students = useQuery({
    queryKey: ["school", "accessible-students"],
    queryFn: getAccessibleStudents,
    enabled: auth?.status === "authenticated" && portal === "parent" && !requestedStudentId,
    staleTime: 60_000,
  });
  const studentId = portal === "parent" ? requestedStudentId ?? students.data?.results[0]?.id : undefined;
  const attentionScopeUnavailable = portal === "parent" && !studentId
    && auth?.status === "authenticated"
    && (students.isError || students.isSuccess);
  const member = currentStaffMembership(auth?.memberships ?? []);
  const proFeatures = useProFeatures();
  const adminSchool = auth?.memberships.find(item => item.role === "admin" && item.school_id === auth.user?.active_school_id)
    ?? auth?.memberships.find(item => item.role === "admin");
  const tools = toolsFor(portal).filter((tool) => (portal !== "teacher" || teacherToolIsVisible(member, tool.id))
    && (tool.id !== "campus" || Boolean(adminSchool))
    && (tool.id !== "copilot" || proFeatures.enabled));
  if (portal === "teacher" && member?.permissions?.includes("fees.manage")) tools.push({ id: "delegated-fees", name: "Fees & receipts", description: "Delegated fee and receipt access", icon: LockKeyhole, tone: "amber", path: "/teacher/fees" });
  if (portal === "teacher" && member?.permissions?.includes("sis.manage")) tools.push(
    { id: "delegated-people", name: "Students & guardians", description: "Directory, enrolment and guardian authority", icon: LockKeyhole, tone: "teal", path: "/teacher/students" },
    { id: "delegated-office", name: "Institute settings", description: "Delegated academic setup and history", icon: LockKeyhole, tone: "blue", path: "/teacher/administration" });
  if (portal === "teacher" && member?.permissions?.includes("members.invite")) tools.unshift({ id: "member-invitations", name: "Invite members", description: "Invite staff, students and guardians", icon: LockKeyhole, tone: "blue", path: `/${portal}/invitations` });
  const attention = useAttention(portal, studentId);
  const modules: Record<string, AttentionModule | undefined> = { ...(attention.data?.modules ?? {}) };
  // Delegated teacher tools use catalogue-specific ids, while attention keeps
  // the domain id stable across portals. Bridge those names only after the
  // permission-filtered tool is present so attention never reveals a hidden
  // capability.
  if (portal === "teacher" && tools.some((tool) => tool.id === "delegated-people") && modules.people) {
    modules["delegated-people"] = modules.people;
  }
  if (portal === "teacher" && tools.some((tool) => tool.id === "delegated-fees") && modules.fees) {
    modules["delegated-fees"] = modules.fees;
  }
  // Principal navigation intentionally combines timetable and calendar into one
  // human-facing destination. Preserve that information architecture while
  // allowing a calendar change to light the combined tile and deep-link to the
  // exact changed school day.
  if (portal === "principal" && tools.some((tool) => tool.id === "weekly") && modules.calendar) {
    const combined = combineAttentionCounts(modules.weekly, modules.calendar)!;
    const progressiveInformation = combined.new > 0
      && combined.action_required === 0
      && combined.exceptions === 0;
    modules.weekly = {
      ...combined,
      href: "/principal/timetable",
      first_item_href: combined.total === 1 || progressiveInformation
        ? modules.weekly?.first_item_href ?? modules.calendar.first_item_href
        : null,
    };
  }
  if(portal==="teacher"&&modules.transport&&!tools.some(tool=>tool.id==="transport")) {
    const invitationTool=toolsFor("teacher").find(tool=>tool.id==="transport");
    if(invitationTool)tools.push(invitationTool);
  }
  const activation = useQuery({ queryKey: ["institution-activation", adminSchool?.school_id],
    queryFn: () => getActivation(adminSchool!.school_id), enabled: portal === "principal" && Boolean(adminSchool), staleTime: 60_000, retry: false });
  const chooseLayout = (next: MoreLayout) => {
    setPreference({ userId, layout: next });
    try { window.localStorage.setItem(layoutKey(userId), next); } catch { /* private browsing */ }
  };
  const live = tools.filter((tool) => tool.path);
  const planned = tools.filter((tool) => !tool.path);
  const searching = Boolean(search.trim());
  const results = searching ? searchTools(portal, live, search) : [];
  const groups = searching ? [{ name: "Search results", tools: results }] : groupTools(portal, live);
  return <div className="more-page">
    <div className="more-toolbar">
      <div className="more-search"><Search size={18} aria-hidden="true"/><input type="search" aria-label="Search tools and tasks" placeholder="Search tools and tasks" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={17}/></button> : null}</div>
      <div className="more-layout-switch" role="group" aria-label="Tool layout">
        <button type="button" aria-label="Grid view" aria-pressed={layout === "grid"} onClick={() => chooseLayout("grid")}><Grid2X2 size={18} aria-hidden="true"/></button>
        <button type="button" aria-label="List view" aria-pressed={layout === "list"} onClick={() => chooseLayout("list")}><List size={19} aria-hidden="true"/></button>
      </div>
    </div>
    {attention.isError || attentionScopeUnavailable ? <div className="more-attention-error" role="alert">
      <AlertCircle size={17} aria-hidden="true" /><span>{attentionScopeUnavailable && students.isSuccess
        ? "No linked learner is available, so attention status cannot be shown."
        : "Attention status is unavailable."}</span>
      {students.isError || attention.isError ? <button type="button" onClick={() => {
        if (attentionScopeUnavailable) void students.refetch();
        else void attention.refetch();
      }}>Retry</button> : null}
    </div> : null}
    {!searching && portal === "principal" && activation.data && activation.data.institution.status !== "active" ? <Link className="more-setup-link" to="/principal/activation"><span><strong>Finish setup</strong><small>{activation.data.summary.completed} of {activation.data.summary.required} checks complete</small></span><ChevronRight size={18}/></Link> : null}
    {searching ? <p className="more-result-count" role="status">{results.length ? `${results.length} result${results.length === 1 ? "" : "s"}` : "No matching tools. Try a task such as leave, marks or messages."}</p> : null}
    {groups.filter(group => group.tools.length).map((group, index) => <section key={group.name} className="more-section" aria-labelledby={`more-group-${index}`}>
      <header><h2 id={`more-group-${index}`}>{group.name}</h2></header>
      <div className={`more-grid more-grid--${searching ? "list more-search-results" : layout}`}>{group.tools.map((tool) => <ToolTile key={tool.id} tool={tool} studentId={studentId} attention={modules[tool.id]} />)}</div>
    </section>)}
    {!searching && planned.length ? <section className="more-section" aria-labelledby="more-planned-title">
      <header><h2 id="more-planned-title">Coming to mobile</h2></header>
      <div className={`more-grid more-grid--${layout}`}>{planned.map((tool) => <ToolTile key={tool.id} tool={tool} studentId={studentId} />)}</div>
      <div className="more-note"><Info size={16} /><span>These tools need a wider screen today. Mobile versions will appear here when they are ready.</span></div>
    </section> : null}
  </div>;
}

function Shell({ portal, children }: { portal: Portal; children: ReactNode }) {
  if (portal === "parent") return <ParentShell active="more" pageLabel="More">{children}</ParentShell>;
  return <OperationsShell portal={portal === "teacher" ? "teacher" : "principal"} active="more" title="More">{children}</OperationsShell>;
}

export function ParentMoreRoute() { return <Shell portal="parent"><MoreContent portal="parent" /></Shell>; }
export function TeacherMoreRoute() { return <Shell portal="teacher"><MoreContent portal="teacher" /></Shell>; }
export function PrincipalMoreRoute() { return <Shell portal="principal"><MoreContent portal="principal" /></Shell>; }
