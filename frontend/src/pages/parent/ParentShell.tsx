import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import {
  BookOpen,
  CalendarDays,
  CalendarX2,
  Home,
  ListChecks,
  MessageCircle,
} from "lucide-react";
import { AccountMenu } from "../../features/auth/AccountMenu";
import { useOptionalAuth } from "../../features/auth/AuthContext";
import { NotificationCenter } from "../../features/notifications/NotificationCenter";
import { getAccessibleStudents } from "../../features/school/api";
import { SchoolBrand } from "../../features/school/SchoolBrand";
import { demoParentChild } from "./parentDemoData";
import type { ParentChildSummary, ParentPageAction } from "./parentTypes";
import "./parent-pages.css";

export type ParentRoute = "home" | "attendance" | "leave" | "diary" | "timetable" | "chat";

function ChildPortrait({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return avatarUrl ? <img src={avatarUrl} alt="" /> : <span aria-hidden="true">{name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>;
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
}: ParentShellProps) {
  const auth = useOptionalAuth();
  const schoolName = auth?.memberships.find((membership) => membership.role === "guardian")?.school_name ?? "Cambridge International School";
  const [searchParams] = useSearchParams();
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
  const currentChildId = selectedChildId ?? child.id;
  const currentChildIndex = selectableChildren.findIndex((option) => option.id === currentChildId);
  const orderedChildren = currentChildIndex < 0 ? selectableChildren : [
    ...selectableChildren.slice(currentChildIndex), ...selectableChildren.slice(0, currentChildIndex),
  ];

  const chooseChild = async (childId: string) => {
    await onSelectChild?.(childId);
    setSelectorOpen(false);
  };

  return (
    <div className="parent-app">
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
                  {orderedChildren.slice(0, 3).map((option, index) => (
                    <span className="parent-child-profiles__layer" key={option.id} style={{ "--profile-layer": index } as CSSProperties}>
                      <ChildPortrait name={option.name} avatarUrl={option.avatarUrl} />
                    </span>
                  ))}
                </button>
                {selectorOpen && selectableChildren.length > 2 ? (
                  <div className="parent-child-profiles__menu" role="dialog" aria-label="Select child profile">
                    {selectableChildren.map((option) => (
                      <button className="parent-child-profiles__option" key={option.id} type="button"
                        aria-label={`View ${option.name}'s parent dashboard`} aria-pressed={option.id === currentChildId}
                        disabled={childSwitchDisabled || option.id === currentChildId} onClick={() => void chooseChild(option.id)}>
                        <span className="parent-child-profiles__portrait"><ChildPortrait name={option.name} avatarUrl={option.avatarUrl} /></span>
                        <span className="parent-child-profiles__name">{option.name.split(" ")[0]}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <AccountMenu buttonClassName="profile-button" ariaLabel="Open parent profile" iconSize={20} />
          </div>
        </div>
        <div className="parent-header__context">
          <span className="parent-header__page">{pageLabel}</span>
          {active !== "home" ? <span className="parent-header__child-label">
            <span className={presenceStatus === "in" ? "presence-dot presence-dot--in" : presenceStatus === "away" ? "presence-dot presence-dot--away" : "presence-dot"} />
            <span className="parent-header__child-name">{child.name} · Class {child.grade.replace("Grade ", "")}{child.section}</span>
          </span> : null}
        </div>
      </header>

      <main className="parent-main">{children}</main>

      <nav className="parent-bottom-nav" aria-label="Parent portal navigation">
        {parentRoutes.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <NavLink
              key={item.id}
              className={isActive ? "parent-nav-item is-active" : "parent-nav-item"}
              to={selectedStudentId ? `${item.path}?student_id=${encodeURIComponent(selectedStudentId)}` : item.path}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={21} strokeWidth={isActive ? 2.25 : 1.8} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
