import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { App } from "./App";
import type { AuthUser, MembershipRole } from "./features/auth/AuthContext";
import type {
  WorkspaceArea,
  WorkspaceAreaSurface,
  WorkspaceManifest,
  WorkspaceScope,
} from "./features/workspace/types";
import { schoolApiFixture } from "./test/schoolApiFixtures";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock("./lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/api")>();
  return { ...original, apiFetch: apiFetchMock };
});

const schoolId = "school-1";
const studentId = "10000000-0000-4000-a000-000000000001";
const secondStudentId = "10000000-0000-4000-a000-000000000002";
const institutionScope: WorkspaceScope = {
  kind: "institution",
  id: schoolId,
  label: "Cambridge International School",
};
const classScope: WorkspaceScope = { kind: "class", id: "class-7a", label: "Class 7A" };

function surface(
  key: string,
  label: string,
  href: string,
  capabilities: readonly string[],
  scopes: readonly WorkspaceScope[] = [institutionScope],
): WorkspaceAreaSurface {
  return { key, label, href, capabilities, scopes };
}

function area(
  key: string,
  label: string,
  description: string,
  surfaces: readonly WorkspaceAreaSurface[],
): WorkspaceArea {
  return {
    key,
    label,
    description,
    href: `/areas/${key}`,
    icon: key === "in-out" ? "gate" : key === "timetable" ? "timetable" : key === "messages" ? "messages" : "work",
    attention_count: key === "attendance" ? 1 : 0,
    capabilities: [...new Set(surfaces.flatMap((entry) => entry.capabilities))],
    scopes: [...new Map(surfaces.flatMap((entry) => entry.scopes).map((scope) => [`${scope.kind}:${scope.id ?? ""}`, scope])).values()],
    surfaces,
  };
}

const dependentScope: readonly WorkspaceScope[] = [
  { kind: "dependent", id: studentId, label: "Aarav Sharma" },
  classScope,
];
const secondDependentScope: readonly WorkspaceScope[] = [
  { kind: "dependent", id: secondStudentId, label: "Ananya Sharma" },
  classScope,
];
const selfScope: readonly WorkspaceScope[] = [
  { kind: "self", id: studentId, label: "Aarav Sharma" },
  classScope,
];

