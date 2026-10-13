import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PrincipalDayPlanPage from "./PrincipalDayPlanPage";
import { getAdminSummary, getDayPlan, getPlanOptions } from "./api";

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "principal-1", active_school_id: "school-1" },
    memberships: [{ role: "admin", school_id: "school-1", school_name: "Cambridge International School" }],
  }),
}));
vi.mock("../timetable/TimetableNavigator", async (original) => ({
  ...(await original<typeof import("../timetable/TimetableNavigator")>()),
  TimetableNavigator: () => null,
}));
vi.mock("../attention/AttentionOpenAcknowledgement", () => ({ AttentionOpenAcknowledgement: () => <span data-testid="attention-ack" /> }));
vi.mock("./PlanEditor", () => ({
  PlanEditor: ({ plan, focusedPeriodId }: { plan: { id: string }; focusedPeriodId?: string }) => <section data-focused-period={focusedPeriodId}>Editing draft {plan.id}</section>,
}));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  getPlanOptions: vi.fn(),
  getAdminSummary: vi.fn(),
  getDayPlan: vi.fn(),
  sharedDayPeriods: () => [],
}));

const options = (planId: string | null, publishedVersion: number | null = null) => ({
  classes: [{
    id: "class-1",
    name: "Class 7A",
    room_number: "204",
    term_id: "term-1",
    plan_id: planId,
    revision: planId ? 2 : null,
    draft_version: planId && publishedVersion===null ? 1 : null,
    published_version: publishedVersion,
    unresolved: 0,
  }],
  teachers: [],
  subjects: [],
  schedule: [],
  context: {
    today: "2026-10-13",
    local_time: "09:00",
    timezone: "Asia/Kolkata",
    is_instructional: true,
    label: null,
  },
});

const draft = {
  id: "plan-1",
  school_id: "school-1",
  class_section_id: "class-1",
  date: "2026-10-13",
  revision: 2,
  draft_version: 1,
  published_version: null,
  selected_version: 1,
  owner_id: "principal-1",
  updated_at: "2026-10-13T08:00:00.000Z",
  versions: [{
    version: 1,
    state: "draft" as const,
    notice: "",
    reason: "Cover change",
    created_at: "2026-10-13T08:00:00.000Z",
    published_at: null,
    author: "Meera Rao",
  }],
  periods: [],
  published_periods: [],
  context: options("plan-1").context,
  conflicts: [],
};
const period = {
  id: "period-1", subject_id: null, period_number: 1, starts_at: "09:00", ends_at: "09:45",
  title: "English", slot_type: "class" as const, room: "204", teacher_user_id: "teacher-1", cancelled: false,
  materials: [], teacher_name: "Kavita Mehta", coverage_status: "not_required" as const, response_revision: 0,
  response_note: "", response_source: null, responded_at: null,
};

