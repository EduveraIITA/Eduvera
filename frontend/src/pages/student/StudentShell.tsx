import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Bot,
  CalendarDays,
  ClipboardCheck,
  Home,
  MoreHorizontal,
} from "lucide-react";
import { AccountMenu } from "../../features/auth/AccountMenu";
import { useOptionalAuth } from "../../features/auth/AuthContext";
import { NotificationCenter } from "../../features/notifications/NotificationCenter";
import { PortalPageTitle } from "../../features/navigation/PortalPageTitle";
import { SchoolBrand } from "../../features/school/SchoolBrand";

import "./student-pages.css";

export type StudentNavKey =
  | "home"
  | "attendance"
  | "classes"
  | "diary"
  | "copilot"
  | "fees"
  | "launcher"
  | "chat";

export interface StudentRouteMap {
  home: string;
  attendance: string;
  classes: string;
  diary: string;
  copilot: string;
  fees: string;
  launcher: string;
  chat: string;
}

export const defaultStudentRoutes: StudentRouteMap = {
  home: "/student",
  attendance: "/student/attendance",
  classes: "/student/timetable",
  diary: "/student/diary",
  copilot: "/student/copilot",
  fees: "/student/fees",
  launcher: "/student/apps",
  chat: "/student/messages",
};

export interface StudentShellProps {
  children: ReactNode;
  activeNav: StudentNavKey;
  variant?: "school" | "edura";
  section?: string;
  className?: string;
  schoolName?: string;
  routes?: Partial<StudentRouteMap>;
  notificationCount?: number;
  onNotifications?: () => void;
  onProfile?: () => void;
  pageTitle?: string;
  backTo?: string;
  onBack?: () => void;
}

const schoolNav = [
  { key: "home" as const, label: "Home", icon: Home },
  { key: "attendance" as const, label: "Attendance", icon: ClipboardCheck },
  { key: "copilot" as const, label: "Copilot", icon: Bot },
  { key: "launcher" as const, label: "More", icon: MoreHorizontal },
];

const eduraNav = [
  { key: "home" as const, label: "Home", icon: Home },
  { key: "attendance" as const, label: "Attendance", icon: ClipboardCheck },
  { key: "classes" as const, label: "Timetable", icon: CalendarDays },
  { key: "launcher" as const, label: "More", icon: MoreHorizontal },
];

function pageTitleFor(pathname: string, activeNav: StudentNavKey, section?: string) {
  if (pathname === "/student") return "Home";
  if (pathname.startsWith("/student/attendance/eligibility")) return "Attendance eligibility";
  if (pathname.startsWith("/student/leave/new")) return "Apply leave";
  if (pathname.startsWith("/student/leave")) return "Leave Tracker";
  if (pathname.startsWith("/student/timetable/week")) return "Weekly timetable";
  if (pathname.startsWith("/student/timetable")) return "Timetable";
  if (pathname.startsWith("/student/events")) return "Events";
  if (pathname.startsWith("/student/calendar")) return "Calendar";
  if (pathname.startsWith("/student/messages")) return "Messages";
  if (pathname.startsWith("/student/fees")) return "Fees & receipts";
  if (pathname.startsWith("/student/apps")) return "More";
  if (pathname.startsWith("/student/diary")) return "Diary";
  if (pathname.startsWith("/student/attendance")) return "Attendance";
  if (pathname.startsWith("/student/copilot")) return "Attendance Copilot";
  return section ?? ({ home: "Home", attendance: "Attendance", classes: "Classes", diary: "Diary", copilot: "Attendance Copilot", fees: "Fees & receipts", launcher: "More", chat: "Messages" } satisfies Record<StudentNavKey, string>)[activeNav];
}

export function StudentShell({
  children,
  activeNav,
  variant = "edura",
  section,
  schoolName,
  routes,
  notificationCount,
  onNotifications,
  onProfile,
  pageTitle,
  backTo,
  onBack,
}: StudentShellProps) {
  const location = useLocation();
  const auth = useOptionalAuth();
  const routeMap = { ...defaultStudentRoutes, ...routes };
  const navItems = variant === "school" && location.pathname.replace(/\/$/, "") === "/student" ? schoolNav : eduraNav;
  const mobileActive = navItems.some((item) => item.key === activeNav) ? activeNav : "launcher";
  const studentSchools = auth?.memberships.filter((membership) => membership.role === "student") ?? [];
  const membershipSchoolName = studentSchools.length === 1 ? studentSchools[0]?.school_name : undefined;
  const resolvedSchoolName = schoolName ?? membershipSchoolName;

  return (
    <div className={`student-app student-app--${variant}`}>
      <header className={`student-topbar student-topbar--${variant}`}>
        <div className="student-topbar__top">
          <SchoolBrand name={resolvedSchoolName ?? "Cambridge International School"} className="student-topbar__brand" />
          <div className="student-topbar__actions">
            <NotificationCenter
              buttonClassName="student-icon-button student-notification-button"
              iconSize={21}
              fallbackUnreadCount={notificationCount}
              onOpen={onNotifications}
            />
            <AccountMenu buttonClassName="student-profile-button" ariaLabel="Open profile" iconSize={21} onOpen={onProfile} />
          </div>
        </div>
        <div className="student-topbar__context">
          <PortalPageTitle title={pageTitle ?? pageTitleFor(location.pathname, activeNav, section)} rootPath="/student" backTo={backTo} onBack={onBack} />
        </div>
      </header>

      <main className="student-main">{children}</main>

      <nav className="student-bottom-nav" aria-label="Student navigation">
        {navItems.map(({ key, label, icon: Icon }) => (
          <NavLink
            key={key}
            to={routeMap[key]}
            end={key === "home"}
            aria-current={mobileActive === key ? "page" : undefined}
            className={({ isActive }) => `student-bottom-nav__item ${mobileActive === key || isActive ? "is-active" : ""}`}
          >
            {({ isActive }) => {
              const selected = mobileActive === key || isActive;
              return (
                <>
                  <Icon size={22} strokeWidth={selected ? 2.35 : 1.9} />
                  <span>{label}</span>
                </>
              );
            }}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