const workspaceAreas: readonly WorkspaceArea[] = [
  area("attendance", "Attendance", "Registers, records and attendance follow-up", [
    surface("registers", "Assigned registers", "/areas/attendance/registers", ["attendance.record"], [classScope]),
    surface("coordination", "Attendance follow-up", "/areas/attendance/coordination", ["followups.coordinate"]),
    surface(`records:self:${studentId}`, "My attendance", `/areas/attendance/records?scope=self&student_id=${studentId}`, ["attendance.view"], selfScope),
    surface(`records:dependent:${studentId}`, "Aarav Sharma attendance", `/areas/attendance/records?scope=dependent&student_id=${studentId}`, ["attendance.view"], dependentScope),
    surface(`records:dependent:${secondStudentId}`, "Ananya Sharma attendance", `/areas/attendance/records?scope=dependent&student_id=${secondStudentId}`, ["attendance.view"], secondDependentScope),
  ]),
  area("timetable", "Timetable", "Schedules, sessions and timetable planning", [
    surface("schedule", "My schedule", "/areas/timetable/schedule", ["schedule.view"], [classScope]),
    surface("planning", "Timetable planning", "/areas/timetable/planning", ["schedule.manage"]),
    surface(`schedule:self:${studentId}`, "My timetable", `/areas/timetable/schedule?scope=self&student_id=${studentId}`, ["timetable.view"], selfScope),
    surface(`schedule:dependent:${studentId}`, "Aarav Sharma timetable", `/areas/timetable/schedule?scope=dependent&student_id=${studentId}`, ["timetable.view"], dependentScope),
  ]),
  area("in-out", "In & Out", "Authorized entry, exit and visitor operations", [
    surface("operate", "Record movements", "/areas/in-out/operate", ["gate.operate"]),
    surface("manage", "Manage entry points", "/areas/in-out/manage", ["gate.manage"]),
  ]),
  area("assessments", "Assessments", "Assessment, examination and results work", [
    surface("assigned", "Assessments & marking", "/areas/assessments/assigned", ["assessments.view", "assessments.mark"]),
    surface("manage", "Assessment coordination", "/areas/assessments/manage", ["assessments.manage"]),
    surface(`results:self:${studentId}`, "My results", `/areas/assessments/results?scope=self&student_id=${studentId}`, ["assessments.view"], selfScope),
    surface(`results:dependent:${studentId}`, "Aarav Sharma results", `/areas/assessments/results?scope=dependent&student_id=${studentId}`, ["assessments.view"], dependentScope),
  ]),
  area("events", "Events", "Campus events, activities and assigned event work", [
    surface("assigned", "Assigned events", "/areas/events/assigned", ["events.view"]),
    surface("manage", "Event coordination", "/areas/events/manage", ["events.manage"]),
    surface(`calendar:self:${studentId}`, "My events", `/areas/events/calendar?scope=self&student_id=${studentId}`, ["events.view"], selfScope),
    surface(`calendar:dependent:${studentId}`, "Aarav Sharma events", `/areas/events/calendar?scope=dependent&student_id=${studentId}`, ["events.view"], dependentScope),
  ]),
  area("messages", "Messages", "Campus conversations, updates and diary", [
    surface("conversations", "Campus conversations", "/areas/messages/conversations", ["messages.view", "messages.send", "groups.create"]),
    surface("updates", "Updates", "/areas/messages/updates", ["messages.view", "messages.publish"]),
    surface(`conversations:self:${studentId}`, "My conversations", `/areas/messages/conversations?scope=self&student_id=${studentId}`, ["messages.view"], selfScope),
    surface(`conversations:dependent:${studentId}`, "Aarav Sharma conversations", `/areas/messages/conversations?scope=dependent&student_id=${studentId}`, ["messages.view"], dependentScope),
    surface(`updates:dependent:${studentId}`, "Aarav Sharma updates", `/areas/messages/updates?scope=dependent&student_id=${studentId}`, ["messages.view"], dependentScope),
    surface(`diary:self:${studentId}`, "My diary", `/areas/messages/diary?scope=self&student_id=${studentId}`, ["messages.view"], selfScope),
    surface(`diary:dependent:${studentId}`, "Aarav Sharma diary", `/areas/messages/diary?scope=dependent&student_id=${studentId}`, ["messages.view"], dependentScope),
  ]),
  area("departure", "Departure", "Handover, journey and collection work", [
    surface("operate", "Assigned journey", "/areas/departure/operate", ["departure.collect"]),
    surface("manage", "Departure coordination", "/areas/departure/manage", ["departure.manage"]),
    surface(`plan:dependent:${studentId}`, "Aarav Sharma departure", `/areas/departure/plan?scope=dependent&student_id=${studentId}`, ["departure.view"], dependentScope),
  ]),
  area("reports", "Reports", "Learning reports and authorized remarks", [
    surface("remarks", "Reports & remarks", "/areas/reports/remarks", ["reports.comment"]),
    surface(`progress:self:${studentId}`, "My progress", `/areas/reports/progress?scope=self&student_id=${studentId}`, ["reports.view"], selfScope),
    surface(`progress:dependent:${studentId}`, "Aarav Sharma progress", `/areas/reports/progress?scope=dependent&student_id=${studentId}`, ["reports.view"], dependentScope),
  ]),
  area("people", "People", "People and groups within your responsibility", [
    surface("students", "Students & guardians", "/areas/people/students", ["sis.manage"]),
  ]),
  area("fees", "Fees", "Authorized fee and receipt operations", [
    surface("ledger", "Fees & receipts", "/areas/fees/ledger", ["fees.manage"]),
    surface(`account:dependent:${studentId}`, "Aarav Sharma fees", `/areas/fees/account?scope=dependent&student_id=${studentId}`, ["fees.view"], dependentScope),
  ]),
  area("responsibilities", "Staff work", "Duties, leave and accepted cover", [
    surface("mine", "My responsibilities", "/areas/responsibilities/mine", ["responsibilities.view"]),
  ]),
  area("assistant", "Assistant", "ThatCampus AI within your authorized context", [
    surface("conversation", "ThatCampus AI", "/areas/assistant/conversation", ["ai.use"]),
  ]),
  area("care", "Student care", "Restricted care and safeguarding work", [
    surface("concerns", "Student concerns", "/areas/care/concerns", ["safeguarding.review"]),
  ]),
];

