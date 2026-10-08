import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Grid2X2, Info, List, LockKeyhole, Search, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { schoolDateToday } from "../../lib/schoolTime";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { getCollectorDeparture } from "../departure/api";
import { getPrincipalHome, getTeacherHome } from "../operations/api";
import { getParentHome, getStudentHome } from "../school/api";
import { useOptionalAuth, type Portal } from "../auth/AuthContext";
import { currentStaffMembership, teacherToolIsVisible } from "../auth/staffAccess";
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

function ToolTile({ tool, studentId, attention = 0 }: { tool: Tool; studentId?: string; attention?: number }) {
  const Icon = tool.icon;
  const location = useLocation();
  const path = tool.path === "/account/security" ? `/account/security?from=${encodeURIComponent(location.pathname + location.search)}` : tool.path && studentId && tool.path.startsWith("/parent/")
    ? `${tool.path}${tool.path.includes("?") ? "&" : "?"}student_id=${encodeURIComponent(studentId)}` : tool.path;
  const body = <>
    <span className="more-tile__icon" aria-hidden="true"><Icon size={21} /></span>
    <span className="more-tile__copy"><strong>{tool.name}</strong><small>{tool.description}</small></span>
    <span className="more-tile__end">
      {attention > 0 && path ? <span className="more-attention" aria-hidden="true" /> : null}
      {!path ? <span className="more-status"><LockKeyhole size={11} />{tool.planned === "desktop" ? "Desktop" : "Planned"}</span> : null}
      <span className="more-tile__open" aria-hidden="true">{path ? "Open" : tool.planned === "desktop" ? "Desktop only" : "Coming soon"}<ArrowRight size={14} /></span>
      <ChevronRight className="more-tile__chevron" size={18} aria-hidden="true" />
    </span>
  </>;
  if (path) return <Link className={`more-tile more-tile--${tool.tone}`} to={path}
    aria-label={`Open ${tool.name}${attention > 0 ? ", action needed" : ""}`}>{body}</Link>;
  return <article className={`more-tile more-tile--${tool.tone} more-tile--planned`}>{body}</article>;
}

function useMoreAttention(portal: Portal, studentId: string | undefined, toolIds: string[]) {
  const auth = useOptionalAuth();
  const member = currentStaffMembership(auth?.memberships ?? []);
  const userId = auth?.user?.id ?? "anonymous";
  const canReadTeacherHome = portal !== "teacher" || Boolean(member?.permissions?.includes("timetable.view"));
  const home = useQuery<{ more_attention?: Record<string, number> }>({
    queryKey: portal === "parent" ? ["school", "parent", "home", studentId ?? "default"]
      : portal === "student" ? ["school", "student", "home"]
      : [portal === "teacher" ? "teacher-home" : "principal-home", schoolDateToday()],
    queryFn: async (): Promise<{ more_attention?: Record<string, number> }> => {
      if (portal === "parent") return getParentHome(studentId);
      if (portal === "student") return getStudentHome();
      if (portal === "teacher") return getTeacherHome();
      return getPrincipalHome();
    },
    enabled: auth?.status === "authenticated" && canReadTeacherHome,
    staleTime: 20_000,
    refetchOnMount: "always",
    retry: false,
  });
  const collector = useQuery({
    queryKey: ["departure", "collector"], queryFn: getCollectorDeparture,
    enabled: auth?.status === "authenticated" && portal === "teacher" && toolIds.includes("transport"),
    staleTime: 15_000, refetchOnMount: "always", retry: false,
  });
  const counts = { ...(home.data?.more_attention ?? {}) };
  if (portal === "teacher" && collector.data) {
    const today = schoolDateToday();
    const trips = collector.data.trips.filter((trip) => trip.assigned_collector_user_id === userId
      && trip.service_date >= today && trip.state === "planned" && trip.collector_assignment_status === "pending");
    const swaps = collector.data.swaps.filter((swap) => swap.target_user_id === userId && swap.status === "submitted");
    if (trips.length + swaps.length) counts.transport = trips.length + swaps.length;
  }
  return counts;
}

/* The catalogue and layout choice are shared by parent, student and staff shells. */
export function MoreContent({ portal }: { portal: Portal }) {
  const auth = useOptionalAuth();
  const userId = auth?.user?.id ?? "anonymous";
  const [preference, setPreference] = useState(() => ({ userId, layout: savedLayout(userId) }));
  const layout = preference.userId === userId ? preference.layout : savedLayout(userId);
  const [params] = useSearchParams();
  const [search, setSearch] = useState("");
  const studentId = portal === "parent" ? params.get("student_id") ?? undefined : undefined;
  const member = currentStaffMembership(auth?.memberships ?? []);
  const tools = toolsFor(portal).filter((tool) => portal !== "teacher" || teacherToolIsVisible(member, tool.id));
  if (portal === "teacher" && member?.permissions?.includes("fees.manage")) tools.push({ id: "delegated-fees", name: "Fees & receipts", description: "Delegated fee and receipt access", icon: LockKeyhole, tone: "amber", path: "/teacher/fees" });
  if (portal === "teacher" && member?.permissions?.includes("sis.manage")) tools.push(
    { id: "delegated-people", name: "Students & guardians", description: "Directory, enrolment and guardian authority", icon: LockKeyhole, tone: "teal", path: "/teacher/students" },
    { id: "delegated-office", name: "Institute settings", description: "Delegated academic setup and history", icon: LockKeyhole, tone: "blue", path: "/teacher/administration" });
  if (portal === "teacher" && member?.permissions?.includes("members.invite")) tools.unshift({ id: "member-invitations", name: "Invite members", description: "Invite staff, students and guardians", icon: LockKeyhole, tone: "blue", path: `/${portal}/invitations` });
  const attention = useMoreAttention(portal, studentId, tools.map((tool) => tool.id));
  const adminSchool = auth?.memberships.find(item => item.role === "admin" && item.school_id === auth.user?.active_school_id)
    ?? auth?.memberships.find(item => item.role === "admin");
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
    {!searching && portal === "principal" && activation.data && activation.data.institution.status !== "active" ? <Link className="more-setup-link" to="/principal/activation"><span><strong>Finish setup</strong><small>{activation.data.summary.completed} of {activation.data.summary.required} checks complete</small></span><ChevronRight size={18}/></Link> : null}
    {searching ? <p className="more-result-count" role="status">{results.length ? `${results.length} result${results.length === 1 ? "" : "s"}` : "No matching tools. Try a task such as leave, marks or messages."}</p> : null}
    {groups.filter(group => group.tools.length).map((group, index) => <section key={group.name} className="more-section" aria-labelledby={`more-group-${index}`}>
      <header><h2 id={`more-group-${index}`}>{group.name}</h2></header>
      <div className={`more-grid more-grid--${searching ? "list more-search-results" : layout}`}>{group.tools.map((tool) => <ToolTile key={tool.id} tool={tool} studentId={studentId} attention={attention[tool.id] ?? 0} />)}</div>
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
