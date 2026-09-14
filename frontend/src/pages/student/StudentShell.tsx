import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  AppWindow,
  BookOpen,
  Bot,
  CalendarDays,
  ClipboardCheck,
  Home,
  MessageCircle,
  WalletCards,
} from "lucide-react";
import { AccountMenu } from "../../features/auth/AccountMenu";
import { useOptionalAuth } from "../../features/auth/AuthContext";
import { NotificationCenter } from "../../features/notifications/NotificationCenter";
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
}

const schoolNav = [
  { key: "home" as const, label: "Home", icon: Home },
  { key: "attendance" as const, label: "Attendance", icon: ClipboardCheck },
  { key: "copilot" as const, label: "Copilot", icon: Bot },
  { key: "fees" as const, label: "Fees", icon: WalletCards },
  { key: "launcher" as const, label: "Launcher", icon: AppWindow },
  { key: "chat" as const, label: "Messages", icon: MessageCircle },
];

const eduraNav = [
  { key: "home" as const, label: "Home", icon: Home },
  { key: "attendance" as const, label: "Attendance", icon: ClipboardCheck },
  { key: "classes" as const, label: "Classes", icon: CalendarDays },
  { key: "diary" as const, label: "Diary", icon: BookOpen },
  { key: "launcher" as const, label: "Launcher", icon: AppWindow },
  { key: "chat" as const, label: "Messages", icon: MessageCircle },
];

export function StudentShell({
  children,
  activeNav,
  variant = "edura",
  schoolName,
  routes,
  notificationCount,
  onNotifications,
  onProfile,
}: StudentShellProps) {
  const auth = useOptionalAuth();
  const routeMap = { ...defaultStudentRoutes, ...routes };
  const navItems = variant === "school" ? schoolNav : eduraNav;
  const studentSchools = auth?.memberships.filter((membership) => membership.role === "student") ?? [];
  const membershipSchoolName = studentSchools.length === 1 ? studentSchools[0]?.school_name : undefined;
  const resolvedSchoolName = schoolName ?? membershipSchoolName;

  return (
    <div className={`student-app student-app--${variant}`}>
      <header className={`student-topbar student-topbar--${variant}`}>
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
      </header>

      <main className="student-main">{children}</main>

      <nav className="student-bottom-nav" aria-label="Student navigation">
        {navItems.map(({ key, label, icon: Icon }) => (
          <NavLink
            key={key}
            to={routeMap[key]}
            end={key === "home"}
            className={({ isActive }) => `student-bottom-nav__item ${activeNav === key || isActive ? "is-active" : ""}`}
          >
            {({ isActive }) => {
              const selected = activeNav === key || isActive;
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
