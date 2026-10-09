import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { OperationsShell } from "./pages/operations/OperationsShell";
import { ParentShell, type ParentRoute } from "./pages/parent/ParentShell";
import { StudentShell } from "./pages/student/StudentShell";
import { proFeaturesKey } from "./features/auth/useProFeatures";
import { demoParentChild } from "./pages/parent/parentDemoData";
import { schoolApiFixture } from "./test/schoolApiFixtures";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock("./lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/api")>();
  return { ...original, apiFetch: apiFetchMock };
});

const user = {
  id: "user-1",
  username: "aarav.student",
  email: "aarav@example.com",
  first_name: "Aarav",
  last_name: "Sharma",
  display_name: "Aarav Sharma",
  role: "student",
};

function mockSession(membershipRoles: Array<"guardian" | "student" | "staff"> = ["guardian", "student"]) {
  const staffPermissions=["attendance.view","attendance.record","photo.use","timetable.view","dayplans.respond","followups.manage","messages.view","messages.send","groups.create","safeguarding.review","events.view","events.manage","events.attendance","assessments.view","assessments.mark","assessments.moderate","reports.comment","departure.collect","ai.use"];
  apiFetchMock.mockImplementation((path: string) => {
    if (path === "/api/v1/auth/session/") {
      return Promise.resolve({ authenticated: true, user, csrf_token: "csrf", demo_mode: true });
    }
    if (path === "/api/v1/auth/me/") {
      return Promise.resolve({
        user,
        students: [],
        memberships: membershipRoles.map((role, index) => ({
          id: `membership-${index}`,
          school_id: "school-1",
          school_name: "Cambridge International School",
          role,
        })),
        school_permissions: membershipRoles.includes("staff") ? [{school_id:"school-1",permissions:staffPermissions,custom_role:{id:"teaching",name:"Teaching staff"}}] : [],
        demo_mode: true,
      });
    }
    if (path === "/api/v1/auth/pro-features/") return Promise.resolve({ enabled: false, preview: true });
    if (path === "/api/v1/onboarding/workspace/") {
      return Promise.resolve({ applications: [], coaching_workspaces: [] });
    }
    return Promise.resolve(schoolApiFixture(path));
  });
}

function mockCustomStaffSession(permissions: string[]) {
  const staffUser = { ...user, role: "staff" as const, username: "rashmi.attendant", display_name: "Rashmi Joshi" };
  apiFetchMock.mockImplementation((path: string) => {
    if (path === "/api/v1/auth/session/") {
      return Promise.resolve({ authenticated: true, user: staffUser, csrf_token: "csrf", demo_mode: true });
    }
    if (path === "/api/v1/auth/me/") {
      return Promise.resolve({
        user: staffUser,
        students: [],
        memberships: [{ id: "membership-1", school_id: "school-1", school_name: "Cambridge International School", role: "staff" }],
        school_permissions: [{ school_id: "school-1", permissions, custom_role: null }],
        demo_mode: true,
      });
    }
    return Promise.resolve(schoolApiFixture(path));
  });
}

beforeEach(() => {
  apiFetchMock.mockReset();
  mockSession();
});

afterEach(cleanup);

function useInstantCardTransitions() {
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
}

interface RouteSmokeCase {
  path: string;
  heading: string | RegExp;
}

const implementedScreenRoutes: RouteSmokeCase[] = [
  { path: "/parent/home", heading: "Today's activities" },
  { path: "/parent/attendance", heading: "Attendance calendar" },
  { path: "/parent/leave", heading: "Leave Application by Aarav" },
  { path: "/parent/diary", heading: /Wednesday, 16 Sep/ },
  { path: "/student", heading: "Aarav Sharma" },
  { path: "/student/attendance", heading: "Attendance" },
  { path: "/student/attendance/eligibility", heading: "Attendance eligibility" },
  { path: "/student/leave/new", heading: "Apply leave" },
  { path: "/student/leave", heading: "Leave" },
  { path: "/student/timetable", heading: "Timetable" },
  { path: "/student/timetable/week", heading: "Weekly timetable" },
];