function mount(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <PrincipalDayPlanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getPlanOptions).mockResolvedValue(options("plan-1"));
  vi.mocked(getAdminSummary).mockResolvedValue({ start: "2026-10-13", end: "2026-10-13", days: [] });
  vi.mocked(getDayPlan).mockResolvedValue(draft);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("day-plan attention destination", () => {
  it("opens and focuses the exact draft editing controls", async () => {
    mount("/principal/timetable/day?school=school-1&date=2026-10-13&class=class-1&plan=plan-1");

    const editor = await screen.findByText("Editing draft plan-1");
    expect(editor.closest(".day-attention-target")).toHaveAttribute("id", "day-plan-draft-plan-1");
  });

  it("focuses the exact linked period", async () => {
    vi.mocked(getDayPlan).mockResolvedValue({...draft,periods:[period]});
    mount("/principal/timetable/day?school=school-1&date=2026-10-13&class=class-1&plan=plan-1&period=period-1");

    const editor=await screen.findByText("Editing draft plan-1");
    expect(editor).toHaveAttribute("data-focused-period","period-1");
  });

  it("shows a truthful state for a stale linked period", async () => {
    vi.mocked(getDayPlan).mockResolvedValue({...draft,periods:[period]});
    mount("/principal/timetable/day?school=school-1&date=2026-10-13&class=class-1&plan=plan-1&period=missing-period");

    expect(await screen.findByRole("alert")).toHaveTextContent("period is no longer part");
    expect(screen.queryByTestId("attention-ack")).not.toBeInTheDocument();
  });

  it("acknowledges only the exact published day-plan source and revision", async () => {
    vi.mocked(getPlanOptions).mockResolvedValue(options("plan-1",2));
    vi.mocked(getDayPlan).mockResolvedValue({...draft,draft_version:null,published_version:2,selected_version:2,periods:[period],published_periods:[period]});
    mount("/principal/timetable/day?school=school-1&date=2026-10-13&class=class-1&day_plan_id=plan-1&day_plan_revision=2&attention_notification_id=notice-1");

    expect(await screen.findByTestId("attention-ack")).toBeInTheDocument();
    await waitFor(()=>expect(document.getElementById("attention-timetable-source-plan-1")).toHaveFocus());
  });

  it("keeps a stale day-plan revision unacknowledged", async () => {
    vi.mocked(getPlanOptions).mockResolvedValue(options("plan-1",2));
    mount("/principal/timetable/day?school=school-1&date=2026-10-13&class=class-1&day_plan_id=plan-1&day_plan_revision=1&attention_notification_id=notice-1");

    expect(await screen.findByRole("alert")).toHaveTextContent("Timetable update unavailable");
    expect(screen.queryByTestId("attention-ack")).not.toBeInTheDocument();
    expect(getDayPlan).not.toHaveBeenCalled();
  });

  it("proves a repeating schedule id and revision before acknowledging", async () => {
    vi.mocked(getPlanOptions).mockResolvedValue({...options(null),schedule_sources:[{id:"schedule-1",class_section_id:"class-1",term_id:"term-1",revision:4,starts_on:"2026-10-13",ends_on:"2027-03-31"}]});
    mount("/principal/timetable/day?school=school-1&date=2026-10-13&class=class-1&schedule_id=schedule-1&schedule_revision=4&attention_notification_id=notice-1");

    expect(await screen.findByTestId("attention-ack")).toBeInTheDocument();
    await waitFor(()=>expect(document.getElementById("attention-timetable-source-schedule-1")).toHaveFocus());
  });

  it("keeps a stale repeating schedule revision unacknowledged", async () => {
    vi.mocked(getPlanOptions).mockResolvedValue({...options(null),schedule_sources:[{id:"schedule-1",class_section_id:"class-1",term_id:"term-1",revision:4,starts_on:"2026-10-13",ends_on:"2027-03-31"}]});
    mount("/principal/timetable/day?school=school-1&date=2026-10-13&class=class-1&schedule_id=schedule-1&schedule_revision=3&attention_notification_id=notice-1");

    expect(await screen.findByRole("alert")).toHaveTextContent("Timetable update unavailable");
    expect(screen.queryByTestId("attention-ack")).not.toBeInTheDocument();
  });

  it("fails clearly when the linked draft is stale instead of opening another plan", async () => {
    vi.mocked(getPlanOptions).mockResolvedValue(options("replacement-plan"));
    mount("/principal/timetable/day?school=school-1&date=2026-10-13&class=class-1&plan=plan-1");

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer available");
    expect(getDayPlan).not.toHaveBeenCalled();
  });

  it("never sends an inaccessible school id to the day-plan APIs", async () => {
    mount("/principal/timetable/day?school=school-2&date=2026-10-13&class=class-1&plan=plan-1");

    expect(screen.getByRole("alert")).toHaveTextContent("cannot currently access");
    await waitFor(() => expect(getPlanOptions).not.toHaveBeenCalled());
    expect(getAdminSummary).not.toHaveBeenCalled();
  });
});
