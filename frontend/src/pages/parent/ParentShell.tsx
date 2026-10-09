import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import {
  BookOpen,
  CalendarDays,
  CalendarX2,
  Home,
  ListChecks,
  MessageCircle,
  MoreHorizontal,
} from "lucide-react";
import { AccountMenu } from "../../features/auth/AccountMenu";
import { useOptionalAuth } from "../../features/auth/AuthContext";
import { NotificationCenter } from "../../features/notifications/NotificationCenter";
import { PortalPageTitle } from "../../features/navigation/PortalPageTitle";
import { getAccessibleStudents } from "../../features/school/api";
import { SchoolBrand } from "../../features/school/SchoolBrand";
import { AssistantPanel, AssistantTab } from "../../features/assistant/DemoChat";
import { useDemoChat } from "../../features/assistant/useDemoChat";
import { demoParentChild } from "./parentDemoData";
import type { ParentChildSummary, ParentPageAction } from "./parentTypes";
import "./parent-pages.css";

export type ParentRoute = "home" | "attendance" | "leave" | "diary" | "timetable" | "chat" | "events" | "more";

function ChildPortrait({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return avatarUrl ? <img src={avatarUrl} alt="" /> : <span aria-hidden="true">{name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>;
}

const childAccentThemes = [
  { name: "blue", primary: "#0037b0", bright: "#1d4ed8", soft: "#eff4ff", strong: "#dce9ff", fixed: "#dce1ff", gradient: "linear-gradient(132deg, #164ed0 0%, #2969e7 58%, #3d7af0 100%)", shadow: "rgba(29, 78, 216, .22)" },
  { name: "violet", primary: "#5b279b", bright: "#7436bd", soft: "#f8f3ff", strong: "#ede2fb", fixed: "#e7d7f8", gradient: "linear-gradient(132deg, #572493 0%, #7436bd 58%, #8d53ce 100%)", shadow: "rgba(116, 54, 189, .22)" },
  { name: "teal", primary: "#00685f", bright: "#087d71", soft: "#eef9f7", strong: "#d6f0eb", fixed: "#ccebe5", gradient: "linear-gradient(132deg, #00685f 0%, #087d71 58%, #15988a 100%)", shadow: "rgba(8, 125, 113, .22)" },
  { name: "amber", primary: "#7b3900", bright: "#9b4a00", soft: "#fff7ed", strong: "#f9e5cc", fixed: "#f4dbbd", gradient: "linear-gradient(132deg, #7b3900 0%, #9b4a00 58%, #b9640b 100%)", shadow: "rgba(155, 74, 0, .22)" },
  { name: "rose", primary: "#8f174a", bright: "#b1205d", soft: "#fff2f7", strong: "#f7dbe7", fixed: "#f2d0df", gradient: "linear-gradient(132deg, #8f174a 0%, #b1205d 58%, #ca3d76 100%)", shadow: "rgba(177, 32, 93, .22)" },
  { name: "indigo", primary: "#3730a3", bright: "#4f46c7", soft: "#f3f3ff", strong: "#e2e3fb", fixed: "#d9daf8", gradient: "linear-gradient(132deg, #3730a3 0%, #4f46c7 58%, #6861db 100%)", shadow: "rgba(79, 70, 199, .22)" },
] as const;

function childTheme(index: number, count: number) {
  return childAccentThemes[count <= 1 ? 0 : Math.max(0, index) % childAccentThemes.length]!;
}

function accentVariables(theme: (typeof childAccentThemes)[number]) {
  return {
    "--parent-primary": theme.primary,
    "--parent-primary-bright": theme.bright,
    "--parent-soft": theme.soft,
    "--parent-soft-2": theme.strong,
    "--parent-soft-3": theme.fixed,
    "--parent-accent-shadow": theme.shadow,
    "--edura-brand": theme.primary,
    "--edura-brand-bright": theme.bright,
    "--edura-brand-soft": theme.fixed,
    "--edura-feature-gradient": theme.gradient,
    "--primary": theme.primary,
    "--primary-bright": theme.bright,
    "--primary-fixed": theme.fixed,
    "--primary-fixed-dim": theme.strong,
    "--surface-low": theme.soft,
    "--surface-container": theme.strong,
  } as CSSProperties;
}

const parentRoutes: Array<{
  id: ParentRoute;
  label: string;
  path: string;
  icon: typeof Home;
}> = [
  { id: "home", label: "Home", path: "/parent/home", icon: Home },
  { id: "attendance", label: "Attendance", path: "/parent/attendance", icon: ListChecks },
  { id: "leave", label: "Leave", path: "/parent/leave", icon: CalendarX2 },
  { id: "diary", label: "Diary", path: "/parent/diary", icon: BookOpen },
  { id: "timetable", label: "Timetable", path: "/parent/timetable", icon: CalendarDays },
  { id: "chat", label: "Messages", path: "/parent/messages", icon: MessageCircle },
  { id: "more", label: "More", path: "/parent/more", icon: MoreHorizontal },
];

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
  institutionLevel?: boolean;
}

export function ParentShell({
  active,
  pageLabel,
  child = demoParentChild,
  children,
  onSelectChild,
  childOptions,
  presenceStatus,
  selectedChildId,
  childSwitchDisabled = false,
  backTo,
  onBack,
  institutionLevel = false,
}: ParentShellProps) {
  const auth = useOptionalAuth();
  const navigationActive = active === "events" ? "more" : active;
  const mobileActive = ["home", "attendance", "diary"].includes(navigationActive) ? navigationActive : "more";
  const schoolName = auth?.memberships.find((membership) => membership.role === "guardian")?.school_name ?? "Cambridge International School";
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
    : childOptions?.length ? childOptions : [child];
  const currentChildId = selectedChildId ?? selectedStudentId ?? child.id;
  const currentChildIndex = selectableChildren.findIndex((option) => option.id === currentChildId);
  const activeTheme = childTheme(currentChildIndex, selectableChildren.length);
  const orderedChildren = currentChildIndex < 0 ? selectableChildren : [
    ...selectableChildren.slice(currentChildIndex), ...selectableChildren.slice(0, currentChildIndex),
  ];
  const displayedChild=selectableChildren.find((option)=>option.id===currentChildId)??child;
  const chat = useDemoChat(`${auth?.user?.id ?? "preview"}:parent:${currentChildId}`);
  const stackedTheme=(position:number)=>{
    const option=orderedChildren[position];
    const optionIndex=option?selectableChildren.findIndex((candidate)=>candidate.id===option.id):-1;
    return childTheme(optionIndex,selectableChildren.length);
  };
  const rootAccentVariables={...accentVariables(activeTheme),"--parent-stack-secondary-gradient":stackedTheme(1).gradient,"--parent-stack-tertiary-gradient":stackedTheme(2).gradient} as CSSProperties;
  const contextualBackTo=backTo&&selectedStudentId&&backTo.startsWith("/parent/")&&!backTo.includes("student_id=")?`${backTo}${backTo.includes("?")?"&":"?"}student_id=${encodeURIComponent(selectedStudentId)}`:backTo;

  const chooseChild = async (childId: string) => {
    if(onSelectChild)await onSelectChild(childId);
    else {
      const next=new URLSearchParams(searchParams);
      next.set("student_id",childId);
      setSearchParams(next);
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
                    if (selectableChildren.length === 2) void chooseChild(selectableChildren.find((option) => option.id !== currentChildId)?.id ?? currentChildId);
                    else setSelectorOpen((open) => !open);
                  }}>
                  {orderedChildren.slice(0, 3).map((option, index) => {
                    const optionIndex=selectableChildren.findIndex((childOption)=>childOption.id===option.id);
                    const optionTheme=childTheme(optionIndex,selectableChildren.length);
                    return <span className="parent-child-profiles__layer" key={option.id} style={{ "--profile-layer": index,"--profile-accent":optionTheme.bright,"--profile-soft":optionTheme.strong } as CSSProperties}>
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
          <PortalPageTitle title={pageLabel} rootPath="/parent/home" backTo={contextualBackTo} onBack={onBack} />
          {active !== "home" && active !== "events" && !institutionLevel ? <span className="parent-header__child-label">
            {presenceStatus ? <span className={presenceStatus === "in" ? "presence-dot presence-dot--in" : "presence-dot presence-dot--away"} /> : null}
            <span className="parent-header__child-name">{displayedChild.name} · Class {displayedChild.grade.replace("Grade ", "")}{displayedChild.section}</span>
          </span> : null}
        </div>
      </header>

      <main className="parent-main" inert={chat.open}>{children}</main>
      <AssistantPanel chat={chat} context={{ portal: "parent", pageTitle: pageLabel, studentId: currentChildId }} />

      {!chat.fullPage ? <nav className="parent-bottom-nav" aria-label="Parent portal navigation">
        {parentRoutes.filter((item) => ["home", "attendance", "diary", "more"].includes(item.id)).map((item, index) => {
          const Icon = item.icon;
          const isActive = !chat.active && mobileActive === item.id;
          return (
            <Fragment key={item.id}>
            {index === 2 ? <AssistantTab chat={chat} className="parent-nav-item" /> : null}
            <NavLink
              className={isActive ? "parent-nav-item is-active" : "parent-nav-item"}
              to={selectedStudentId ? `${item.path}?student_id=${encodeURIComponent(selectedStudentId)}` : item.path}
              aria-current={chat.active ? false : isActive ? "page" : undefined}
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
