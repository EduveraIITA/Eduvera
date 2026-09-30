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
  { path: "/parent/home", heading: "Academic Pulse" },
  { path: "/parent/attendance", heading: "Today's Presence Pulse" },
  { path: "/parent/leave", heading: "Leave Application by Aarav" },
  { path: "/parent/diary", heading: /Wednesday, 16 Sep/ },
  { path: "/student", heading: "Aarav Sharma" },
  { path: "/student/attendance", heading: /Aarav Sharma/ },
  { path: "/student/attendance/eligibility", heading: /Hey Aarav!/ },
  { path: "/student/leave/new", heading: "Apply Leave" },
  { path: "/student/leave", heading: "Leave Tracker" },
  { path: "/student/timetable", heading: "Class 7A Timetable" },
  { path: "/student/timetable/week", heading: "My Timetable" },
];

describe("implemented application routes", () => {
  it.each(implementedScreenRoutes)("renders $path for an authorized session", async ({ path, heading }) => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: heading }, { timeout: 5000 })).toBeVisible();
  }, 10000);

  it("renders the parent timetable alias", async () => {
    render(<MemoryRouter initialEntries={["/parent/timetable"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Class 7A Timetable" })).toBeVisible();
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
    }
    cleanup();
    const { container } = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OperationsShell portal="teacher" active="home" title="Today" subtitle="Your day"><span /></OperationsShell></MemoryRouter></QueryClientProvider>);
    expect(container.querySelectorAll(".school-brand__crest")).toHaveLength(2);
    container.querySelectorAll(".school-brand__crest").forEach((crest) => expect(crest).toHaveTextContent("CIS"));
    container.querySelectorAll(".school-brand__name").forEach((name) => expect(name).toHaveTextContent("Cambridge International School"));
  });

  it("keeps mobile navigation to four destinations and no duplicate header More shortcut", () => {
    const wrap = (content: ReactNode) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{content}</MemoryRouter></QueryClientProvider>);
    wrap(<StudentShell activeNav="home"><span /></StudentShell>);
    expect(document.querySelectorAll(".student-bottom-nav a")).toHaveLength(4);
    expect(screen.queryByRole("link", { name: "More tools" })).not.toBeInTheDocument();
    cleanup();
    wrap(<ParentShell active="home" pageLabel="Home"><span /></ParentShell>);
    expect(document.querySelectorAll(".parent-bottom-nav a")).toHaveLength(4);
    expect(screen.queryByRole("link", { name: "More tools" })).not.toBeInTheDocument();
    cleanup();
    for (const portal of ["teacher", "principal"] as const) {
      wrap(<OperationsShell portal={portal} active="home" title="Today" subtitle="School"><span /></OperationsShell>);
      expect(document.querySelectorAll(".operations-mobile-nav a")).toHaveLength(4);
      expect(screen.queryByRole("link", { name: "More tools" })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("opens Copilot from its visible navigation destination", async () => {
    render(<MemoryRouter initialEntries={["/student/copilot"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("dialog", { name: "Attendance Copilot" })).toBeVisible();
  });

  it("renders a real launcher instead of silently changing portals", async () => {
    render(<MemoryRouter initialEntries={["/student/apps"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Everything for school, in one place" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Attendance" })).toBeVisible();
  });

  it("keeps one established primary navigation destination selected on every event portal", async () => {
    for (const [path, roles, navLabel, pageHeading] of [
      ["/parent/events", ["guardian"], "More", "Events & activities"],
      ["/student/events", ["student"], "More", "Events & activities"],
      ["/teacher/events", ["staff"], "More", "Your upcoming school activities"],
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

    expect(await screen.findByRole("tab", { name: "Drafts 0" })).toHaveAttribute("aria-selected", "true");
    await userEvent.setup().click(screen.getByRole("button", { name: "Load more events" }));
    await waitFor(() => expect(apiFetchMock.mock.calls.some(([endpoint]) => String(endpoint).includes("cursor=event-cursor-1"))).toBe(true));
    expect(screen.getByRole("tab", { name: "Drafts 0" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps student home distinct and routes Attendance from its navigation", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/student"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Aarav Sharma" })).toBeVisible();
    expect(screen.queryByText("Overall Aggregate")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open digital student ID for Aarav Sharma" }));
    expect(screen.getByRole("dialog", { name: "Aarav Sharma" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close digital student ID" }));
    await user.click(screen.getByRole("link", { name: "Attendance" }));
    expect(await screen.findByText("Overall Aggregate")).toBeVisible();
  }, 12000);

  it("opens the parent's full student ID above the card deck with a visible close control", async () => {
    const interact = userEvent.setup();
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);
    await interact.click(await screen.findByRole("button", { name: /Open digital student ID for Aarav Sharma/ }));
    const dialog = screen.getByRole("dialog", { name: "Aarav Sharma" });
    expect(dialog).toBeVisible();
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass("student-id-view--parent");
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

  it("opens the full attendance standings from each top student and the student's own row", async () => {
    const interact = userEvent.setup();
    render(<MemoryRouter initialEntries={["/student/attendance"]}><App /></MemoryRouter>);
    for (const rank of [1, 2, 3]) {
      await interact.click(await screen.findByRole("button", { name: `View all class attendance, starting at rank ${rank}` }));
      const dialog = screen.getByRole("dialog", { name: "Class 7A standings" });
      expect(within(dialog).getAllByRole("listitem")).toHaveLength(4);
      expect(within(dialog).getByRole("listitem", { name: /You, Aarav Sharma/ })).toHaveClass("attendance-ranking__row--current");
      await interact.click(within(dialog).getByRole("button", { name: "Close attendance standings" }));
    }
    const ownStanding = screen.getByRole("button", { name: "View all class attendance, starting at your standing" });
    await interact.click(ownStanding);
    expect(screen.getByRole("dialog", { name: "Class 7A standings" })).toBeVisible();
    await interact.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Class 7A standings" })).not.toBeInTheDocument();
    expect(ownStanding).toHaveFocus();
    await interact.click(screen.getByRole("button", { name: /Top Attendees - Class 7A/ }));
    expect(screen.getByRole("dialog", { name: "Class 7A standings" })).toBeVisible();
    await interact.click(screen.getByRole("button", { name: "Close attendance standings" }));
    await interact.click(screen.getByRole("button", { name: "View all class attendance from your percentage" }));
    expect(screen.getByRole("dialog", { name: "Class 7A standings" })).toBeVisible();
  }, 15000);

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
    expect(await screen.findByRole("button", { name: /Open digital student ID for Ananya Sharma/ }, { timeout: 5000 })).toBeVisible();
    await waitFor(() => expect(chooseChild).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(chooseChild);
    fireEvent.click(screen.getByRole("button", { name: "View Rohan Sharma's parent dashboard" }));
    expect(await screen.findByRole("button", { name: /Open digital student ID for Rohan Sharma/ }, { timeout: 5000 })).toBeVisible();
    await waitFor(() => expect(chooseChild).toBeEnabled(), { timeout: 5000 });
    const rohanCard = screen.getByRole("button", { name: /Open digital student ID for Rohan Sharma/ });
    fireEvent.touchStart(rohanCard, { touches: [{ clientX: 80 }] });
    fireEvent.touchEnd(rohanCard, { changedTouches: [{ clientX: 220 }] });
    expect(await screen.findByRole("button", { name: /Open digital student ID for Ananya Sharma/ }, { timeout: 5000 })).toBeVisible();
    await waitFor(() => expect(chooseChild).toBeEnabled(), { timeout: 5000 });
    const ananyaCard = screen.getByRole("button", { name: /Open digital student ID for Ananya Sharma/ });
    fireEvent.touchStart(ananyaCard, { touches: [{ clientX: 220 }] });
    fireEvent.touchEnd(ananyaCard, { changedTouches: [{ clientX: 80 }] });
    await interact.click(await screen.findByRole("button", { name: /Open digital student ID for Rohan Sharma/ }, { timeout: 5000 }));
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
  }, 12000);

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
    expect(await screen.findByRole("heading", { name: "Today's Presence Pulse" })).toBeVisible();
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
    const interact = userEvent.setup();
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
    await interact.click(screen.getByRole("link", { name: "Select next child" }));
    await waitFor(() => expect(secondFetchRequested).toBe(true));
    expect(screen.queryByText("Syncing school records...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open digital student ID for Aarav Sharma/ })).toBeVisible();
    finishSecondFetch({ ...(schoolApiFixture("/api/v1/screens/parent/home/?student_id=student-2") as object), student: second, siblings: [first] });
    expect(await screen.findByRole("button", { name: /Open digital student ID for Ananya Sharma/ })).toBeVisible();
  }, 12000);

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
      const card = await screen.findByRole("button", { name: new RegExp(`^Open digital student ID for ${from} Sharma`) });
      await waitFor(() => expect(card).toBeEnabled());
      const startX = direction === "right" ? 80 : 220;
      const endX = direction === "right" ? 220 : 80;
      fireEvent.touchStart(card, { touches: [{ clientX: startX, clientY: 100 }] });
      fireEvent.touchEnd(card, { changedTouches: [{ clientX: endX, clientY: 100 }] });
      await screen.findByRole("button", { name: new RegExp(`^Open digital student ID for ${to} Sharma`) }, { timeout: 5000 });
      await waitFor(() => expect(document.querySelector(".parent-id-stack.is-animating")).not.toBeInTheDocument(), { timeout: 5000 });
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
  }, 60000);

  it("renders the timetable as a weekly period chart without the old tab switcher", async () => {
    render(<MemoryRouter initialEntries={["/student/timetable"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Weekly period chart" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Week Grid" })).not.toBeInTheDocument();
  });
});

describe("authentication and route authorization", () => {
  it("sends an anonymous visitor to sign in and preserves the intended route", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/session/") {
        return Promise.resolve({ authenticated: false, user: null, csrf_token: "csrf", demo_mode: true });
      }
      return Promise.reject(new Error("Unexpected request"));
    });
    render(<MemoryRouter initialEntries={["/parent/attendance"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Sign in to your school" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Parent view/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Student view/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Teacher view/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Principal view/i })).toBeVisible();
  });

  it("redirects a student away from parent-only records", async () => {
    mockSession(["student"]);
    render(<MemoryRouter initialEntries={["/parent/home"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Aarav Sharma" })).toBeVisible();
    expect(screen.getByText("Today's presence")).toBeVisible();
  });

  it("holds a newly registered account outside tenant data until membership exists", async () => {
    mockSession([]);
    render(<MemoryRouter initialEntries={["/student/attendance"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Now connect with your school" })).toBeVisible();
    expect(screen.getByText(/needs to verify your membership/i)).toBeVisible();
  });
});
