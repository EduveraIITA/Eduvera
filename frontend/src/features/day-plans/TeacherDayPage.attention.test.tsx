import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import TeacherDayPage from "./TeacherDayPage";
import { getTeacherDay, getTeacherSummary } from "./api";

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

function mount(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}><TeacherDayPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

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
