import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrincipalPlannerRoute } from "./PrincipalPlannerRoute";
import { getScheduleSettings, scheduleCommand, type SchedulePeriod, type ScheduleScreen } from "../schedule-planning/api";
import { getCampusEvents } from "../campus-events/api";

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ children, pageTitleTrailing }: { children: ReactNode; pageTitleTrailing: ReactNode }) => <>{pageTitleTrailing}{children}</>,
}));
vi.mock("./PlannerTimeline", () => ({ PlannerTimeline: () => <div aria-label="Timetable calendar" /> }));
vi.mock("../schedule-planning/api", async (original) => ({
  ...await original<typeof import("../schedule-planning/api")>(),
  getScheduleSettings: vi.fn(),
  scheduleCommand: vi.fn(),
}));
vi.mock("../campus-events/api", () => ({ getCampusEvents: vi.fn() }));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const existingPeriod: SchedulePeriod = {
  id: "copied-maths", weekday: 3, period_number: 1, starts_at: "09:00", ends_at: "09:45",
  subject_id: "maths", teacher_user_id: "teacher-1", title: "Mathematics", slot_type: "class", room: "201",
};
// A real draft response contains relational metadata that the strict save contract rejects.
const copiedPeriod = { ...existingPeriod, version_id: "draft-1" };
const data: ScheduleScreen = {
  school_id: "school-1", school_date: "2026-10-14", selected_term_id: "term-1",
  terms: [{ id: "term-1", academic_year: "2026-27", name: "Term 1", starts_on: "2026-04-01", ends_on: "2027-03-31", is_active: true }],
  classes: [{ id: "class-1", name: "Class 6A", grade: "6", section: "A", room_number: "201" }],
  subjects: [
    { id: "maths", name: "Mathematics", code: "MATH", short_name: "Maths", color: "blue" },
    { id: "english", name: "English", code: "ENG", short_name: "English", color: "green" },
  ],
  teachers: [{ id: "teacher-1", name: "Meera Kapoor" }],
  versions: [], slots: [], conflicts: [], coverage: [], calendar_exceptions: [],
};
const draft = {
  id: "draft-1", class_section_id: "class-1", term_id: "term-1", state: "draft" as const,
  starts_on: "2026-10-21", ends_on: "2027-03-31", revision: 4, baseline: false, periods: [copiedPeriod],
};

describe("recurring timetable creation", () => {
  it.each([false, true])("preserves copied periods and saves new classes without response-only metadata (existing draft: %s)", async (alreadyDrafting) => {
    let current: ScheduleScreen = { ...data, versions: alreadyDrafting ? [draft] : [] };
    vi.mocked(getScheduleSettings).mockImplementation(() => Promise.resolve(current));
    vi.mocked(getCampusEvents).mockResolvedValue({ items: [], next_cursor: null });
    vi.mocked(scheduleCommand).mockImplementation((path, _schoolId, body) => {
      if (path === "drafts") {
        current = { ...data, versions: [draft] };
        return Promise.resolve({ id: draft.id });
      }
      if (path === "draft-1/save") {
        const periods = body.periods as SchedulePeriod[];
        if (periods.some((period) => "version_id" in period)) throw new Error("Check fields");
        current = { ...data, versions: [{ ...draft, periods, revision: 5 }] };
        return Promise.resolve({ revision: 5 });
      }
      throw new Error(`Unexpected schedule command: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/areas/timetable/planning?date=2026-10-21"]}><PrincipalPlannerRoute presentation="workspace" /></MemoryRouter></QueryClientProvider>);
    await screen.findByRole("combobox", { name: "Filter by class" });
    await userEvent.click(screen.getByText("New", { selector: "summary" }));
    await userEvent.click(screen.getByRole("button", { name: /Recurring class Choose a subject/ }));
    const sheet = within(screen.getByRole("dialog", { name: "New recurring class" }));
    await userEvent.selectOptions(sheet.getByRole("combobox", { name: "Subject" }), "english");
    fireEvent.change(sheet.getByLabelText("Starts"), { target: { value: "10:00" } });
    fireEvent.change(sheet.getByLabelText("Ends"), { target: { value: "10:45" } });
    await userEvent.click(sheet.getByRole("button", { name: "Fri", exact: true }));
    await userEvent.click(sheet.getByRole("button", { name: "Add to draft" }));

    expect(await screen.findByRole("status")).toHaveTextContent("English was added to the Class 6A draft. Review and publish when the week is ready.");
    expect(screen.queryByRole("dialog", { name: "New recurring class" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by class" })).toHaveValue("class-1");
    const save = vi.mocked(scheduleCommand).mock.calls.find(([path]) => path === "draft-1/save")!;
    expect(save[1]).toBe("school-1");
    expect(save[2]).toMatchObject({
      expected_revision: 4, starts_on: "2026-10-21", ends_on: "2027-03-31",
    });
    const savedPeriods = save[2].periods as SchedulePeriod[];
    expect(savedPeriods).toHaveLength(3);
    expect(savedPeriods[0]).toEqual(existingPeriod);
    expect(savedPeriods.slice(1).map(({ id, ...period }) => {
      expect(id).toMatch(/^[a-z\d-]{36}$/u);
      return period;
    })).toEqual([
      { weekday: 3, period_number: 2, starts_at: "10:00", ends_at: "10:45", subject_id: "english", teacher_user_id: "teacher-1", title: "English", slot_type: "class", room: "201" },
      { weekday: 5, period_number: 1, starts_at: "10:00", ends_at: "10:45", subject_id: "english", teacher_user_id: "teacher-1", title: "English", slot_type: "class", room: "201" },
    ]);
    expect(scheduleCommand).toHaveBeenCalledTimes(alreadyDrafting ? 1 : 2);
    if (!alreadyDrafting) {
      expect(scheduleCommand).toHaveBeenNthCalledWith(1, "drafts", "school-1", {
        term_id: "term-1", class_section_id: "class-1", starts_on: "2026-10-21", ends_on: "2027-03-31",
      });
      expect(getScheduleSettings).toHaveBeenCalledWith("term-1");
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Review draft timetable" })).toBeVisible());
    expect(scheduleCommand).not.toHaveBeenCalledWith(expect.stringContaining("publish"), expect.anything(), expect.anything());
    client.clear();
  });
});
