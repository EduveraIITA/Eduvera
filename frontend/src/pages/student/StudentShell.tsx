import { PoweredBy } from "../../features/school/PoweredBy";
import { Fragment, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BriefcaseBusiness,
  CalendarDays,
  Ellipsis,
  LayoutGrid,
} from "lucide-react";
import { AccountMenu } from "../../features/auth/AccountMenu";
import { useOptionalAuth } from "../../features/auth/AuthContext";
import { NotificationCenter } from "../../features/notifications/NotificationCenter";
import { PortalPageTitle } from "../../features/navigation/PortalPageTitle";
import { SchoolBrand } from "../../features/school/SchoolBrand";
import { AssistantPanel, AssistantTab } from "../../features/assistant/DemoChat";
import { useDemoChat } from "../../features/assistant/useDemoChat";
import { useProFeatures } from "../../features/auth/useProFeatures";

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
  variant?: "school" | "platform";
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
  beforeBack?: () => boolean | void;
  pageTitleTrailing?: ReactNode;
}

const workspaceNav = [
  { key: "today", label: "Today", path: "/today", icon: CalendarDays },
  { key: "work", label: "Work", path: "/work", icon: BriefcaseBusiness },
  { key: "areas", label: "Areas", path: "/areas", icon: LayoutGrid },
  { key: "more", label: "More", path: "/more", icon: Ellipsis },
] as const;

function activeWorkspaceSection(pathname: string, activeNav: StudentNavKey) {
  if (pathname === "/today") return "today";
  if (pathname === "/work" || pathname.startsWith("/work/")) return "work";
  if (pathname === "/more" || pathname.startsWith("/more/")) return "more";
  if (pathname === "/areas" || pathname.startsWith("/areas/")) return "areas";
  return activeNav === "home" ? "today" : activeNav === "launcher" ? "more" : "areas";
}

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
  variant = "platform",
  section,
  schoolName,
  routes,
  notificationCount,
  onNotifications,
  onProfile,
  pageTitle,
  backTo,
  onBack,
  beforeBack,
  pageTitleTrailing,
}: StudentShellProps) {
  const location = useLocation();
  const auth = useOptionalAuth();
  void routes;
  const activeSection = activeWorkspaceSection(location.pathname, activeNav);
  const studentSchools = auth?.memberships.filter((membership) => membership.role === "student") ?? [];
  const membershipSchoolName = studentSchools.length === 1 ? studentSchools[0]?.school_name : undefined;
  const resolvedSchoolName = schoolName ?? membershipSchoolName;
  const chat = useDemoChat(`${auth?.user?.id ?? "preview"}:workspace:${studentSchools[0]?.school_id ?? auth?.user?.active_school_id ?? ""}`);
  const proFeatures = useProFeatures();
  const assistantEnabled = proFeatures.enabled;
  const assistantActive = assistantEnabled && chat.active;
  const assistantOpen = assistantEnabled && chat.open;

  return (
    <div className={`student-app student-app--${variant}`}>
      <header className={`student-topbar student-topbar--${variant}`}>
        <div className="student-topbar__top">
          <SchoolBrand name={resolvedSchoolName ?? "School"} className="student-topbar__brand" />
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
          <PortalPageTitle title={pageTitle ?? pageTitleFor(location.pathname, activeNav, section)} rootPath="/today" backTo={backTo} onBack={onBack} beforeBack={beforeBack} trailing={pageTitleTrailing} />
        </div>
      </header>

      <main className="student-main" inert={assistantOpen}>{children}{activeNav === "home" ? <PoweredBy className="powered-by--home" /> : null}</main>
      {assistantEnabled ? <AssistantPanel chat={chat} context={{ portal: "student", pageTitle: pageTitle ?? pageTitleFor(location.pathname, activeNav, section) }} /> : null}

      {!(assistantEnabled && chat.fullPage) ? <nav className="student-bottom-nav" aria-label="Workspace">
        {workspaceNav.map(({ key, label, path, icon: Icon }, index) => <Fragment key={key}>
          {assistantEnabled && index === 2 ? <AssistantTab chat={chat} className="student-bottom-nav__item" /> : null}
          <NavLink
            to={path}
            end
            aria-current={!assistantActive && activeSection === key ? "page" : undefined}
            className={`student-bottom-nav__item ${!assistantActive && activeSection === key ? "is-active" : ""}`}
          >
            <Icon size={22} strokeWidth={!assistantActive && activeSection === key ? 2.35 : 1.9} />
            <span>{label}</span>
          </NavLink>
        </Fragment>)}
      </nav> : null}
    </div>
  );
}