function workspaceManifest(
  environment: WorkspaceManifest["context"]["environment"] = { kind: "live", namespace_id: `live:${schoolId}` },
): WorkspaceManifest {
  return {
    revision: "workspace-app-routes-1",
    generated_at: "2026-10-18T08:05:00.000Z",
    context: {
      institution_id: schoolId,
      institution_label: "Cambridge International School",
      scope_label: "Cambridge network",
      date_label: "Sunday, 18 October",
      environment,
    },
    today: {
      now: [{
        id: "session-1",
        title: "Mathematics · Class 7A",
        detail: "Scheduled in Classroom 204",
        status_label: "Now",
        time_label: "9:00–9:45 AM",
        href: "/areas/attendance/registers?date=2026-10-18&class_section_id=class-7a",
        action_label: "Take attendance",
        source_label: "Published timetable",
        source_at: "9:00 AM",
        tone: "info",
      }],
      attention: { total: 2, overdue: 0, due_soon: 1 },
      next: [{
        id: "gate-duty-1",
        title: "Main Gate duty",
        detail: "Authorized cover",
        status_label: "Next",
        time_label: "2:00 PM",
        href: "/areas/in-out/operate",
        action_label: "Open In & Out",
        source_label: "Accepted cover",
        tone: "neutral",
      }],
      completed_automatically: [],
    },
    work: {
      total: 2,
      items: [{
        id: "attendance-task-1",
        kind: "task",
        urgency: "due_soon",
        title: "Complete Class 7A attendance",
        detail: "The current register is ready.",
        action_label: "Open register",
        href: "/areas/attendance/registers?date=2026-10-18&class_section_id=class-7a",
        due_label: "Due in 20 min",
        source_label: "Attendance",
        tone: "attention",
      }, {
        id: "event-offer-1",
        kind: "offer",
        urgency: "normal",
        title: "Review science fair duty",
        action_label: "Review offer",
        href: "/areas/events/assigned?event=event-1",
        source_label: "Events",
        tone: "neutral",
      }],
    },
    areas: workspaceAreas,
    more: {
      groups: [{
        key: "setup",
        label: "Campus setup",
        items: [{ key: "setup", label: "Campus setup", description: "Choose the next campus outcome", href: "/more/setup", icon: "settings" }],
      }, {
        key: "work",
        label: "My work record",
        items: [{ key: "my-responsibilities", label: "My responsibilities", href: "/areas/responsibilities/mine", icon: "work" }],
      }, {
        key: "account",
        label: "Account",
        items: [{ key: "account", label: "Account & appearance", href: "/account/profile", icon: "settings" }],
      }],
      setup: [
        { key: "institution", label: "Campus setup", description: "Continue progressive campus setup", href: "/more/setup/institution", icon: "building" },
        { key: "people", label: "People & access", description: "Connect people and account access", href: "/more/setup/people", icon: "people" },
        { key: "organization", label: "Organization", description: "Departments and reporting lines", href: "/more/setup/organization", icon: "building" },
        { key: "responsibilities", label: "Responsibilities", description: "Assign work, scope and fallback", href: "/more/setup/responsibilities", icon: "work" },
        { key: "capabilities", label: "Capabilities", description: "Review enabled capabilities", href: "/more/setup/capabilities", icon: "settings" },
      ],
      other: [
        { key: "my-responsibilities", label: "My responsibilities", href: "/more/responsibilities", icon: "work" },
        { key: "account", label: "Account & appearance", href: "/account/profile", icon: "settings" },
      ],
    },
    freshness: { state: "current", as_of: "9:05 AM", source_revision: "source-routes-1" },
  };
}

const defaultUser: AuthUser = {
  id: "user-1",
  username: "campus.operator",
  email: "operator@example.com",
  first_name: "Campus",
  last_name: "Operator",
  display_name: "Campus Operator",
  role: "staff",
  email_verified: true,
  active_school_id: schoolId,
};

const permissions = [...new Set(workspaceAreas.flatMap((entry) => entry.capabilities))];

interface SessionOptions {
  readonly user?: AuthUser;
  readonly roles?: readonly MembershipRole[];
  readonly manifest?: WorkspaceManifest;
  readonly proFeatures?: boolean;
  readonly executionEnvironment?: Record<string, unknown>;
}

