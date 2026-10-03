import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PlanEditor } from "./PlanEditor";
import { PeriodEditor } from "./PeriodEditor";
import { CoverageResponse } from "./CoverageResponse";
import { DayPeriodList } from "./DayPeriodList";
import { DayPlanNotice } from "./DayPlanNotice";
import {
  saveDayPlan,
  publishDayPlan,
  discardDayPlan,
  respondCoverage,
  sharedDayPeriods,
  type DayPeriod,
  type DayPlan,
} from "./api";
import {
  addSchoolDays,
  groupSummaryByMonth,
  monthDays,
  summaryRange,
  visibleStrip,
} from "./teacher-date-navigation";
import { resolveSchoolEvent } from "../school/schoolEventProtocol";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  saveDayPlan: vi.fn(),
  publishDayPlan: vi.fn(),
  discardDayPlan: vi.fn(),
  respondCoverage: vi.fn(),
}));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const teachers = [
    { id: "teacher-1", name: "Kavita Mehta" },
    { id: "teacher-2", name: "Priya Iyer" },
  ],
  subjects = [{ id: "subject-1", name: "Mathematics" }];
const period: DayPeriod = {
  id: "period-1",
  subject_id: "subject-1",
  period_number: 1,
  starts_at: "09:00:00",
  ends_at: "09:45:00",
  title: "Mathematics",
  room: "Room 204",
  slot_type: "class",
  teacher_user_id: "teacher-1",
  teacher_name: "Kavita Mehta",
  cancelled: false,
  materials: ["Graph notebook"],
  coverage_status: "pending",
  response_revision: 0,
  response_note: "",
  response_source: null,
  responded_at: null,
};
const fixture = (): DayPlan => ({
  id: "plan-1",
  school_id: "school-1",
  class_section_id: "class-1",
  date: "2026-09-17",
  revision: 2,
  draft_version: 1,
  published_version: null,
  selected_version: 1,
  owner_id: "admin-1",
  updated_at: "2026-09-16T12:00:00Z",
  versions: [
    {
      version: 1,
      state: "draft",
      notice: "Bring your graph notebook.",
      reason: "Classroom maintenance.",
      created_at: "2026-09-16T12:00:00Z",
      published_at: null,
      author: "Meera Rao",
    },
  ],
  periods: [structuredClone(period)],
  published_periods: [],
  context: {
    today: "2026-09-16",
    local_time: "17:30",
    timezone: "Asia/Kolkata",
    is_instructional: true,
    label: null,
  },
  conflicts: [],
});
describe("Daily plan workflow UI", () => {
  it("builds bounded teacher calendar ranges and aggregates yearly load", () => {
    expect(visibleStrip("2026-09-16")).toHaveLength(15);
    expect(addSchoolDays("2026-09-16", 7)).toBe("2026-09-23");
    expect(summaryRange("2026-09-16", "month")).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(summaryRange("2026-01-02", "month").start).toBe("2025-12-26");
    expect(summaryRange("2026-09-16", "year")).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
    expect(monthDays("2026-02-14")).toHaveLength(28);
    expect(
      groupSummaryByMonth([
        {
          date: "2026-09-01",
          periods: 4,
          classes: 2,
          pending: 1,
          accepted: 1,
          declined: 0,
          cancelled: 0,
        },
        {
          date: "2026-09-02",
          periods: 3,
          classes: 1,
          pending: 0,
          accepted: 0,
          declined: 0,
          cancelled: 1,
        },
      ]),
    ).toEqual([
      { month: "2026-09", periods: 7, classes: 3, pending: 1, cancelled: 1 },
    ]);
  });
  it("retains the weekly schedule when preparing a first draft, including after discard", () => {
    const baseline = { ...period, id: "baseline", class_section_id: "class-1" };
    expect(sharedDayPeriods(fixture(), [baseline], "class-1")).toEqual([
      baseline,
    ]);
    expect(
      sharedDayPeriods(
        { ...fixture(), draft_version: null },
        [baseline],
        "class-1",
      ),
    ).toEqual([baseline]);
    expect(
      sharedDayPeriods(
        { ...fixture(), published_version: 1, published_periods: [] },
        [baseline],
        "class-1",
      ),
    ).toEqual([]);
  });
  it("keeps period editing local and preserves the linked subject", async () => {
    const save = vi.fn();
    render(
      <PeriodEditor
        period={period}
        teachers={teachers}
        subjects={subjects}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText("Room"), {
      target: { value: "Science lab" },
    });
    await user.selectOptions(
      screen.getByLabelText("Assigned teacher"),
      "teacher-2",
    );
    await user.click(screen.getByRole("button", { name: "Apply to draft" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        room: "Science lab",
        teacher_user_id: "teacher-2",
        subject_id: "subject-1",
      }),
    );
    expect(saveDayPlan).not.toHaveBeenCalled();
  });
  it("rejects overlapping start/end bounds before applying an edit", async () => {
    const save = vi.fn();
    render(
      <PeriodEditor
        period={period}
        teachers={teachers}
        subjects={subjects}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Ends at"), {
      target: { value: "08:00" },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Apply to draft" }));
    expect(screen.getByRole("alert")).toHaveTextContent("End time");
    expect(save).not.toHaveBeenCalled();
  });
  it("deduplicates materials and represents cancellation explicitly", async () => {
    const save = vi.fn();
    render(
      <PeriodEditor
        period={period}
        teachers={teachers}
        subjects={subjects}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Materials to bring"), {
      target: { value: "Ruler\nRuler\nNotebook" },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Apply to draft" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelled: true,
        materials: ["Ruler", "Notebook"],
      }),
    );
  });
  it("requires saving edits before publication and binds save to the original revision", async () => {
    vi.mocked(saveDayPlan).mockResolvedValue({ id: "plan-1", revision: 3 });
    const saved = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanEditor
        plan={fixture()}
        teachers={teachers}
        subjects={subjects}
        onSaved={saved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Notice for families"), {
      target: { value: "Bring a ruler." },
    });
    expect(
      screen.getByRole("button", { name: "Review & publish" }),
    ).toBeDisabled();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Save draft" }));
    expect(saveDayPlan).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({
        expected_revision: 2,
        notice: "Bring a ruler.",
      }),
    );
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(publishDayPlan).not.toHaveBeenCalled();
  });
  it("requires explicit final review before publishing", async () => {
    vi.mocked(publishDayPlan).mockResolvedValue({
      id: "plan-1",
      revision: 3,
      version: 1,
    });
    render(
      <PlanEditor
        plan={fixture()}
        teachers={teachers}
        subjects={subjects}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Review & publish" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Publish day plan" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Publish day plan" }));
    expect(publishDayPlan).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({ expected_revision: 2 }),
    );
  });
  it("retries an interrupted publication with the exact same command", async () => {
    vi.mocked(publishDayPlan).mockRejectedValue(
      new Error("Connection interrupted"),
    );
    render(
      <PlanEditor
        plan={fixture()}
        teachers={teachers}
        subjects={subjects}
        onSaved={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Review & publish" }));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Publish day plan" }));
    await user.click(screen.getByRole("button", { name: "Publish day plan" }));
    expect(vi.mocked(publishDayPlan).mock.calls[0]).toEqual(
      vi.mocked(publishDayPlan).mock.calls[1],
    );
  });
  it("keeps unsaved edits and blocks new writes after an incoming revision", () => {
    const plan = fixture(),
      props = { teachers, subjects, onSaved: vi.fn() };
    const view = render(<PlanEditor plan={plan} {...props} />);
    fireEvent.change(screen.getByLabelText("Notice for families"), {
      target: { value: "My unsaved change" },
    });
    view.rerender(<PlanEditor plan={{ ...plan, revision: 3 }} {...props} />);
    expect(screen.getByLabelText("Notice for families")).toHaveValue(
      "My unsaved change",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("another session");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });
  it("blocks publication until conflicts are resolved", () => {
    const plan = fixture();
    plan.conflicts = [
      {
        period_number: 1,
        other_period: 2,
        class_name: "Class 7B",
        type: "teacher",
      },
    ];
    render(
      <PlanEditor
        plan={plan}
        teachers={teachers}
        subjects={subjects}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText(/teacher overlaps Class 7B/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Review & publish" }),
    ).toBeDisabled();
  });
  it("does not discard until a separate confirmation", async () => {
    vi.mocked(discardDayPlan).mockResolvedValue({ id: "plan-1", revision: 3 });
    render(
      <PlanEditor
        plan={fixture()}
        teachers={teachers}
        subjects={subjects}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Discard draft" }));
    expect(discardDayPlan).not.toHaveBeenCalled();
    expect(
      screen.getByText(/current published plan stays unchanged/),
    ).toBeVisible();
  });
  it("requires a reason when a teacher is unavailable", async () => {
    vi.mocked(respondCoverage).mockResolvedValue({
      id: "period-1",
      status: "declined",
      response_revision: 1,
    });
    render(
      <CoverageResponse
        schoolId="school-1"
        period={period}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Response"), "declined");
    expect(screen.getByLabelText("Reason unavailable")).toBeRequired();
    await user.click(screen.getByRole("button", { name: "Save response" }));
    expect(respondCoverage).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason unavailable"), {
      target: { value: "Assigned to office duty." },
    });
    await user.click(screen.getByRole("button", { name: "Save response" }));
    expect(respondCoverage).toHaveBeenCalledWith(
      "period-1",
      expect.objectContaining({
        source: "app",
        status: "declined",
        note: "Assigned to office duty.",
      }),
    );
  });
  it("clearly attributes the assisted response path and preserves source/time", async () => {
    vi.mocked(respondCoverage).mockResolvedValue({
      id: "period-1",
      status: "accepted",
      response_revision: 1,
    });
    render(
      <CoverageResponse
        schoolId="school-1"
        period={period}
        assisted
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/entered by the school office/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Record of response"), {
      target: { value: "Confirmed on phone." },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Save response" }));
    expect(respondCoverage).toHaveBeenCalledWith(
      "period-1",
      expect.objectContaining({
        source: "phone",
        note: "Confirmed on phone.",
      }),
    );
    expect(
      typeof vi.mocked(respondCoverage).mock.calls[0]?.[1].received_at,
    ).toBe("string");
  });
  it("does not present cancelled periods as confirmed or include their materials", () => {
    render(<DayPeriodList periods={[{ ...period, cancelled: true }]} />);
    expect(screen.getByText("Cancelled")).toBeVisible();
    expect(screen.queryByText("Graph notebook")).not.toBeInTheDocument();
    expect(screen.queryByText("Teacher confirmed")).not.toBeInTheDocument();
  });
  it("shows a compact time range without repeating it in period metadata", () => {
    const { container } = render(<DayPeriodList periods={[period]} />);
    expect(screen.getAllByText("9:00 AM")).toHaveLength(1);
    expect(screen.getByText("9:45 AM")).toBeVisible();
    expect(container.querySelector(".day-period-meta")).toHaveTextContent(
      "Kavita MehtaRoom 204",
    );
  });
  it("uses an in-app link for a family notice without claiming acknowledgment", () => {
    render(
      <MemoryRouter>
        <DayPlanNotice
          plan={{
            id: "p",
            date: "2026-09-17",
            version: 2,
            notice: "Science has moved to Lab B.",
            published_at: "2026-09-16T12:00:00Z",
            cancelled_periods: 1,
          }}
          href="/parent/timetable"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Science has moved to Lab B.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View timetable" }),
    ).toHaveAttribute("href", "/parent/timetable");
    expect(screen.queryByText(/acknowledged/i)).not.toBeInTheDocument();
  });
  it("invalidates the daily plan and affected schedule caches, not attendance on a draft update", () => {
    const event = resolveSchoolEvent(
      JSON.stringify({
        id: "e",
        type: "day_plan.updated",
        created_at: "2026-09-16T12:00:00Z",
        payload: { refresh: ["day-plans"] },
      }),
      "day_plan.updated",
    );
    expect(event.usedFallback).toBe(false);
    expect(event.invalidations).toEqual([
      { queryKey: ["school", "day-plans"] },
    ]);
  });
});
