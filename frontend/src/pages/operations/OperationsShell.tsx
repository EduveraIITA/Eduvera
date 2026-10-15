import { PoweredBy } from "../../features/school/PoweredBy";
import { Fragment, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { BarChart3, CalendarDays, ClipboardCheck, Home, LayoutDashboard, MessageCircle, MoreHorizontal, ShieldAlert, ShieldCheck, TrendingUp } from "lucide-react";
import { AccountMenu } from "../../features/auth/AccountMenu";
import { useOptionalAuth } from "../../features/auth/AuthContext";
import { useProFeatures } from "../../features/auth/useProFeatures";
import { AttentionBadge, AttentionUnavailableBadge, attentionLabel, combineAttentionCounts } from "../../features/attention/AttentionBadge";
import { useAttention } from "../../features/attention/useAttention";
import { currentStaffMembership, hasStaffPermission } from "../../features/auth/staffAccess";
import { NotificationCenter } from "../../features/notifications/NotificationCenter";
import { PortalPageTitle } from "../../features/navigation/PortalPageTitle";
import { PlanningNavigation } from "../../features/navigation/PlanningNavigation";
import { SchoolBrand } from "../../features/school/SchoolBrand";
import { AssistantPanel, AssistantTab } from "../../features/assistant/DemoChat";
import { useDemoChat } from "../../features/assistant/useDemoChat";
import "./operations.css";
import "./operations-links.css";
import "./operations-brand.css";

type Portal = "teacher" | "principal";
type Active = "home" | "attendance" | "insights" | "timetable" | "chat" | "safeguarding" | "more" | "events" | "gate";

const nav = {
  teacher: [
    { id: "home", label: "Today", path: "/teacher", icon: Home },
    { id: "attendance", label: "Attendance", path: "/teacher/attendance", icon: ClipboardCheck },
    { id: "timetable", label: "Timetable", path: "/teacher/timetable", icon: CalendarDays },
    { id: "chat", label: "Messages", path: "/teacher/messages", icon: MessageCircle },
    { id: "safeguarding", label: "Safeguarding", path: "/teacher/safeguarding", icon: ShieldAlert },
    { id: "gate", label: "In & Out", path: "/teacher/gate", icon: ShieldCheck },
    { id: "more", label: "More", path: "/teacher/more", icon: MoreHorizontal },
  ],
  principal: [
    { id: "home", label: "Overview", path: "/principal", icon: LayoutDashboard },
    { id: "attendance", label: "Attendance", path: "/principal/attendance", icon: BarChart3 },
    { id: "insights", label: "Insights", path: "/principal/insights", icon: TrendingUp },
    { id: "timetable", label: "Timetable", path: "/principal/timetable", icon: CalendarDays },
    { id: "chat", label: "Messages", path: "/principal/messages", icon: MessageCircle },
    { id: "safeguarding", label: "Safeguarding", path: "/principal/safeguarding", icon: ShieldAlert },
    { id: "more", label: "More", path: "/principal/more", icon: MoreHorizontal },
  ],
} as const;

export function OperationsShell({ portal, active, title, children, schoolName: selectedSchoolName, backTo, onBack, beforeBack, pageTitleTrailing }: { portal: Portal; active: Active; title: string; subtitle?: string; children: ReactNode; schoolName?: string; contentHasHeading?: boolean; backTo?: string; onBack?: () => void; beforeBack?: () => boolean | void; pageTitleTrailing?: ReactNode }) {
  const auth = useOptionalAuth();
  const mobileNavIds = new Set(["home", "attendance", portal === "principal" ? "insights" : "timetable", "gate", "more"]);
  const { pathname } = useLocation();
  const planning = portal === "principal" && (pathname.startsWith("/principal/timetable") || pathname === "/principal/calendar");
  const planningTabs = portal === "principal" && (pathname === "/principal/timetable" || pathname === "/principal/calendar");
  const member=currentStaffMembership(auth?.memberships ?? []);
  const chat = useDemoChat(`${auth?.user?.id ?? "preview"}:${portal}:${member?.school_id ?? ""}`);
  const proFeatures = useProFeatures();
  const assistantEnabled = proFeatures.enabled;
  const assistantActive = assistantEnabled && chat.active;
  const assistantOpen = assistantEnabled && chat.open;
  const attention = useAttention(portal);
  const attentionForNavigation = (id: string) => id === "more" ? attention.data?.summary
    : id === "attendance" ? combineAttentionCounts(attention.data?.modules.attendance, attention.data?.modules.registers)
      : id === "timetable" ? combineAttentionCounts(attention.data?.modules.timetable, attention.data?.modules.weekly, attention.data?.modules.calendar)
      : id === "chat" ? attention.data?.modules.messages
        : id === "safeguarding" ? attention.data?.modules.safeguarding
          : undefined;
  const attentionOwnedNavigation = new Set(["more", "attendance", "timetable", "chat", "safeguarding"]);
  const attentionUnavailableForNavigation = (id: string) => attention.isError && attentionOwnedNavigation.has(id);
  const required:Record<string,string>={attendance:'attendance.view',timetable:'timetable.view',chat:'messages.view',safeguarding:'safeguarding.review',gate:'gate.manage'};
  const navigation=nav[portal].filter(item=>{
    if(portal!=='teacher') return true;
    if(item.id==='gate') return member?.permissions?.includes('gate.manage')===true;
    const permission=required[item.id];
    return !permission || hasStaffPermission(member,permission);
  });
  const navigationActive = planning ? "timetable" : active === "events" ? "more" : active;
  const mobileActive = mobileNavIds.has(navigationActive) ? navigationActive : "more";
  const mobileNavigation = navigation.filter(({ id }) => mobileNavIds.has(id));
  const schoolName = selectedSchoolName ?? auth?.memberships.find((membership) => membership.role === (portal === "teacher" ? "staff" : "admin"))?.school_name ?? "Cambridge International School";
  return (
    <div className={`operations-app operations-app--${portal}`}>
      <aside className="operations-sidebar">
        <SchoolBrand name={schoolName} className="operations-brand" />
        <nav aria-label={`${portal} portal navigation`}>
          {navigation.map(({ id, label, path, icon: Icon }, index) => (
            <Fragment key={id}>
              {assistantEnabled && index === Math.min(2, navigation.length - 1) ? <AssistantTab chat={chat} sidebar /> : null}
              <NavLink to={path} end={id === "home"} aria-current={assistantActive ? false : navigationActive === id ? "page" : undefined}
                aria-label={`${portal === "principal" && id === "safeguarding" ? "Student concerns" : label}${attentionUnavailableForNavigation(id) ? ", attention status unavailable" : attentionLabel(attentionForNavigation(id)) ? `, ${attentionLabel(attentionForNavigation(id))}` : ""}`}
                className={!assistantActive && navigationActive === id ? "is-active" : ""}>
                <Icon size={19} /><span>{portal === "principal" && id === "safeguarding" ? "Student concerns" : label}</span>
                {attentionUnavailableForNavigation(id) ? <AttentionUnavailableBadge /> : <AttentionBadge counts={attentionForNavigation(id)} variant="nav" />}
              </NavLink>
            </Fragment>
          ))}
        </nav>
        <div className="operations-sidebar__scope"><span>Current scope</span><strong>School operations</strong><small>Attendance, timetable, and secure communication.</small></div>
        <PoweredBy />
      </aside>
      <div className="operations-workspace">
        <header className="operations-topbar">
          <SchoolBrand name={schoolName} className="operations-topbar__brand" />
          <div className="operations-topbar__heading"><PortalPageTitle title={title} rootPath={`/${portal}`} backTo={backTo} onBack={onBack} beforeBack={beforeBack} trailing={pageTitleTrailing} /></div>
          <div className="operations-topbar__actions"><NotificationCenter buttonClassName="operations-icon-button" iconSize={20} /><AccountMenu buttonClassName="operations-profile-button" ariaLabel={`Open ${portal} profile`} iconSize={20} /></div>
        </header>
        <main className="operations-main" inert={assistantOpen}>{planningTabs ? <PlanningNavigation/> : null}{children}{active === "home" ? <PoweredBy className="powered-by--home" /> : null}</main>
        {assistantEnabled ? <AssistantPanel chat={chat} context={{ portal, pageTitle: title, permissions: member?.permissions }} /> : null}
        {!(assistantEnabled && chat.fullPage) ? <nav className="operations-mobile-nav" aria-label={`${portal} portal navigation`}>
          {mobileNavigation.map(({ id, label, path, icon: Icon }, index) => <Fragment key={id}>
            {assistantEnabled && index === Math.min(2, mobileNavigation.length - 1) ? <AssistantTab chat={chat} /> : null}
            <NavLink to={path} end={id === "home"} aria-current={assistantActive ? false : mobileActive === id ? "page" : undefined}
              aria-label={`${label}${attentionUnavailableForNavigation(id) ? ", attention status unavailable" : attentionLabel(attentionForNavigation(id)) ? `, ${attentionLabel(attentionForNavigation(id))}` : ""}`}
              className={!assistantActive && mobileActive === id ? "is-active" : ""}>
              <Icon size={20} /><span>{label}</span>
              {attentionUnavailableForNavigation(id) ? <AttentionUnavailableBadge /> : <AttentionBadge counts={attentionForNavigation(id)} variant="nav" />}
            </NavLink>
          </Fragment>)}
        </nav> : null}
      </div>
    </div>
  );
}