function onboardingWorkspace() {
  return {
    status: "purpose_required",
    workspace: {
      id: "workspace-1",
      display_name: "My workspace",
      profile_named: false,
      timezone: "Asia/Kolkata",
      verification_status: "not_required",
      onboarding_model: "progressive",
    },
    goals: { selected: [], primary: null },
    resume: { step: "purpose", goal: null, path: "/onboarding/start" },
    catalogue: [
      { key: "attendance", label: "Attendance", description: "Take a register", destination: "/areas/attendance", selection_kind: "goal", selected: false },
      { key: "gate", label: "Gate entry & exit", description: "Record movement", destination: "/areas/in-out", selection_kind: "goal", selected: false },
    ],
    applications: [],
  };
}

function mockAuthenticatedSession({
  user = defaultUser,
  roles = ["staff", "student", "guardian", "admin"],
  manifest = workspaceManifest(),
  proFeatures = false,
  executionEnvironment = { mode: "live", namespace_id: `live:${schoolId}`, institution_id: schoolId },
}: SessionOptions = {}) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === "/api/v1/auth/session/") {
      return Promise.resolve({
        authenticated: true,
        user,
        csrf_token: "csrf",
        demo_mode: true,
        execution_environment: executionEnvironment,
      });
    }
    if (path === "/api/v1/auth/me/") {
      return Promise.resolve({
        user,
        students: [],
        memberships: roles.map((role, index) => ({
          id: `membership-${role}-${index}`,
          school_id: schoolId,
          school_name: "Cambridge International School",
          role,
        })),
        school_permissions: roles.includes("staff")
          ? [{ school_id: schoolId, permissions, custom_role: { id: "campus-operator", name: "Campus operator" } }]
          : [],
        demo_mode: true,
        execution_environment: executionEnvironment,
        onboarding: roles.length
          ? { status: "ready", has_school_access: true, selected_goal_count: 4, resume: { step: "operating", goal: null, path: "/today" } }
          : { status: "purpose_required", has_school_access: false, selected_goal_count: 0, resume: { step: "purpose", goal: null, path: "/onboarding/start" } },
      });
    }
    if (path === "/api/v1/workspace") return Promise.resolve(manifest);
    if (path === "/api/v1/auth/pro-features/") return Promise.resolve({ enabled: proFeatures, preview: true });
    if (path === "/api/v1/onboarding/workspace/") return Promise.resolve(onboardingWorkspace());
    if (path.startsWith("/api/v1/campus-events/catalog?")) return Promise.resolve({ class_sections: [], students: [], staff: [], subjects: [] });
    if (path.startsWith("/api/v1/campus-events?")) return Promise.resolve({ items: [], next_cursor: null });
    return Promise.resolve(schoolApiFixture(path));
  });
}

function mockAnonymousSession() {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === "/api/v1/auth/session/") {
      return Promise.resolve({ authenticated: false, user: null, csrf_token: "csrf", demo_mode: true });
    }
    return Promise.reject(new Error(`Unexpected request before sign-in: ${path}`));
  });
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function route() {
  return screen.getByLabelText("Current route").textContent ?? "";
}

