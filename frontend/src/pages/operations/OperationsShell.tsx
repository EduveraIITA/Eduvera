import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { BarChart3, CalendarDays, ClipboardCheck, Home, LayoutDashboard } from "lucide-react";
import { AccountMenu } from "../../features/auth/AccountMenu";
import { useOptionalAuth } from "../../features/auth/AuthContext";
import { NotificationCenter } from "../../features/notifications/NotificationCenter";
import { SchoolBrand } from "../../features/school/SchoolBrand";
import "./operations.css";
import "./operations-links.css";
import "./operations-brand.css";

type Portal = "teacher" | "principal";
type Active = "home" | "attendance" | "timetable";

const nav = {
  teacher: [
    { id: "home", label: "Today", path: "/teacher", icon: Home },
    { id: "attendance", label: "Attendance", path: "/teacher/attendance", icon: ClipboardCheck },
    { id: "timetable", label: "Timetable", path: "/teacher/timetable", icon: CalendarDays },
  ],
  principal: [
    { id: "home", label: "Overview", path: "/principal", icon: LayoutDashboard },
    { id: "attendance", label: "Attendance", path: "/principal/attendance", icon: BarChart3 },
    { id: "timetable", label: "Timetable", path: "/principal/timetable", icon: CalendarDays },
  ],
} as const;

export function OperationsShell({ portal, active, title, subtitle, children, schoolName: selectedSchoolName, contentHasHeading = false }: { portal: Portal; active: Active; title: string; subtitle: string; children: ReactNode; schoolName?: string; contentHasHeading?: boolean }) {
  const auth = useOptionalAuth();
  const Title = contentHasHeading ? "p" : "h1";
  const schoolName = selectedSchoolName ?? auth?.memberships.find((membership) => membership.role === (portal === "teacher" ? "staff" : "admin"))?.school_name ?? "Cambridge International School";
  return (
    <div className={`operations-app operations-app--${portal}`}>
      <aside className="operations-sidebar">
        <SchoolBrand name={schoolName} className="operations-brand" />
        <nav aria-label={`${portal} portal navigation`}>
          {nav[portal].map(({ id, label, path, icon: Icon }) => (
            <NavLink key={id} to={path} end={id === "home"} className={active === id ? "is-active" : ""}><Icon size={19} /><span>{label}</span></NavLink>
          ))}
        </nav>
        <div className="operations-sidebar__scope"><span>Current term</span><strong>Term 1 · 2026-27</strong><small>Attendance and timetable records are live.</small></div>
      </aside>
      <div className="operations-workspace">
        <header className="operations-topbar">
          <SchoolBrand name={schoolName} className="operations-topbar__brand" />
          <div><span>{subtitle}</span><Title className="operations-topbar__title">{title}</Title></div>
          <div><NotificationCenter buttonClassName="operations-icon-button" iconSize={20} /><AccountMenu buttonClassName="operations-profile-button" ariaLabel={`Open ${portal} profile`} iconSize={20} /></div>
        </header>
        <main className="operations-main">{children}</main>
        <nav className="operations-mobile-nav" aria-label={`${portal} portal navigation`}>
          {nav[portal].map(({ id, label, path, icon: Icon }) => <NavLink key={id} to={path} end={id === "home"} className={active === id ? "is-active" : ""}><Icon size={20} /><span>{label}</span></NavLink>)}
        </nav>
      </div>
    </div>
  );
}
