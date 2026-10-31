import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { GuardedPopIntent, UnsavedChangesNavigationGuard } from "../navigation/useUnsavedChangesGuard";

const calls = vi.hoisted(() => ({
  neutral: vi.fn(),
  teacherHome: vi.fn(),
  principalHome: vi.fn(),
  model: vi.fn(),
  continuity: vi.fn(),
  register: vi.fn(),
  teacherRegister: vi.fn(),
  sessionRegister: vi.fn(),
  academic: vi.fn<(props: { data: { class: { name: string } }; onBeforeLeaveChange?: (guard: UnsavedChangesNavigationGuard | null) => void }) => void>(),
  attention: vi.fn(),
  activities: vi.fn<(props: { schoolId: string; coordinate?: boolean; embedded?: boolean; onBeforeLeaveChange?: (guard: UnsavedChangesNavigationGuard | null) => void }) => void>(),
  workspace: vi.fn<(props: { selection: { kind: "registers" | "coordination" }; beforeBack?: (intent?: GuardedPopIntent) => boolean | void }) => void>(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getResponsibilityAttendanceWorkspace: calls.neutral,
    getTeacherHome: calls.teacherHome,
    getPrincipalHome: calls.principalHome,
    getAttendanceModelWorkspace: calls.model,
    getAttendanceContinuityWorkspace: calls.continuity,
    getAttendanceRegister: calls.register,
    getTeacherAttendance: calls.teacherRegister,
    getSessionAttendance: calls.sessionRegister,
  };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, memberships: [] }),
}));

vi.mock("../attention/useAttention", () => ({
  useAttention: calls.attention,
}));
vi.mock("../activities/ActivityAttendanceWorkspace", () => ({
  ActivityAttendanceWorkspace: (props: { schoolId: string; coordinate?: boolean; embedded?: boolean; onBeforeLeaveChange?: (guard: UnsavedChangesNavigationGuard | null) => void }) => { calls.activities(props); return <div>participant-registers:{props.schoolId}:{props.coordinate ? "review" : "record"}</div>; },
}));

vi.mock("../attendance/ResponsibilityAttendanceWorkspace", () => ({
  ResponsibilityAttendanceWorkspace: ({ selection, children, beforeBack }: {
    selection: { kind: "registers" | "coordination" };
    children: (context: unknown) => React.ReactNode;
    beforeBack?: (intent?: GuardedPopIntent) => boolean | void;
  }) => { calls.workspace({ selection, beforeBack }); return children({
    area: { key: "attendance" },
    institutionId: "school-1",
    surface: { key: selection.kind, capabilities: ["attendance.view"], scopes: [] },
    selection,
  }); },
}));

vi.mock("../../pages/operations/AttendanceWorkspacePage", () => ({
  AttendanceWorkspacePage: (props: {
    responsibility?: string;
    classes: unknown[];
    continuity?: { cases: unknown[] };
  }) => <div>{props.responsibility}:{props.classes.length}:{props.continuity?.cases.length ?? 0}</div>,
}));

vi.mock("../attendance/AcademicAttendanceRegister", () => ({
  AcademicAttendanceRegister: (props: { data: { class: { name: string } }; onBeforeLeaveChange?: (guard: UnsavedChangesNavigationGuard | null) => void }) => { calls.academic(props); return <div>register:{props.data.class.name}</div>; },
}));

import {
  ResponsibilityAttendanceCoordinationRoute,
  ResponsibilityAttendanceRegistersRoute,
} from "./OperationsRoutes";

function renderRoute(node: React.ReactNode, path = "/areas/attendance?date=2026-10-19") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function response(surface: "registers" | "coordination") {
  return {
    surface,
    date: "2026-10-19",
    mode: "daily_class",
    campus_mode: "none",
    capture_channels: ["staff_roll_call"],
    registers: surface === "registers" ? [{ class_section_id: "class-1" }] : [],
    continuity: surface === "coordination"
      ? { date: "2026-10-19", summary: { pending: 0, quarantined: 1, accepted: 0, rejected: 0 }, cases: [{ id: "case-1" }] }
      : null,
    authority: { capabilities: [], scopes: [] },
    context: {
      institution_id: "school-1",
      environment: { kind: "live", namespace_id: "live:school-1" },
      as_of: "2026-10-19T04:00:00.000Z",
    },
  };
}

