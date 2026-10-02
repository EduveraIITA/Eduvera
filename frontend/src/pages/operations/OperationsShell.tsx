import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { BarChart3, CalendarDays, ClipboardCheck, Home, LayoutDashboard, MessageCircle, MoreHorizontal, ShieldAlert } from "lucide-react";
import { AccountMenu } from "../../features/auth/AccountMenu";
import { useOptionalAuth } from "../../features/auth/AuthContext";
import { NotificationCenter } from "../../features/notifications/NotificationCenter";
import { SchoolBrand } from "../../features/school/SchoolBrand";
import "./operations.css";
import "./operations-links.css";
import "./operations-brand.css";

type Portal = "teacher" | "principal";
type Active = "home" | "attendance" | "timetable" | "chat" | "safeguarding" | "more" | "events";

const nav = {
  teacher: [
    { id: "home", label: "Today", path: "/teacher", icon: Home },
    { id: "attendance", label: "Attendance", path: "/teacher/attendance", icon: ClipboardCheck },
    { id: "timetable", label: "Timetable", path: "/teacher/timetable", icon: CalendarDays },
    { id: "chat", label: "Messages", path: "/teacher/messages", icon: MessageCircle },
    { id: "safeguarding", label: "Safeguarding", path: "/teacher/safeguarding", icon: ShieldAlert },
    { id: "more", label: "More", path: "/teacher/more", icon: MoreHorizontal },
  ],
  principal: [
    { id: "home", label: "Overview", path: "/principal", icon: LayoutDashboard },
    { id: "attendance", label: "Attendance", path: "/principal/attendance", icon: BarChart3 },
    { id: "timetable", label: "Timetable", path: "/principal/timetable", icon: CalendarDays },
    { id: "chat", label: "Messages", path: "/principal/messages", icon: MessageCircle },
    { id: "safeguarding", label: "Safeguarding", path: "/principal/safeguarding", icon: ShieldAlert },
    { id: "more", label: "More", path: "/principal/more", icon: MoreHorizontal },
  ],
} as const;
const mobileNavIds = new Set(["home", "attendance", "timetable", "more"]);

export function OperationsShell({ portal, active, title, children, schoolName: selectedSchoolName, contentHasHeading = false }: { portal: Portal; active: Active; title: string; subtitle?: string; children: ReactNode; schoolName?: string; contentHasHeading?: boolean }) {
  const auth = useOptionalAuth();
  const navigationActive = active === "events" ? "more" : active;
  const mobileActive = mobileNavIds.has(navigationActive) ? navigationActive : "more";
  const schoolName = selectedSchoolName ?? auth?.memberships.find((membership) => membership.role === (portal === "teacher" ? "staff" : "admin"))?.school_name ?? "Cambridge International School";
  return (
    <div className={`operations-app operations-app--${portal}`}>
      <aside className="operations-sidebar">
        <SchoolBrand name={schoolName} className="operations-brand" />
        <nav aria-label={`${portal} portal navigation`}>
          {nav[portal].map(({ id, label, path, icon: Icon }) => (
            <NavLink key={id} to={path} end={id === "home"} aria-current={navigationActive === id ? "page" : undefined} className={navigationActive === id ? "is-active" : ""}><Icon size={19} /><span>{label}</span></NavLink>
          ))}
        </nav>
        <div className="operations-sidebar__scope"><span>Current scope</span><strong>School operations</strong><small>Attendance, timetable, and secure communication.</small></div>
      </aside>
      <div className="operations-workspace">
        <header className="operations-topbar">
          <SchoolBrand name={schoolName} className="operations-topbar__brand" />
          {!contentHasHeading ? <div className="operations-topbar__heading"><h1 className="operations-topbar__title">{title}</h1></div> : null}
          <div className="operations-topbar__actions"><NotificationCenter buttonClassName="operations-icon-button" iconSize={20} /><AccountMenu buttonClassName="operations-profile-button" ariaLabel={`Open ${portal} profile`} iconSize={20} /></div>
        </header>
        <main className="operations-main">{children}</main>
        <nav className="operations-mobile-nav" aria-label={`${portal} portal navigation`}>
          {nav[portal].filter(({ id }) => mobileNavIds.has(id)).map(({ id, label, path, icon: Icon }) => <NavLink key={id} to={path} end={id === "home"} aria-current={mobileActive === id ? "page" : undefined} className={mobileActive === id ? "is-active" : ""}><Icon size={20} /><span>{label}</span></NavLink>)}
        </nav>
      </div>
    </div>
  );
}
