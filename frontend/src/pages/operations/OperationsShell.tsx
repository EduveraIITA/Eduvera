import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { BarChart3, CalendarDays, ClipboardCheck, Home, LayoutDashboard, LayoutGrid, MessageCircle, MoreHorizontal, ShieldAlert } from "lucide-react";
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

export function OperationsShell({ portal, active, title, subtitle, children, schoolName: selectedSchoolName, contentHasHeading = false }: { portal: Portal; active: Active; title: string; subtitle: string; children: ReactNode; schoolName?: string; contentHasHeading?: boolean }) {
  const auth = useOptionalAuth();
  const navigationActive = active === "events" ? "more" : active;
  const Title = contentHasHeading ? "p" : "h1";
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
          <div><span>{subtitle}</span><Title className="operations-topbar__title">{title}</Title></div>
          <div><NotificationCenter buttonClassName="operations-icon-button" iconSize={20} /><Link className="operations-icon-button" to={`/${portal}/more`} aria-label="More tools"><LayoutGrid size={20} /></Link><AccountMenu buttonClassName="operations-profile-button" ariaLabel={`Open ${portal} profile`} iconSize={20} /></div>
        </header>
        <main className="operations-main">{children}</main>
        <nav className="operations-mobile-nav" aria-label={`${portal} portal navigation`}>
          {nav[portal].map(({ id, label, path, icon: Icon }) => <NavLink key={id} to={path} end={id === "home"} aria-current={navigationActive === id ? "page" : undefined} className={navigationActive === id ? "is-active" : ""}><Icon size={20} /><span>{label}</span></NavLink>)}
        </nav>
      </div>
    </div>
  );
}