describe("implemented application routes", () => {
  it.each(["teacher", "principal", "parent", "student"] as const)("hides only the bottom navigation in the %s full chat", portal => {
    const content = <span>Full conversation</span>;
    const shell = portal === "parent" ? <ParentShell active="chat" pageLabel="Chat">{content}</ParentShell>
      : portal === "student" ? <StudentShell activeNav="chat" pageTitle="Chat">{content}</StudentShell>
      : <OperationsShell portal={portal} active="chat" title="Chat">{content}</OperationsShell>;
    const client=new QueryClient();
    client.setQueryData(proFeaturesKey(),{enabled:true,preview:true});
    const { container } = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${portal}/assistant`]}>{shell}</MemoryRouter></QueryClientProvider>);
    expect(container.querySelector(".student-bottom-nav, .parent-bottom-nav, .operations-mobile-nav")).toBeNull();
    expect(screen.getByRole("heading", { name: "Chat" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Go back" })).toBeVisible();
    expect(container.querySelector(".assistant-dock")).toBeNull();
    if (portal === "teacher" || portal === "principal") expect(container.querySelector(".operations-sidebar")).toBeInTheDocument();
  });

  it("keeps a permission-scoped staff home available without loading the teaching-day API", async () => {
    mockCustomStaffSession(["departure.collect"]);
    const { container } = render(<MemoryRouter initialEntries={["/teacher"]}><App /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Today’s assigned work" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Transport journey/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /My work/ })).toBeVisible();
    expect(apiFetchMock.mock.calls.some(([path]) => String(path).startsWith("/api/v1/screens/teacher/home/"))).toBe(false);
    expect(container.querySelectorAll(".operations-mobile-nav a")).toHaveLength(2);
    expect(container.querySelector(".operations-mobile-nav")?.textContent).toBe("TodayMore");
  });

  it("hides and guards modules that current work assignments did not grant", async () => {
    mockCustomStaffSession(["departure.collect"]);
    render(<MemoryRouter initialEntries={["/teacher/more"]}><App /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "My work" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Transport journey/ })).toBeVisible();
    expect(screen.queryByText("Assessments & marking")).not.toBeInTheDocument();
    expect(screen.queryByText("Report remarks")).not.toBeInTheDocument();

    cleanup();
    mockCustomStaffSession(["departure.collect"]);
    render(<MemoryRouter initialEntries={["/teacher/assessments"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Today’s assigned work" })).toBeVisible();
    expect(apiFetchMock.mock.calls.some(([path]) => String(path).includes("/assessments/"))).toBe(false);
  });

  it("shows transport actions without requesting a teaching home for transport-only staff", async () => {
    mockCustomStaffSession(["departure.collect"]);
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    apiFetchMock.mockImplementation((endpoint: string) => endpoint === "/api/v1/departure/collector/"
      ? Promise.resolve({ trips: [{ assigned_collector_user_id: "user-1", service_date: "2099-01-01", state: "planned", collector_assignment_status: "pending" }],
        swaps: [{ target_user_id: "user-1", status: "submitted" }] })
      : original(endpoint));
    render(<MemoryRouter initialEntries={["/teacher/more"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "Open Transport journey, action needed" })).toBeVisible();
    expect(screen.queryByText("Assessments & marking")).not.toBeInTheDocument();
    expect(apiFetchMock.mock.calls.some(([path]) => String(path).startsWith("/api/v1/screens/teacher/home/"))).toBe(false);
  });

  it.each(implementedScreenRoutes)("renders $path for an authorized session", async ({ path, heading }) => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: heading }, { timeout: 5000 })).toBeVisible();
  }, 10000);

  it("renders the parent timetable alias", async () => {
    render(<MemoryRouter initialEntries={["/parent/timetable"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Timetable", exact: true })).toBeVisible();
  });

  it("uses the same school crest and name in parent, student, and teacher headers", async () => {
    for (const [path, roles] of [
      ["/parent/home", ["guardian"]],
      ["/student", ["student"]],
    ] as const) {
      cleanup();
      mockSession([...roles]);
      const { container } = render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
      await waitFor(() => expect(container.querySelector(".school-brand__crest")).toHaveTextContent("CIS"));
      expect(container.querySelector(".school-brand__name")).toHaveTextContent("Cambridge International School");
      expect(container.querySelector<HTMLImageElement>(".school-brand__eduvera img")?.src).toContain("/assets/edura-leaf-mark.png");
    }
    cleanup();
    const { container } = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OperationsShell portal="teacher" active="home" title="Today" subtitle="Your day"><span /></OperationsShell></MemoryRouter></QueryClientProvider>);
    expect(container.querySelectorAll(".school-brand__crest")).toHaveLength(2);
    container.querySelectorAll(".school-brand__crest").forEach((crest) => expect(crest).toHaveTextContent("CIS"));
    container.querySelectorAll(".school-brand__name").forEach((name) => expect(name).toHaveTextContent("Cambridge International School"));
    expect(container.querySelectorAll(".school-brand__eduvera img")).toHaveLength(2);
  });

  it("removes every assistant surface when Pro features are off", () => {
    const wrap = (content: ReactNode) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{content}</MemoryRouter></QueryClientProvider>);
    wrap(<StudentShell activeNav="home"><span /></StudentShell>);
    expect(document.querySelectorAll(".student-bottom-nav a")).toHaveLength(4);
    expect([...document.querySelector(".student-bottom-nav")!.children].map(item => item.textContent)).toEqual(["Home", "Attendance", "Timetable", "More"]);
    expect(screen.queryByRole("button",{name:"Chat"})).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "More tools" })).not.toBeInTheDocument();
    cleanup();
    wrap(<ParentShell active="home" pageLabel="Home"><span /></ParentShell>);
    expect(document.querySelectorAll(".parent-bottom-nav a")).toHaveLength(4);
    expect([...document.querySelector(".parent-bottom-nav")!.children].map(item => item.textContent)).toEqual(["Home", "Attendance", "Diary", "More"]);
    expect(screen.queryByRole("button",{name:"Chat"})).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "More tools" })).not.toBeInTheDocument();
    cleanup();
    for (const portal of ["teacher", "principal"] as const) {
      wrap(<OperationsShell portal={portal} active="home" title="Today" subtitle="School"><span /></OperationsShell>);
      expect(document.querySelectorAll(".operations-mobile-nav a")).toHaveLength(4);
      expect(document.querySelectorAll(".operations-mobile-nav > *")).toHaveLength(4);
      expect(screen.queryByRole("button",{name:"Chat"})).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "More tools" })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("restores the centre assistant destination when Pro features are on", () => {
    const client=new QueryClient();
    client.setQueryData(proFeaturesKey(),{enabled:true,preview:true});
    render(<QueryClientProvider client={client}><MemoryRouter><StudentShell activeNav="home"><span /></StudentShell></MemoryRouter></QueryClientProvider>);
    expect([...document.querySelector(".student-bottom-nav")!.children].map(item => item.textContent)).toEqual(["Home", "Attendance", "Chat", "Timetable", "More"]);
    expect(screen.getByRole("button",{name:"Chat"})).toBeVisible();
  });

  it("redirects direct assistant URLs without loading agent data when Pro features are off", async () => {
    render(<MemoryRouter initialEntries={["/student/assistant"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading",{name:"Aarav Sharma"})).toBeVisible();
    expect(screen.queryByRole("heading",{name:"Chat"})).not.toBeInTheDocument();
    expect(apiFetchMock.mock.calls.some(([path])=>String(path).startsWith("/api/v1/agent/"))).toBe(false);
  });

  it("keeps a consistent page title and only shows Back beyond each portal home", () => {
    const wrap = (entry: string, content: ReactNode) => render(
      <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[entry]}>{content}</MemoryRouter></QueryClientProvider>,
    );

    wrap("/parent/home", <ParentShell active="home" pageLabel="Home"><span /></ParentShell>);
    expect(screen.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Go back" })).not.toBeInTheDocument();
    cleanup();

    wrap("/parent/attendance", <ParentShell active="attendance" pageLabel="Attendance"><span /></ParentShell>);
    expect(screen.getByRole("heading", { name: "Attendance", level: 1 })).toBeVisible();
    expect(screen.getByRole("button", { name: "Go back" })).toBeVisible();
    cleanup();

    wrap("/student", <StudentShell activeNav="home"><span /></StudentShell>);
    expect(screen.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Go back" })).not.toBeInTheDocument();
    cleanup();

    wrap("/student/leave/new", <StudentShell activeNav="attendance"><span /></StudentShell>);
    expect(screen.getByRole("heading", { name: "Apply leave", level: 1 })).toBeVisible();
    expect(screen.getByRole("button", { name: "Go back" })).toBeVisible();
    cleanup();

    wrap("/principal", <OperationsShell portal="principal" active="home" title="Overview"><span /></OperationsShell>);
    expect(screen.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Go back" })).not.toBeInTheDocument();
    cleanup();

    wrap("/principal/timetable", <OperationsShell portal="principal" active="timetable" title="Timetable"><span /></OperationsShell>);
    expect(screen.getByRole("heading", { name: "Timetable", level: 1 })).toBeVisible();
    expect(screen.getByRole("button", { name: "Go back" })).toBeVisible();
  });

  it("opens Copilot from its visible navigation destination", async () => {
    const base=apiFetchMock.getMockImplementation() as (path:string)=>Promise<unknown>;
    apiFetchMock.mockImplementation((path:string):Promise<unknown>=>path==='/api/v1/auth/pro-features/'?Promise.resolve({enabled:true,preview:true}):base(path));
    render(<MemoryRouter initialEntries={["/student/copilot"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("dialog", { name: "Attendance Copilot" })).toBeVisible();
  });

  it("hides the direct Copilot route when Pro features are off", async () => {
    render(<MemoryRouter initialEntries={["/student/copilot"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Attendance", level: 1 })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Attendance Copilot" })).not.toBeInTheDocument();
  });

  it("renders a real launcher instead of silently changing portals", async () => {
    render(<MemoryRouter initialEntries={["/student/apps"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "More" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Attendance" })).toHaveAttribute("href", "/student/attendance");
  });

  it("keeps one established primary navigation destination selected on every event portal", async () => {
    for (const [path, roles, navLabel, pageHeading] of [
      ["/parent/events", ["guardian"], "More", "Events"],
      ["/student/events", ["student"], "More", "Events & activities"],
      ["/teacher/events", ["staff"], "More", "Assigned events"],
    ] as const) {
      cleanup();
      mockSession([...roles]);
      const original = apiFetchMock.getMockImplementation() as (endpoint: string) => Promise<unknown>;
      apiFetchMock.mockImplementation((endpoint: string) => endpoint.startsWith("/api/v1/campus-events?")
        ? Promise.resolve({ items: [], next_cursor: null })
        : original(endpoint));
      render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

      expect(await screen.findByRole("heading", { name: pageHeading })).toBeVisible();
      expect(screen.getAllByRole("link", { name: navLabel }).some((link) => link.getAttribute("aria-current") === "page" || link.classList.contains("is-active"))).toBe(true);
    }
  });

  it("loads the next event page from the server without changing the active tab", async () => {
    mockSession(["staff"]);
    const original = apiFetchMock.getMockImplementation() as (endpoint: string) => Promise<unknown>;
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/api/v1/campus-events?")) {
        return Promise.resolve(endpoint.includes("cursor=event-cursor-1")
          ? { items: [], next_cursor: null }
          : { items: [], next_cursor: "event-cursor-1" });
      }
      return original(endpoint);
    });
    render(<MemoryRouter initialEntries={["/teacher/events?view=draft"]}><App /></MemoryRouter>);

    expect(await screen.findByRole("combobox", { name: "Filter events" })).toHaveValue("draft");
    await userEvent.setup().click(screen.getByRole("button", { name: "Load more events" }));
    await waitFor(() => expect(apiFetchMock.mock.calls.some(([endpoint]) => String(endpoint).includes("cursor=event-cursor-1"))).toBe(true));
    expect(screen.getByRole("combobox", { name: "Filter events" })).toHaveValue("draft");
  });

  it("keeps student home distinct and routes Attendance from its navigation", async () => {
    // This route test checks click outcomes; pointer traversal is not part of this assertion.
    render(<MemoryRouter initialEntries={["/student"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Aarav Sharma" })).toBeVisible();
    expect(screen.queryByText("Overall Aggregate")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open digital student ID for Aarav Sharma" }));
    expect(screen.getByRole("dialog", { name: "Aarav Sharma" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close digital student ID" }));
    fireEvent.click(screen.getByRole("link", { name: "Attendance" }));
    expect(await screen.findByRole("region",{name:/Overall attendance/})).toBeVisible();
  }, 30000);

  it("opens the parent's student ID as a viewport modal with a visible close control", async () => {
    const interact = userEvent.setup();
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);
    await interact.click(await screen.findByRole("button", { name: /Open digital student ID for Aarav Sharma/ }));
    const dialog = screen.getByRole("dialog", { name: "Aarav Sharma" });
    expect(dialog).toBeVisible();
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass("student-id-view");
    expect(dialog).not.toHaveClass("student-id-view--parent");
    expect(within(dialog).getByText("Digital Student Identity")).toBeVisible();
    const close = within(dialog).getByRole("button", { name: "Close digital student ID" });
    expect(close).toBeVisible();
    await interact.click(close);
    expect(screen.queryByRole("dialog", { name: "Aarav Sharma" })).not.toBeInTheDocument();
  });

  it("shows one attendance follow-up module beside the prioritized action deck", async () => {
    const original = apiFetchMock.getMockImplementation() as (endpoint: string) => Promise<unknown>;
    apiFetchMock.mockImplementation((endpoint: string) => endpoint.startsWith("/api/v1/coordination/follow-ups?")
      ? Promise.resolve({
          results: [{
            id: "followup-1",
            student_id: "student-1",
            student_name: "Aarav Sharma",
            owner_name: "Kavita Mehta",
            attendance_date: "2026-09-16",
            question: "Please confirm the reason for today's absence.",
            due_at: "2026-09-17T12:00:00.000Z",
            overdue: false,
            state: "awaiting_response",
            revision: 1,
            outcome: null,
            updated_at: "2026-09-16T09:00:00.000Z",
            created_at: "2026-09-16T09:00:00.000Z",
          }],
          next_cursor: null,
        })
      : original(endpoint));

    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);

    expect(await screen.findByRole("link", { name: /Review and sign the leave request/ })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Attendance follow-ups" })).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "Attendance follow-ups" })).toHaveLength(1);
  });

  it("does not show the guardian attendance panel without an open follow-up", async () => {
    const original = apiFetchMock.getMockImplementation() as (endpoint: string) => Promise<unknown>;
    apiFetchMock.mockImplementation((endpoint: string) => endpoint.startsWith("/api/v1/coordination/follow-ups?")
      ? Promise.resolve({ results: [], next_cursor: null })
      : original(endpoint));

    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);

    await waitFor(() => expect(apiFetchMock.mock.calls.some(([endpoint]) => String(endpoint).startsWith("/api/v1/coordination/follow-ups?"))).toBe(true));
    expect(screen.queryByRole("heading", { name: "Attendance follow-ups" })).not.toBeInTheDocument();
    expect(screen.queryByText("No open attendance follow-ups")).not.toBeInTheDocument();
  });

  it("opens class standings from its explicit attendance option and restores focus on close", async () => {
    const interact = userEvent.setup();
    render(<MemoryRouter initialEntries={["/student/attendance"]}><App /></MemoryRouter>);
    const trigger=await screen.findByRole("button",{name:"Class attendance"});
    await interact.click(trigger);
    const dialog=screen.getByRole("dialog",{name:"Class 7A standings"});
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(4);
    expect(within(dialog).getByRole("listitem",{name:/You, Aarav Sharma/})).toHaveClass("attendance-ranking__row--current");
    await interact.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Class 7A standings" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await interact.click(trigger);
    expect(screen.getByRole("dialog", { name: "Class 7A standings" })).toBeVisible();
    await interact.click(screen.getByRole("button", { name: "Close attendance standings" }));
  }, 30000);

  it.each(["/parent/home", "/parent/attendance"])("opens the same highlighted class standings from %s", async (path) => {
    const interact = userEvent.setup();
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    await interact.click(await screen.findByRole("button", { name: path.endsWith("home") ? "View all class attendance" : /Overall Aggregate/ }));
    const dialog = screen.getByRole("dialog", { name: /standings/ });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(4);
    expect(within(dialog).getByRole("listitem", { name: /Your child, Aarav Sharma/ })).toHaveClass("attendance-ranking__row--current");
    expect(within(dialog).getByRole("list", { name: "All class attendance" })).toBeVisible();
  });

  it("opens attendance from the whole card and reviews pending and completed homework", async () => {
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);
    const attendance = await screen.findByRole("button", { name: "View all class attendance" });
    expect(attendance).toHaveClass("metric-card__hit-area");
    fireEvent.click(attendance);
    expect(screen.getByRole("dialog", { name: /standings/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close attendance standings" }));

    const homework = screen.getByRole("button", { name: "View homework details" });
    expect(homework).toHaveClass("metric-card__hit-area");
    fireEvent.click(homework);
    const dialog = screen.getByRole("dialog", { name: "Homework details" });
    expect(within(dialog).getByRole("tab", { name: "Pending (1)" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByText("Algebra practice")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Completed (11)" }));
    expect(within(dialog).getByText("Homework assignment 2")).toBeVisible();
    expect(within(dialog).queryByText("Algebra practice")).not.toBeInTheDocument();
  });

  it("opens all class attendance by tapping the score in the parent Attendance tab", async () => {
    const interact = userEvent.setup();
    render(<MemoryRouter initialEntries={["/parent/attendance"]}><App /></MemoryRouter>);
    const score = await screen.findByRole("button", { name: "View all class attendance from the attendance score" });
    expect(score).toHaveTextContent("95.0%");
    await interact.click(score);
    const dialog = screen.getByRole("dialog", { name: /standings/ });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(4);
    expect(within(dialog).getByRole("listitem", { name: /Your child, Aarav Sharma/ })).toHaveClass("attendance-ranking__row--current");
  });

  it("shows live attendance rank and trends alongside pending and historical homework", async () => {
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);
    const attendance = within((await screen.findByRole("button", { name: "View all class attendance" })).closest("article")!);
    const risingTrend = attendance.getByText("+5%");
    expect(risingTrend.closest(".metric-card__value-row")).toContainElement(attendance.getByText("95.0%"));
    expect(risingTrend.querySelector("svg.lucide-trending-up")).toBeInTheDocument();
    expect(attendance.getByText("Class rank #4 of 32")).toBeVisible();
    const homework = within(screen.getByText("Homework", { selector: ".metric-card__header span" }).closest("article")!);
    expect(homework.getByText("1/12")).toBeVisible();
    expect(homework.getByText("1 pending")).toBeVisible();
    expect(homework.getByText("12 assigned this term")).toBeVisible();
    const homeworkTrend = homework.getByText("-25%");
    expect(homeworkTrend.closest(".metric-card__value-row")).toContainElement(homework.getByText("1/12"));
    expect(homeworkTrend.querySelector("svg.lucide-trending-down")).toBeInTheDocument();
    expect(homework.getByText("last 30d vs prior 30d")).toBeVisible();
  });

  it("formats homework as pending over all assignments in the term", async () => {
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/screens/parent/home/")) {
        const response = schoolApiFixture(path) as { semester_metrics: Record<string, unknown> };
        return Promise.resolve({ ...response, semester_metrics: {
          ...response.semester_metrics,
          homework_due: 6,
          homework_total: 41,
        } });
      }
      return original(path);
    });
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);
    const homework = within((await screen.findByText("Homework", { selector: ".metric-card__header span" })).closest("article")!);
    expect(homework.getByText("6/41")).toBeVisible();
    expect(homework.getByText("6 pending")).toBeVisible();
    expect(homework.getByText("41 assigned this term")).toBeVisible();
  });

  it("handles declining attendance and new homework without inventing a rank or percentage baseline", async () => {
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/screens/parent/home/")) {
        const response = schoolApiFixture(path) as { semester_metrics: Record<string, unknown> };
        return Promise.resolve({ ...response, semester_metrics: {
          ...response.semester_metrics,
          attendance_trend_percent: -6,
          attendance_rank: null,
          attendance_cohort_size: null,
          homework_recent: 3,
          homework_previous: 0,
        } });
      }
      return original(path);
    });
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);
    const attendance = within((await screen.findByRole("button", { name: "View all class attendance" })).closest("article")!);
    const fallingTrend = attendance.getByText("-6%");
    expect(fallingTrend.closest(".metric-card__value-row")).toContainElement(attendance.getByText("95.0%"));
    expect(fallingTrend.querySelector("svg.lucide-trending-down")).toBeInTheDocument();
    expect(fallingTrend.querySelector("svg.lucide-trending-up")).not.toBeInTheDocument();
    expect(attendance.getByText("Class rank not published")).toBeVisible();
    const homework = within(screen.getByText("Homework", { selector: ".metric-card__header span" }).closest("article")!);
    const homeworkTrend = homework.getByText("+3 new");
    expect(homeworkTrend.closest(".metric-card__value-row")).toContainElement(homework.getByText("1/12"));
    expect(homeworkTrend.querySelector("svg.lucide-trending-up")).toBeInTheDocument();
  });

  it("switches the parent ID card across all accessible children and keeps missing gate evidence unconfirmed", async () => {
    useInstantCardTransitions();
    const interact = userEvent.setup();
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    const first = (schoolApiFixture("/api/v1/students/") as { results: Array<{ id: string; user: { display_name: string }; admission_number: string }> }).results[0]!;
    const second = { ...first, id: "student-2", admission_number: "CIS-002", user: { ...first.user, display_name: "Ananya Sharma" } };
    const third = { ...first, id: "student-3", admission_number: "CIS-003", user: { ...first.user, display_name: "Rohan Sharma" } };
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/students/") return Promise.resolve({ results: [first, second, third] });
      if (path.startsWith("/api/v1/screens/parent/home/")) {
        const selected = path.includes("student-2") ? second : path.includes("student-3") ? third : first;
        return Promise.resolve({ ...(schoolApiFixture(path) as object), student: selected, siblings: [second, third], campus_presence: null });
      }
      return original(path);
    });
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);
    expect((await screen.findAllByText("Not confirmed"))[0]).toBeVisible();
    expect(document.querySelector(".child-switcher")).not.toBeInTheDocument();
    expect(screen.getAllByText("Not confirmed")[0]).toHaveClass("status-pill--neutral");
    expect(document.querySelector(".child-status-card")).not.toBeInTheDocument();
    const chooseChild = await screen.findByRole("button", { name: "Choose child profile" });
    await waitFor(() => expect(document.querySelector(".parent-id-stack.has-three-or-more")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Aarav Sharma - Class/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Switch to Ananya/ })).not.toBeInTheDocument();
    fireEvent.click(chooseChild);
    expect(screen.getByRole("dialog", { name: "Select child profile" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View Ananya Sharma's parent dashboard" }));
    // Wait on the cheap, observable busy state before a role/visibility query.
    // A whole-page findByRole repeatedly traverses both cards during the
    // transition and can starve its timer on slower shared CI runners.
    await waitFor(() => expect(chooseChild).toBeEnabled(), { timeout: 5000 });
    const activeCard = () => within(document.querySelector<HTMLElement>(".parent-id-stack__active")!);
    expect(activeCard().getByRole("button", { name: /Open digital student ID for Ananya Sharma/ })).toBeVisible();
    fireEvent.click(chooseChild);
    fireEvent.click(screen.getByRole("button", { name: "View Rohan Sharma's parent dashboard" }));
    await waitFor(() => expect(chooseChild).toBeEnabled(), { timeout: 5000 });
    const rohanCard = activeCard().getByRole("button", { name: /Open digital student ID for Rohan Sharma/ });
    expect(rohanCard).toBeVisible();
    fireEvent.touchStart(rohanCard, { touches: [{ clientX: 80 }] });
    fireEvent.touchEnd(rohanCard, { changedTouches: [{ clientX: 220 }] });
    await waitFor(() => expect(chooseChild).toBeEnabled(), { timeout: 5000 });
    const ananyaCard = activeCard().getByRole("button", { name: /Open digital student ID for Ananya Sharma/ });
    expect(ananyaCard).toBeVisible();
    fireEvent.touchStart(ananyaCard, { touches: [{ clientX: 220 }] });
    fireEvent.touchEnd(ananyaCard, { changedTouches: [{ clientX: 80 }] });
    await waitFor(() => expect(chooseChild).toBeEnabled(), { timeout: 5000 });
    await interact.click(activeCard().getByRole("button", { name: /Open digital student ID for Rohan Sharma/ }));
    expect(screen.getByRole("dialog", { name: "Rohan Sharma" })).toHaveTextContent("CIS-003");
  }, 45000);

  it("switches directly between two child profiles without opening a menu", async () => {
    useInstantCardTransitions();
    const interact = userEvent.setup();
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    const first = (schoolApiFixture("/api/v1/students/") as { results: Array<{ id: string; user: { display_name: string }; admission_number: string }> }).results[0]!;
    const second = { ...first, id: "student-2", admission_number: "CIS-002", user: { ...first.user, display_name: "Ananya Sharma" } };
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/students/") return Promise.resolve({ results: [first, second] });
      if (path.startsWith("/api/v1/screens/parent/home/")) {
        const selected = path.includes("student-2") ? second : first;
        return Promise.resolve({ ...(schoolApiFixture(path) as object), student: selected, siblings: [selected === first ? second : first] });
      }
      return original(path);
    });
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);
    const toggle = await screen.findByRole("button", { name: "Switch to other child" });
    await waitFor(() => expect(toggle).toBeEnabled());
    await interact.click(toggle);
    expect(screen.queryByRole("dialog", { name: "Select child profile" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Open digital student ID for Ananya Sharma/ }, { timeout: 5000 })).toBeVisible();
    await waitFor(() => expect(toggle).toBeEnabled(), { timeout: 5000 });
    expect(screen.queryByText("Syncing school records...")).not.toBeInTheDocument();
    await interact.click(toggle);
    expect(await screen.findByRole("button", { name: /Open digital student ID for Aarav Sharma/ }, { timeout: 5000 })).toBeVisible();
    expect(screen.queryByText("Syncing school records...")).not.toBeInTheDocument();
  // Two complete home renders and multiple bounded 5s waits need more than a
  // 12s aggregate on shared CI runners; assertions and per-wait limits remain.
  }, 30000);

  it("uses the avatar child switcher across parent pages instead of page-level dropdowns", async () => {
    const interact = userEvent.setup();
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    const first = (schoolApiFixture("/api/v1/students/") as { results: Array<{ id: string; user: { display_name: string }; admission_number: string }> }).results[0]!;
    const second = { ...first, id: "student-2", admission_number: "CIS-002", user: { ...first.user, display_name: "Ananya Sharma" } };
    const third = { ...first, id: "student-3", admission_number: "CIS-003", user: { ...first.user, display_name: "Rohan Sharma" } };
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/students/") return Promise.resolve({ results: [first, second, third] });
      if (path.startsWith("/api/v1/screens/parent/attendance/")) {
        const selected = path.includes("student-2") ? second : path.includes("student-3") ? third : first;
        return Promise.resolve({ ...(schoolApiFixture(path) as object), student: selected });
      }
      return original(path);
    });

    render(<MemoryRouter initialEntries={["/parent/attendance"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Attendance calendar" })).toBeVisible();
    expect(document.querySelector(".child-switcher")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aarav Sharma - Class/ })).not.toBeInTheDocument();
    const chooseChild = await screen.findByRole("button", { name: "Choose child profile" });
    await interact.click(chooseChild);
    expect(screen.getByRole("dialog", { name: "Select child profile" })).toBeVisible();
    await interact.click(screen.getByRole("button", { name: "View Ananya Sharma's parent dashboard" }));
    expect(await screen.findByText("Ananya Sharma · Class 7A")).toBeVisible();
  }, 15000);

  it.each(["attendance", "leave", "diary", "timetable"] as ParentRoute[])("keeps the child profile switch in the header on %s", async (active) => {
    const switchChild = vi.fn();
    const childOptions = [demoParentChild, { ...demoParentChild, id: "student-2", name: "Ananya Sharma" }];
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    apiFetchMock.mockImplementation((endpoint: string) => endpoint === "/api/v1/students/"
      ? Promise.resolve({ results: childOptions.map((option) => ({ id: option.id, user: { display_name: option.name }, current_enrollment: { grade: "7", section: "A" }, avatar_url: option.avatarUrl })) })
      : original(endpoint));
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/parent/${active}`]}>
      <ParentShell active={active} pageLabel={active} child={demoParentChild} childOptions={childOptions} onSelectChild={switchChild}><span>Page content</span></ParentShell>
    </MemoryRouter></QueryClientProvider>);
    const toggle = screen.getByRole("button", { name: "Switch to other child" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle.closest(".parent-header__actions")).toBeInTheDocument();
    expect(document.querySelector(".child-switcher")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Parent portal navigation" })).toContainElement(screen.getByRole("link", { name: "Home" }));
    fireEvent.click(toggle);
    expect(screen.queryByRole("dialog", { name: "Select child profile" })).not.toBeInTheDocument();
    expect(switchChild).toHaveBeenCalledWith("student-2");
  });

  it("uses a stable portal accent for the active child", async () => {
    const childOptions = [demoParentChild, { ...demoParentChild, id: "student-2", name: "Ananya Sharma" }];
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    apiFetchMock.mockImplementation((endpoint: string) => endpoint === "/api/v1/students/"
      ? Promise.resolve({ results: childOptions.map((option) => ({ id: option.id, user: { display_name: option.name }, current_enrollment: { grade: "7", section: "A" }, avatar_url: option.avatarUrl })) })
      : original(endpoint));
    const view=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/parent/attendance?student_id=student-2"]}>
      <ParentShell active="attendance" pageLabel="Attendance" child={childOptions[1]} childOptions={childOptions} selectedChildId="student-2"><span>Page content</span></ParentShell>
    </MemoryRouter></QueryClientProvider>);
    await waitFor(()=>expect(view.container.querySelector(".parent-app")).toHaveAttribute("data-child-accent","violet"));
    const parentApp=view.container.querySelector<HTMLElement>(".parent-app")!;
    expect(parentApp.style.getPropertyValue("--parent-primary")).toBe("#5b279b");
    expect(parentApp.style.getPropertyValue("--edura-feature-gradient")).toContain("#7436bd");
    expect(parentApp.style.getPropertyValue("--parent-stack-secondary-gradient")).toContain("#2969e7");
    const profileColors=Array.from(view.container.querySelectorAll<HTMLElement>(".parent-child-profiles__layer")).map((layer)=>layer.style.getPropertyValue("--profile-accent"));
    expect(profileColors).toEqual(["#7436bd","#1d4ed8"]);
  });

  it("keeps the selected child on More and in child-specific tool links",async()=>{
    const childOptions=[demoParentChild,{...demoParentChild,id:"student-2",name:"Ananya Sharma"}];
    const original=apiFetchMock.getMockImplementation() as (path:string)=>Promise<unknown>;
    apiFetchMock.mockImplementation((endpoint:string)=>endpoint==="/api/v1/students/"
      ? Promise.resolve({results:childOptions.map((option)=>({id:option.id,user:{display_name:option.name},current_enrollment:{grade:"7",section:"A"},avatar_url:option.avatarUrl}))})
      : original(endpoint));
    const view=render(<MemoryRouter initialEntries={["/parent/more?student_id=student-2"]}><App/></MemoryRouter>);
    expect(await screen.findByRole("heading",{name:"More",level:1})).toBeVisible();
    await waitFor(()=>expect(view.container.querySelector(".parent-app")).toHaveAttribute("data-child-accent","violet"));
    expect(screen.getByRole("link",{name:"Open Results"})).toHaveAttribute("href","/parent/results?student_id=student-2");
  });

  it("shows only actionable More badges and remembers the list layout", async () => {
    window.localStorage.removeItem("omnischool:more-layout:user-1");
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    apiFetchMock.mockImplementation(async (endpoint: string) => {
      const result = await original(endpoint);
      if (endpoint.startsWith("/api/v1/screens/parent/home/")) {
        return { ...(result as object), unread_notifications: 97, more_attention: { events: 3, diary: 1 } };
      }
      return result;
    });
    const view = render(<MemoryRouter initialEntries={["/parent/more"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "Open Events & activities, action needed" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Diary, action needed" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Messages" })).toBeVisible();
    expect(view.container.querySelector(".more-grid--list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(view.container.querySelector(".more-grid--grid")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(view.container.querySelector(".more-grid--list")).toBeInTheDocument();
    expect(window.localStorage.getItem("omnischool:more-layout:user-1")).toBe("list");
    window.localStorage.removeItem("omnischool:more-layout:user-1");
  });

  it("shows a child picker on the Attendance page when there are more than two children", async () => {
    const switchChild = vi.fn();
    const childOptions = [demoParentChild, { ...demoParentChild, id: "student-2", name: "Ananya Sharma" }, { ...demoParentChild, id: "student-3", name: "Rohan Sharma" }];
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    apiFetchMock.mockImplementation((endpoint: string) => endpoint === "/api/v1/students/"
      ? Promise.resolve({ results: childOptions.map((option) => ({ id: option.id, user: { display_name: option.name }, current_enrollment: { grade: "7", section: "A" }, avatar_url: option.avatarUrl })) })
      : original(endpoint));
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/parent/attendance"]}>
      <ParentShell active="attendance" pageLabel="Attendance" child={demoParentChild} childOptions={childOptions} onSelectChild={switchChild}><span>Page content</span></ParentShell>
    </MemoryRouter></QueryClientProvider>);
    const picker = await screen.findByRole("button", { name: "Choose child profile" });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.click(picker);
    const dialog = screen.getByRole("dialog", { name: "Select child profile" });
    fireEvent.click(within(dialog).getByRole("button", { name: "View Rohan Sharma's parent dashboard" }));
    expect(switchChild).toHaveBeenCalledWith("student-3");
  });

  it("keeps the parent dashboard visible when the selected child's record is still loading", async () => {
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    const first = (schoolApiFixture("/api/v1/students/") as { results: Array<{ id: string; user: { display_name: string }; admission_number: string }> }).results[0]!;
    const second = { ...first, id: "student-2", admission_number: "CIS-002", user: { ...first.user, display_name: "Ananya Sharma" } };
    let secondFetchRequested = false;
    let finishSecondFetch: (response: unknown) => void = () => {};
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/students/") return Promise.resolve({ results: [first, second] });
      if (path.startsWith("/api/v1/screens/parent/home/")) {
        const selected = path.includes("student-2") ? second : first;
        const response = { ...(schoolApiFixture(path) as object), student: selected, siblings: [selected === first ? second : first] };
        if (selected === second) return new Promise((resolve) => { secondFetchRequested = true; finishSecondFetch = resolve; });
        return Promise.resolve(response);
      }
      return original(path);
    });
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /><Link to="/parent/home?student_id=student-2">Select next child</Link></MemoryRouter>);
    expect(await screen.findByRole("button", { name: /Open digital student ID for Aarav Sharma/ })).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Select next child" }));
    await waitFor(() => expect(secondFetchRequested).toBe(true));
    expect(screen.queryByText("Syncing school records...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open digital student ID for Aarav Sharma/ })).toBeVisible();
    finishSecondFetch({ ...(schoolApiFixture("/api/v1/screens/parent/home/?student_id=student-2") as object), student: second, siblings: [first] });
    expect(await screen.findByRole("button", { name: /Open digital student ID for Ananya Sharma/ })).toBeVisible();
  }, 30000);

  it("cycles a four-child card deck in both directions, including wraparound", async () => {
    useInstantCardTransitions();
    const original = apiFetchMock.getMockImplementation() as (path: string) => Promise<unknown>;
    const first = (schoolApiFixture("/api/v1/students/") as { results: Array<{ id: string; user: { display_name: string }; admission_number: string }> }).results[0]!;
    const children = [
      first,
      ...(["Ananya", "Rohan", "Kavya"] as const).map((name, index) => ({
        ...first,
        id: `student-${index + 2}`,
        admission_number: `CIS-00${index + 2}`,
        user: { ...first.user, display_name: `${name} Sharma` },
      })),
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/students/") return Promise.resolve({ results: children });
      if (path.startsWith("/api/v1/screens/parent/home/")) {
        const selected = children.find((child) => path.includes(child.id)) ?? first;
        return Promise.resolve({ ...(schoolApiFixture(path) as object), student: selected, siblings: children.filter((child) => child.id !== selected.id) });
      }
      return original(path);
    });
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);

    const swipe = async (from: string, to: string, direction: "left" | "right") => {
      const activeCard = () => within(document.querySelector<HTMLElement>(".parent-id-stack__active")!);
      const card = activeCard().getByRole("button", { name: new RegExp(`^Open digital student ID for ${from} Sharma`) });
      await waitFor(() => expect(card).toBeEnabled());
      const startX = direction === "right" ? 80 : 220;
      const endX = direction === "right" ? 220 : 80;
      fireEvent.touchStart(card, { touches: [{ clientX: startX, clientY: 100 }] });
      fireEvent.touchEnd(card, { changedTouches: [{ clientX: endX, clientY: 100 }] });
      // The card can show the prepared child before the route's cached query has
      // committed. A second swipe is valid only once that switch has settled.
      // Poll the captured control, not a whole-page role query that repeatedly
      // computes styles for both transition cards and can starve the timer.
      await waitFor(() => expect(chooser).toBeEnabled(), { timeout: 10_000 });
      expect(document.querySelector(".parent-id-stack.is-animating")).not.toBeInTheDocument();
      expect(activeCard().getByRole("button", { name: new RegExp(`^Open digital student ID for ${to} Sharma`) })).toBeVisible();
    };

    expect(await screen.findByRole("button", { name: /^Open digital student ID for Aarav Sharma/ })).toBeVisible();
    await waitFor(() => expect(document.querySelector(".parent-id-stack.has-three-or-more")).toBeInTheDocument());
    const chooser = screen.getByRole("button", { name: "Choose child profile" });
    fireEvent.click(chooser);
    expect(screen.getByRole("dialog", { name: "Select child profile" }).querySelectorAll("button")).toHaveLength(4);
    fireEvent.click(chooser);
    await swipe("Aarav", "Kavya", "right");
    await swipe("Kavya", "Rohan", "right");
    await swipe("Rohan", "Ananya", "right");
    await swipe("Ananya", "Aarav", "right");
    await swipe("Aarav", "Ananya", "left");
    await swipe("Ananya", "Rohan", "left");
    await swipe("Rohan", "Kavya", "left");
    await swipe("Kavya", "Aarav", "left");
  }, 90000);

  it("renders the timetable with the shared day view switcher", async () => {
    render(<MemoryRouter initialEntries={["/student/timetable?date=2026-10-07"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Period schedule" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Timetable" })).toHaveAttribute("href", "/student/timetable");
    expect(screen.getByRole("combobox", { name: "Timetable view" })).toHaveValue("day");
    expect(screen.queryByRole("option", { name: "Week" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Month" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Year" })).toBeInTheDocument();
  });

  it.each(["student", "parent"])("keeps %s timetable dates in Month and hides daily content in Year", async (portal) => {
    render(<MemoryRouter initialEntries={[`/${portal}/timetable?date=2026-10-07&view=month`]}><App /></MemoryRouter>);
    const picker = await screen.findByRole("combobox", { name: "Timetable view" });
    expect(picker).toHaveValue("month");
    fireEvent.click(screen.getByRole("button", { name: /^Thursday, 8 October.*$/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Thursday, 8 October.*$/ })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("combobox", { name: "Timetable view" })).toHaveValue("month");
    fireEvent.change(screen.getByRole("combobox", { name: "Timetable view" }), { target: { value: "year" } });
    await waitFor(() => expect(document.querySelector(".timetable-year")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Period schedule" })).not.toBeInTheDocument();
    expect(screen.queryByText("No timetable published")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save bell reminder preference" })).not.toBeInTheDocument();
    expect(document.querySelector(".timetable-kit-card")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^November,.*open month view$/ }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Timetable view" })).toHaveValue("month"));
    expect(screen.getByRole("button", { name: /^Sunday, 1 November.*$/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("authentication and route authorization", () => {
  it.each(["/parent/attendance","/principal/insights"])("sends an anonymous visitor at %s to sign in", async (path) => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/session/") {
        return Promise.resolve({ authenticated: false, user: null, csrf_token: "csrf", demo_mode: true });
      }
      return Promise.reject(new Error("Unexpected request"));
    });
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Sign in to your school" })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Sign in$/i })).toBeVisible();
    for (const name of [/Parent view/i, /Student view/i, /Teacher view/i, /Principal view/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("redirects a student away from parent-only records", async () => {
    mockSession(["student"]);
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Aarav Sharma" })).toBeVisible();
    expect(screen.getByText("Today's presence")).toBeVisible();
  });
  it("redirects students away from principal insights without fetching school aggregates", async () => {
    mockSession(["student"]);
    render(<MemoryRouter initialEntries={["/principal/insights"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Aarav Sharma" })).toBeVisible();
    expect(apiFetchMock.mock.calls.some(([path])=>String(path).includes("principal-insights"))).toBe(false);
  });

  it("holds a newly registered account outside tenant data until membership exists", async () => {
    mockSession([]);
    render(<MemoryRouter initialEntries={["/student/attendance"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Create a workspace" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Start institution application/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Create coaching workspace/i })).toBeVisible();
  });
});
