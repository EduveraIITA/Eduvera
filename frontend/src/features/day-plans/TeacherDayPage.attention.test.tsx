import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import TeacherDayPage from "./TeacherDayPage";
import { getTeacherDay, getTeacherSummary } from "./api";
import type { TimetableRehearsalIndicator } from "../planner/rehearsal";

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ memberships: [{ role: "staff", school_id: "school-1", school_name: "School" }] }),
}));
vi.mock("../timetable/TimetableNavigator", async (original) => ({
  ...(await original<typeof import("../timetable/TimetableNavigator")>()),
  TimetableNavigator: () => null,
}));
vi.mock("../attention/AttentionOpenAcknowledgement", () => ({
  AttentionOpenAcknowledgement: () => <span data-testid="attention-ack" />,
}));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  getTeacherDay: vi.fn(),
  getTeacherSummary: vi.fn(),
}));

const response = {
  date: "2026-10-13",
  context: { today: "2026-10-13", local_time: "08:00", timezone: "Asia/Kolkata", is_instructional: true, label: null },
  periods: [],
  schedule_sources: [{ id: "schedule-1", class_section_id: "class-1", term_id: "term-1", revision: 5, starts_on: "2026-10-13", ends_on: "2027-03-31" }],
};

function mount(url: string, rehearsal?: TimetableRehearsalIndicator) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}><TeacherDayPage rehearsal={rehearsal} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const rehearsal: TimetableRehearsalIndicator = {
  label: "Simulated school day",
  status: "running",
  referenceDate: "2026-10-14",
  simulatedAt: "2026-10-14T09:10:00+05:30",
  phaseLabel: "Period 1",
  phaseMode: "lesson",
  nextChangeAt: null,
  activeSlotIds: ["slot-1"],
  timeZone: "Asia/Kolkata",
  campusPath: "/principal/campus",
};

beforeEach(() => {
  vi.mocked(getTeacherDay).mockResolvedValue(response);
  vi.mocked(getTeacherSummary).mockResolvedValue({ start: "2026-10-13", end: "2026-10-13", days: [], totals: { periods: 0, classes: 0, pending: 0, accepted: 0, declined: 0, cancelled: 0 } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("teacher timetable attention destination", () => {
  it("focuses and acknowledges only the exact repeating schedule revision", async () => {
    mount("/teacher/timetable?date=2026-10-13&schedule_id=schedule-1&schedule_revision=5&attention_notification_id=notice-1");
    expect(await screen.findByTestId("attention-ack")).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("attention-timetable-source-schedule-1")).toHaveFocus());
  });

  it("shows a stale state without acknowledging the wrong revision", async () => {
    mount("/teacher/timetable?date=2026-10-13&schedule_id=schedule-1&schedule_revision=4&attention_notification_id=notice-1");
    expect(await screen.findByText(/no longer matches the published source/i)).toBeInTheDocument();
    expect(screen.queryByTestId("attention-ack")).not.toBeInTheDocument();
    expect(document.querySelector(".day-attention-target")).not.toBeInTheDocument();
  });
});

describe("teacher timetable rehearsal projection", () => {
  it("uses the rehearsal date only without an explicit URL date", async () => {
    mount("/teacher/timetable", rehearsal);
    await waitFor(() => expect(getTeacherDay).toHaveBeenCalledWith("school-1", "2026-10-14"));
    expect(screen.getByText("Read-only")).toBeInTheDocument();

    cleanup();
    vi.clearAllMocks();
    vi.mocked(getTeacherDay).mockResolvedValue(response);
    vi.mocked(getTeacherSummary).mockResolvedValue({ start: "2026-10-13", end: "2026-10-13", days: [], totals: { periods: 0, classes: 0, pending: 0, accepted: 0, declined: 0, cancelled: 0 } });
    mount("/teacher/timetable?date=2026-10-13", rehearsal);
    await waitFor(() => expect(getTeacherDay).toHaveBeenCalledWith("school-1", "2026-10-13"));
  });

  it("marks only the DT active published slot as rehearsal now", async () => {
    vi.mocked(getTeacherDay).mockResolvedValueOnce({
      ...response,
      date: "2026-10-14",
      periods: [{
        id: "slot-1",
        subject_id: null,
        period_number: 1,
        starts_at: "09:00:00",
        ends_at: "09:45:00",
        title: "Mathematics",
        slot_type: "class",
        room: "Room 201",
        teacher_user_id: "teacher-1",
        teacher_name: "Meera Kapoor",
        cancelled: false,
        materials: [],
        coverage_status: "not_required",
        response_revision: 1,
        response_note: "",
        response_source: null,
        responded_at: null,
        class_name: "Class 6A",
        class_section_id: "class-1",
        day_plan_id: null,
        plan_version: null,
        notice: "",
        owner_name: null,
      }],
    });
    mount("/teacher/timetable", rehearsal);
    const marker = await screen.findByText("Rehearsal now");
    expect(marker.closest("li")).toHaveAttribute("aria-current", "time");
  });
});
