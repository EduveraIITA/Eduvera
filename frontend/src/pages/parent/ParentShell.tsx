import { PoweredBy } from "../../features/school/PoweredBy";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
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
import { searchForStudentContext } from "../../features/navigation/studentContextSearch";
import { getAccessibleStudents } from "../../features/school/api";
import { SchoolBrand } from "../../features/school/SchoolBrand";
import { AssistantPanel, AssistantTab } from "../../features/assistant/DemoChat";
import { useDemoChat } from "../../features/assistant/useDemoChat";
import { useProFeatures } from "../../features/auth/useProFeatures";
import type { ParentChildSummary, ParentPageAction } from "./parentTypes";
import "./parent-pages.css";

export type ParentRoute = "home" | "attendance" | "leave" | "diary" | "timetable" | "chat" | "events" | "more";

function ChildPortrait({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return avatarUrl ? <img src={avatarUrl} alt="" /> : <span aria-hidden="true">{name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>;
}

const childAccentThemes = [
  { name: "blue", bright: "#1d4ed8", strong: "#dce9ff" },
  { name: "violet", bright: "#7436bd", strong: "#ede2fb" },
  { name: "teal", bright: "#087d71", strong: "#d6f0eb" },
  { name: "amber", bright: "#9b4a00", strong: "#f9e5cc" },
  { name: "rose", bright: "#b1205d", strong: "#f7dbe7" },
  { name: "indigo", bright: "#4f46c7", strong: "#e2e3fb" },
] as const;

function childTheme(index: number, count: number) {
  return childAccentThemes[count <= 1 ? 0 : Math.max(0, index) % childAccentThemes.length]!;
}

function accentVariables(theme: (typeof childAccentThemes)[number]) {
  return {
    // A child colour identifies a portrait, not the selected operating world.
    // Actions and surfaces always inherit the app's Live / Simulation theme.
    "--profile-accent": theme.bright,
    "--profile-soft": theme.strong,
  } as CSSProperties;
}

const workspaceRoutes = [
  { id: "today", label: "Today", path: "/today", icon: CalendarDays },
  { id: "work", label: "Work", path: "/work", icon: BriefcaseBusiness },
  { id: "areas", label: "Areas", path: "/areas", icon: LayoutGrid },
  { id: "more", label: "More", path: "/more", icon: Ellipsis },
] as const;

function activeWorkspaceSection(pathname: string, active: ParentRoute) {
  if (pathname === "/today") return "today";
  if (pathname === "/work" || pathname.startsWith("/work/")) return "work";
  if (pathname === "/more" || pathname.startsWith("/more/")) return "more";
  if (pathname === "/areas" || pathname.startsWith("/areas/")) return "areas";
  return active === "home" ? "today" : active === "more" ? "more" : "areas";
}

export interface ParentShellProps {
  active: ParentRoute;
  pageLabel: string;
  child?: ParentChildSummary;
  children: ReactNode;
  onSelectChild?: (childId: string) => ParentPageAction;
  childOptions?: Array<{ id: string; name: string; grade: string; section: string; avatarUrl?: string }>;
  presenceStatus?: "in" | "away";
  selectedChildId?: string;
  childSwitchDisabled?: boolean;
  backTo?: string;
  onBack?: () => void;
  beforeBack?: () => boolean | void;
  institutionLevel?: boolean;
  pageTitleTrailing?: ReactNode;
}

export function ParentShell({
  active,
  pageLabel,
  child,
  children,
  onSelectChild,
  childOptions,
  presenceStatus,
  selectedChildId,
  childSwitchDisabled = false,
  backTo,
  onBack,
  beforeBack,
  institutionLevel = false,
  pageTitleTrailing,
}: ParentShellProps) {
  const auth = useOptionalAuth();
  const location = useLocation();
  const activeSection = activeWorkspaceSection(location.pathname, active);
  const guardianSchoolName = auth?.memberships.find((membership) => membership.role === "guardian")?.school_name?.trim();
  const schoolName = guardianSchoolName || (!auth ? "School" : auth.status === "loading" ? "Loading school" : "School information unavailable");
  const [searchParams,setSearchParams] = useSearchParams();
  const selectedStudentId = searchParams.get("student_id");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const childProfilesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectorOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!childProfilesRef.current?.contains(event.target as Node)) setSelectorOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectorOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectorOpen]);
  const studentsQuery = useQuery({
    queryKey: ["school", "accessible-students"],
    queryFn: getAccessibleStudents,
    staleTime: 60_000,
  });
  const accessibleChildren = studentsQuery.data?.results.map((student) => ({
    id: student.id,
    name: student.user.display_name,
    grade: `Grade ${student.current_enrollment.grade}`,
    section: student.current_enrollment.section,
    avatarUrl: student.avatar_url,
  }));
  const selectableChildren = accessibleChildren?.length
    ? accessibleChildren
    : childOptions?.length ? childOptions : child ? [child] : [];
  const currentChildId = selectedChildId ?? selectedStudentId ?? accessibleChildren?.[0]?.id ?? childOptions?.[0]?.id ?? child?.id;
  const currentChildIndex = selectableChildren.findIndex((option) => option.id === currentChildId);
  const activeTheme = childTheme(currentChildIndex, selectableChildren.length);
  const orderedChildren = currentChildIndex < 0 ? selectableChildren : [
    ...selectableChildren.slice(currentChildIndex), ...selectableChildren.slice(0, currentChildIndex),
  ];
  const displayedChild=selectableChildren.find((option)=>option.id===currentChildId)
    ?? (child && (!currentChildId || child.id === currentChildId) ? child : undefined);
  const chat = useDemoChat(`${auth?.user?.id ?? "preview"}:workspace:${auth?.user?.active_school_id ?? ""}:${currentChildId ?? "self"}`);
  const proFeatures = useProFeatures();
  const assistantEnabled = proFeatures.enabled;
  const assistantActive = assistantEnabled && chat.active;
  const assistantOpen = assistantEnabled && chat.open;
  const rootAccentVariables=accentVariables(activeTheme);
  const contextualBackTo=backTo&&selectedStudentId&&backTo.startsWith("/parent/")&&!backTo.includes("student_id=")?`${backTo}${backTo.includes("?")?"&":"?"}student_id=${encodeURIComponent(selectedStudentId)}`:backTo;

  const chooseChild = async (childId: string) => {
    if(onSelectChild)await onSelectChild(childId);
    else {
      setSearchParams(searchForStudentContext(searchParams, childId), { replace: true });
    }
    setSelectorOpen(false);
  };

  return (
    <div className="parent-app" data-child-accent={activeTheme.name} style={rootAccentVariables}>
      <header className="parent-header">
        <div className="parent-header__top">
          <SchoolBrand name={schoolName} className="parent-brand" />
          <div className="parent-header__actions">
            <NotificationCenter buttonClassName="icon-button" iconSize={20} />
            {selectableChildren.length > 1 ? (
              <div className="parent-child-profiles" ref={childProfilesRef}>
                <button className="parent-child-profiles__trigger" type="button"
                  aria-label={selectableChildren.length === 2 ? "Switch to other child" : "Choose child profile"}
                  aria-expanded={selectableChildren.length > 2 ? selectorOpen : undefined}
                  aria-haspopup={selectableChildren.length > 2 ? "dialog" : undefined}
                  disabled={childSwitchDisabled || studentsQuery.isPending}
                  onClick={() => {
                    if (selectableChildren.length === 2) {
                      const nextChildId = selectableChildren.find((option) => option.id !== currentChildId)?.id ?? selectableChildren[0]?.id;
                      if (nextChildId) void chooseChild(nextChildId);
                    } else setSelectorOpen((open) => !open);
                  }}>
                  {orderedChildren.slice(0, 3).map((option, index) => {
                    const optionIndex=selectableChildren.findIndex((childOption)=>childOption.id===option.id);
                    const optionTheme=childTheme(optionIndex,selectableChildren.length);
                    return <span className="parent-child-profiles__layer" data-child-accent={optionTheme.name} key={option.id} style={{ "--profile-layer": index,"--profile-accent":optionTheme.bright,"--profile-soft":optionTheme.strong } as CSSProperties}>
                      <ChildPortrait name={option.name} avatarUrl={option.avatarUrl} />
                    </span>;
                  })}
                </button>
                {selectorOpen && selectableChildren.length > 2 ? (
                  <div className="parent-child-profiles__menu" role="dialog" aria-label="Select child profile">
                    {selectableChildren.map((option,index) => {
                      const optionTheme=childTheme(index,selectableChildren.length);
                      return (
                      <button className="parent-child-profiles__option" key={option.id} type="button"
                        data-child-accent={optionTheme.name}
                        style={{"--profile-accent":optionTheme.bright,"--profile-soft":optionTheme.strong} as CSSProperties}
                        aria-label={`View ${option.name}'s parent dashboard`} aria-pressed={option.id === currentChildId}
                        disabled={childSwitchDisabled || option.id === currentChildId} onClick={() => void chooseChild(option.id)}>
                        <span className="parent-child-profiles__portrait"><ChildPortrait name={option.name} avatarUrl={option.avatarUrl} /></span>
                        <span className="parent-child-profiles__name">{option.name.split(" ")[0]}</span>
                      </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            <AccountMenu buttonClassName="profile-button" ariaLabel="Open parent profile" iconSize={20} />
          </div>
        </div>
        <div className="parent-header__context">
          <PortalPageTitle title={pageLabel} rootPath="/today" backTo={contextualBackTo} onBack={onBack} beforeBack={beforeBack} trailing={pageTitleTrailing} />
          {active !== "home" && active !== "events" && !institutionLevel ? <span className="parent-header__child-label">
            {presenceStatus ? <span className={presenceStatus === "in" ? "presence-dot presence-dot--in" : "presence-dot presence-dot--away"} /> : null}
            <span className="parent-header__child-name">{displayedChild
              ? `${displayedChild.name} · Class ${displayedChild.grade.replace("Grade ", "")}${displayedChild.section}`
              : studentsQuery.isPending ? "Loading student…" : "Student information unavailable"}</span>
          </span> : null}
        </div>
      </header>

      <main className="parent-main" inert={assistantOpen}>{children}{active === "home" ? <PoweredBy className="powered-by--home" /> : null}</main>
      {assistantEnabled ? <AssistantPanel chat={chat} context={{ portal: "parent", pageTitle: pageLabel, studentId: currentChildId }} /> : null}

      {!(assistantEnabled && chat.fullPage) ? <nav className="parent-bottom-nav" aria-label="Workspace">
        {workspaceRoutes.map((item, index) => {
          const Icon = item.icon;
          const isActive = !assistantActive && activeSection === item.id;
          return (
            <Fragment key={item.id}>
            {assistantEnabled && index === 2 ? <AssistantTab chat={chat} className="parent-nav-item" /> : null}
            <NavLink
              className={isActive ? "parent-nav-item is-active" : "parent-nav-item"}
              to={item.path}
              end
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={21} strokeWidth={isActive ? 2.25 : 1.8} />
              <span>{item.label}</span>
            </NavLink>
            </Fragment>
          );
        })}
      </nav> : null}
    </div>
  );
}