describe("canonical Attendance routes", () => {
  beforeEach(() => {
    cleanup();
    Object.values(calls).forEach((mock) => mock.mockReset());
    calls.attention.mockReturnValue({ data: undefined, isError: false, isPending: false });
  });

  it("loads registers without teacher-home or persona attention transports", async () => {
    calls.neutral.mockResolvedValue(response("registers"));

    renderRoute(<ResponsibilityAttendanceRegistersRoute />);

    expect(await screen.findByText("participant-registers:school-1:record")).toBeVisible();
    expect(calls.activities).toHaveBeenCalledWith({ schoolId: "school-1", embedded: true, onBeforeLeaveChange: expect.any(Function) as unknown });
    expect(calls.neutral).not.toHaveBeenCalled();
    expect(calls.teacherHome).not.toHaveBeenCalled();
    expect(calls.model).not.toHaveBeenCalled();
    expect(calls.attention).not.toHaveBeenCalled();
  });

  it("loads coordination and its review queue without principal-home/admin transport", async () => {
    calls.neutral.mockResolvedValue(response("coordination"));

    renderRoute(<ResponsibilityAttendanceCoordinationRoute />);

    expect(await screen.findByText("participant-registers:school-1:review")).toBeVisible();
    expect(calls.activities).toHaveBeenCalledWith({ schoolId: "school-1", coordinate: true, embedded: true, onBeforeLeaveChange: expect.any(Function) as unknown });
    expect(calls.neutral).not.toHaveBeenCalled();
    expect(calls.principalHome).not.toHaveBeenCalled();
    expect(calls.model).not.toHaveBeenCalled();
    expect(calls.continuity).not.toHaveBeenCalled();
    expect(calls.attention).not.toHaveBeenCalled();
  });

  it("opens a canonical daily register without the teacher-screen endpoint", async () => {
    calls.register.mockResolvedValue({
      date: "2026-10-19",
      class: { id: "class-1", name: "Class 6A" },
      continuity_snapshot: { expires_at: "2026-10-20T00:00:00.000Z" },
    });

    renderRoute(
      <ResponsibilityAttendanceRegistersRoute />,
      "/areas/attendance/registers?date=2026-10-19&class_section_id=class-1",
    );

    expect(await screen.findByText("register:Class 6A")).toBeVisible();
    expect(calls.register).toHaveBeenCalledWith("class-1", "2026-10-19");
    expect(calls.teacherRegister).not.toHaveBeenCalled();
    expect(calls.teacherHome).not.toHaveBeenCalled();
  });

  it.each(["registers", "coordination"] as const)("opens the exact academic lesson in %s without converting its selector", async surface => {
    calls.sessionRegister.mockResolvedValue({ date: "2026-10-19", session: { id: "session-1" }, class: { id: "class-1", name: "Programming · Class 6A" } });
    renderRoute(surface === "registers" ? <ResponsibilityAttendanceRegistersRoute /> : <ResponsibilityAttendanceCoordinationRoute />,
      `/areas/attendance/${surface}?date=2026-10-19&session_id=session-1`);
    expect(await screen.findByText("register:Programming · Class 6A")).toBeVisible();
    expect(calls.sessionRegister).toHaveBeenCalledExactlyOnceWith("session-1");
    expect(calls.register).not.toHaveBeenCalled();
    expect(calls.teacherRegister).not.toHaveBeenCalled();
    expect(calls.activities).not.toHaveBeenCalled();
  });

  it.each(["registers", "coordination"] as const)("bridges the %s academic editor guard into shell Back and clears it on exit", async surface => {
    calls.sessionRegister.mockResolvedValue({ date: "2026-10-19", session: { id: "session-1" }, class: { id: "class-1", name: "Programming" } });
    renderRoute(surface === "registers" ? <ResponsibilityAttendanceRegistersRoute /> : <ResponsibilityAttendanceCoordinationRoute />,
      `/areas/attendance/${surface}?date=2026-10-19&session_id=session-1`);
    await screen.findByText("register:Programming");
    const registerGuard = calls.academic.mock.lastCall?.[0].onBeforeLeaveChange as (guard: UnsavedChangesNavigationGuard | null) => void;
    const beforeBack = calls.workspace.mock.lastCall?.[0].beforeBack as (intent?: GuardedPopIntent) => boolean | void;
    const guard = vi.fn<UnsavedChangesNavigationGuard>(() => false);
    registerGuard(guard);
    expect(beforeBack()).toBe(false);
    const intent: GuardedPopIntent = { kind: "pop", fromIndex: 1, toIndex: 0, fromHref: "/areas/attendance/registers?session_id=session-1", toHref: "/areas/timetable/session?session_id=lesson-1" };
    expect(beforeBack(intent)).toBe(false);
    expect(guard).toHaveBeenLastCalledWith(intent);
    registerGuard(null);
    expect(beforeBack()).toBeUndefined();
  });

  it.each(["registers", "coordination"] as const)("bridges the %s editor guard into the shell Back control and clears it on exit", (surface) => {
    renderRoute(surface === "registers" ? <ResponsibilityAttendanceRegistersRoute /> : <ResponsibilityAttendanceCoordinationRoute />);
    const registerGuard = calls.activities.mock.lastCall?.[0].onBeforeLeaveChange as (guard: UnsavedChangesNavigationGuard | null) => void;
    const beforeBack = calls.workspace.mock.lastCall?.[0].beforeBack as (intent?: GuardedPopIntent) => boolean | void;
    expect(beforeBack()).toBeUndefined();
    const stay = vi.fn(() => false);
    registerGuard(stay);
    expect(beforeBack()).toBe(false);
    expect(stay).toHaveBeenCalledOnce();
    const leave = vi.fn(() => true);
    registerGuard(leave);
    expect(beforeBack()).toBe(true);
    expect(leave).toHaveBeenCalledOnce();
    registerGuard(null);
    expect(beforeBack()).toBeUndefined();
    expect(stay).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledOnce();
    const intent: GuardedPopIntent = { kind: "pop", fromIndex: 1, toIndex: 0, fromHref: "/teacher/attendance/class-1", toHref: "/teacher/attendance" };
    const popGuard = vi.fn<UnsavedChangesNavigationGuard>(() => true);
    registerGuard(popGuard);
    expect(beforeBack(intent)).toBe(true);
    expect(popGuard).toHaveBeenCalledExactlyOnceWith(intent);
  });
});