function workspaceNavigation() {
  const navigation = document.querySelector<HTMLElement>(".operations-sidebar nav[aria-label='Workspace']");
  expect(navigation).not.toBeNull();
  return within(navigation!);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  apiFetchMock.mockReset();
  mockAuthenticatedSession();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("responsibility-composed application routes", () => {
  it("lands an app-only member in neutral Today without inventing operational surfaces or an assistant portal", async () => {
    const empty = workspaceManifest();
    mockAuthenticatedSession({ user: { ...defaultUser, role: "member" }, roles: ["member"], proFeatures: true,
      manifest: { ...empty, today: { now: [], next: [], completed_automatically: [], attention: { total: 0, overdue: 0, due_soon: 0 } }, work: { total: 0, items: [] }, areas: [], more: { groups: [], other: [] } } });
    renderApp("/");
    await waitFor(() => expect(route()).toBe("/today"));
    expect(workspaceNavigation().getAllByRole("link").map(link => link.textContent)).toEqual(["Today", "Work", "Areas", "More"]);
    expect(screen.queryByRole("button", { name: "Assistant" })).not.toBeInTheDocument();
    expect(apiFetchMock.mock.calls.some(([path]) => /teacher\/home|principal\/home|parent\/home|students\//.test(String(path)))).toBe(false);
  });
  it("denies an app-only member's direct operational link before loading its domain API", async () => {
    mockAuthenticatedSession({ user: { ...defaultUser, role: "member" }, roles: ["member"], manifest: { ...workspaceManifest(), areas: [] } });
    renderApp("/areas/in-out/manage");
    expect(await screen.findByRole("heading", { name: "Your workspace access changed" })).toBeVisible();
    expect(apiFetchMock.mock.calls.some(([path]) => /gate|visitor/i.test(String(path)) && path !== "/api/v1/workspace")).toBe(false);
  });
  it("keeps one source-backed Today, Work, Areas and More shell without portal selection", async () => {
    const interact = userEvent.setup();
    renderApp("/today");

    expect(await screen.findByRole("link", { name: /Mathematics · Class 7A, Take attendance/ })).toHaveAttribute(
      "href",
      "/areas/attendance/registers?date=2026-10-18&class_section_id=class-7a",
    );
    const scheduleSource = screen.getByText("Published timetable · 9:00 AM");
    expect(scheduleSource).not.toBeVisible();
    const scheduleDetails = screen.getByText("Schedule details").closest("summary");
    expect(scheduleDetails).not.toBeNull();
    await interact.click(scheduleDetails!);
    expect(scheduleSource).toBeVisible();
    expect(screen.getByRole("link", { name: /Mathematics · Class 7A, Take attendance/ })).toHaveAttribute(
      "href",
      "/areas/attendance/registers?date=2026-10-18&class_section_id=class-7a",
    );
    expect(workspaceNavigation().getAllByRole("link").map((link) => link.textContent)).toEqual(["Today", "Work", "Areas", "More"]);
    expect(workspaceNavigation().getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");

    await interact.click(workspaceNavigation().getByRole("link", { name: "Work" }));
    expect(await screen.findByRole("link", { name: /Task: Complete Class 7A attendance/ })).toHaveAttribute(
      "href",
      "/areas/attendance/registers?date=2026-10-18&class_section_id=class-7a",
    );
    expect(screen.getByRole("link", { name: /Offer: Review science fair duty/ })).toHaveAttribute(
      "href",
      "/areas/events/assigned?event=event-1",
    );
    expect(workspaceNavigation().getByRole("link", { name: "Work" })).toHaveAttribute("aria-current", "page");

    await interact.click(workspaceNavigation().getByRole("link", { name: "Areas" }));
    expect(await screen.findByRole("link", { name: "Open Attendance" })).toHaveAttribute("href", "/areas/attendance");
    expect(screen.getByRole("link", { name: "Open Messages" })).toHaveAttribute("href", "/areas/messages");
    expect(screen.getByRole("link", { name: "Open Student care" })).toHaveAttribute("href", "/areas/care");
    expect(workspaceNavigation().getByRole("link", { name: "Areas" })).toHaveAttribute("aria-current", "page");

    await interact.click(screen.getByRole("link", { name: "Open Attendance" }));
    expect(await screen.findByRole("link", { name: "Open Assigned registers" })).toHaveAttribute("href", "/areas/attendance/registers");
    expect(screen.getByRole("link", { name: "Open Attendance follow-up" })).toHaveAttribute("href", "/areas/attendance/coordination");
    expect(screen.getByRole("link", { name: "Open Aarav Sharma attendance" })).toHaveAttribute(
      "href",
      `/areas/attendance/records?scope=dependent&student_id=${studentId}`,
    );

    await interact.click(workspaceNavigation().getByRole("link", { name: "More" }));
    expect(await screen.findByRole("link", { name: "Open Campus setup" })).toHaveAttribute("href", "/more/setup");
    expect(screen.getByRole("link", { name: "Open My responsibilities" })).toHaveAttribute("href", "/areas/responsibilities/mine");
    expect(screen.getByRole("link", { name: "Open Account & appearance" })).toHaveAttribute("href", "/account/profile");
    expect(workspaceNavigation().getByRole("link", { name: "More" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: /Teacher view|Principal view|Parent view|Student view/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Teacher tools|Principal tools|Parent tools|Student tools/i)).not.toBeInTheDocument();
  });

  it("keeps ThatCampus AI persistent without turning it into a fifth destination", async () => {
    mockAuthenticatedSession({ proFeatures: true });
    renderApp("/areas");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Areas" })).toBeVisible());
    expect(workspaceNavigation().getAllByRole("link").map((link) => link.textContent)).toEqual(["Today", "Work", "Areas", "More"]);
    await waitFor(() => expect(apiFetchMock.mock.calls.some(([path]) => path === "/api/v1/auth/pro-features/")).toBe(true));
    expect(await workspaceNavigation().findByRole("button", { name: "Assistant" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Open Assistant" })).toHaveAttribute("href", "/areas/assistant");
  });

  it("fails closed for a relationship that the manifest did not grant", async () => {
    renderApp("/areas/attendance/records?scope=dependent&student_id=not-authorized");

    expect(await screen.findByRole("heading", { name: "Your workspace access changed" })).toBeVisible();
    expect(apiFetchMock.mock.calls.some(([path]) => String(path).startsWith("/api/v1/screens/parent/attendance/"))).toBe(false);
  });

  it("guards an absent capability surface before its domain API can load", async () => {
    const restrictedManifest = workspaceManifest();
    const restrictedAreas = restrictedManifest.areas.map((entry) => entry.key === "in-out"
      ? { ...entry, capabilities: ["gate.operate"], surfaces: entry.surfaces.filter((candidate) => candidate.key === "operate") }
      : entry);
    mockAuthenticatedSession({ manifest: { ...restrictedManifest, areas: restrictedAreas } });
    renderApp("/areas/in-out/manage");

    expect(await screen.findByRole("heading", { name: "Your workspace access changed" })).toBeVisible();
    expect(apiFetchMock.mock.calls.some(([path]) => /gate|visitor/i.test(String(path)) && path !== "/api/v1/workspace")).toBe(false);
  });

  it("mounts the canonical Events manager and opens its authorized creation form", async () => {
    const user = userEvent.setup();
    await import("./features/campus-events/EventsWorkspaceRoutes");
    renderApp("/areas/events/manage?view=draft");

    expect(await screen.findByRole("heading", { name: "Events & activities" })).toBeVisible();
    expect(await screen.findByRole("combobox", { name: "Filter events" })).toHaveValue("draft");
    expect(apiFetchMock.mock.calls.some(([path]) => String(path).startsWith("/api/v1/campus-events?"))).toBe(true);
    // Continue the same authorized route handshake instead of mounting the
    // entire app again for the form reached from this exact list.
    const create = await screen.findByRole("link", { name: "Create event" });
    expect(create).toHaveAttribute("href", "/areas/events/manage/new?list_view=draft");
    await user.click(create);

    expect(await screen.findByRole("heading", { name: "Create event", exact: true })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Event name" })).toBeVisible();
    expect(route()).toBe("/areas/events/manage/new?list_view=draft");
    expect(apiFetchMock.mock.calls.some(([path]) => path === "/api/v1/campus-events/catalog?school_id=school-1")).toBe(true);
    expect(apiFetchMock.mock.calls.some(([path, init]) => String(path).startsWith("/api/v1/campus-events") && (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("preserves query and hash state while converging a legacy bookmark", async () => {
    renderApp(`/parent/attendance?student_id=${studentId}&date=2026-10-18#summary`);

    await waitFor(() => expect(route()).toContain("/areas/attendance/records?"));
    const destination = new URL(route(), "https://thatcampus.test");
    expect(destination.pathname).toBe("/areas/attendance/records");
    expect(destination.searchParams.get("scope")).toBe("dependent");
    expect(destination.searchParams.get("student_id")).toBe(studentId);
    expect(destination.searchParams.get("date")).toBe("2026-10-18");
    expect(destination.hash).toBe("#summary");
    expect(await screen.findByRole("heading", { name: "Attendance calendar" })).toBeVisible();
    expect(screen.getByLabelText("Current attendance scope")).toHaveTextContent("Aarav Sharma");
    expect(apiFetchMock.mock.calls.some(([path]) => String(path).startsWith("/api/v1/screens/parent/attendance/"))).toBe(true);
  });

  it("maps a legacy administration selector to one canonical setup route", async () => {
    renderApp("/principal/administration?section=rules&rule=late-arrival");

    await waitFor(() => expect(route()).toBe("/more/setup/institution/operating-rules?rule=late-arrival"));
    expect(new URL(route(), "https://thatcampus.test").searchParams.has("section")).toBe(false);
  });
});

describe("authentication, capability and environment boundaries", () => {
  it("returns the signed-in root route to Today rather than choosing a portal", async () => {
    renderApp("/");

    await waitFor(() => expect(route()).toBe("/today"));
    expect(await screen.findByRole("heading", { name: "Today" })).toBeVisible();
  });

  it("sends an anonymous canonical deep link to sign in with an exact return path", async () => {
    mockAnonymousSession();
    renderApp("/areas/attendance/registers?date=2026-10-18");

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
    const destination = new URL(route(), "https://thatcampus.test");
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("next")).toBe("/areas/attendance/registers?date=2026-10-18");
    expect(apiFetchMock.mock.calls.some(([path]) => path === "/api/v1/workspace")).toBe(false);
  });

  it("keeps an unverified account outside campus data and preserves its requested route", async () => {
    mockAuthenticatedSession({ user: { ...defaultUser, email_verified: false } });
    renderApp("/areas/messages/conversations?conversation=secure-1");

    await waitFor(() => expect(new URL(route(), "https://thatcampus.test").pathname).toBe("/account/security"));
    const destination = new URL(route(), "https://thatcampus.test");
    expect(destination.searchParams.get("from")).toBe("/areas/messages/conversations?conversation=secure-1");
    expect(apiFetchMock.mock.calls.some(([path]) => path === "/api/v1/workspace")).toBe(false);
  });

  it("keeps an account without membership in progressive onboarding", async () => {
    mockAuthenticatedSession({ roles: [] });
    renderApp("/areas/attendance/registers");

    expect(await screen.findByRole("heading", { name: "What would you like to run?" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Attendance/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Gate entry & exit/ })).toBeEnabled();
    expect(apiFetchMock.mock.calls.some(([path]) => path === "/api/v1/workspace")).toBe(false);
  });

  it("renders the same Areas route from a server-confirmed Simulation environment", async () => {
    const virtualNow = "2026-10-19T09:15:00.000+05:30";
    const wireEnvironment = {
      mode: "simulation",
      namespace_id: "scenario:run-1",
      run_id: "run-1",
      scenario_id: "scenario-1",
      institution_id: schoolId,
      virtual_clock: { now: virtualNow, time_zone: "Asia/Kolkata" },
      source_snapshot_at: "2026-10-18T08:00:00.000Z",
      expires_at: "2099-10-20T08:00:00.000Z",
    };
    mockAuthenticatedSession({
      executionEnvironment: wireEnvironment,
      manifest: workspaceManifest({
        kind: "simulation",
        namespace_id: "scenario:run-1",
        virtual_now: virtualNow,
        expires_at: "2099-10-20T08:00:00.000Z",
      }),
    });
    const view = renderApp("/areas");

    expect(await screen.findByRole("complementary", { name: "Selected simulation" })).toHaveTextContent("Simulation time");
    expect(await screen.findByRole("link", { name: "Open Attendance" })).toHaveAttribute("href", "/areas/attendance");
    expect(screen.getByRole("heading", { name: "Areas" })).toBeVisible();
    expect(screen.queryByLabelText("Live campus environment")).not.toBeInTheDocument();
    expect(view.container.querySelector(".responsibility-workspace")).toHaveAttribute("data-execution-mode", "simulation");
  });

  it("never displays a Live manifest beneath a selected Simulation environment", async () => {
    const virtualNow = "2026-10-19T09:15:00.000+05:30";
    mockAuthenticatedSession({
      executionEnvironment: {
        mode: "simulation",
        namespace_id: "scenario:run-2",
        run_id: "run-2",
        institution_id: schoolId,
        virtual_clock: { now: virtualNow, time_zone: "Asia/Kolkata" },
        expires_at: "2099-10-20T08:00:00.000Z",
      },
      manifest: workspaceManifest(),
    });
    renderApp("/today");

    expect(await screen.findByRole("heading", { name: "We couldn’t load your workspace" })).toBeVisible();
    expect(screen.getByRole("complementary", { name: "Selected simulation" })).toBeVisible();
    expect(screen.queryByText("Mathematics · Class 7A")).not.toBeInTheDocument();
  });
});
