import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { findDraftPeriod, PlannerLessonSheet, PlannerPublishSheet } from "./PlannerLessonSheet";
import { getScheduleSettings, scheduleCommand, type ScheduleScreen, type ScheduleVersion } from "../schedule-planning/api";
import type { PlannerPeriod } from "./PrincipalPlannerRoute";

vi.mock("../schedule-planning/api", async (original) => ({ ...await original<typeof import("../schedule-planning/api")>(), scheduleCommand: vi.fn(), getScheduleSettings: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const period: PlannerPeriod = { id: "lesson-1", class_section_id: "class-1", class_name: "Class 6A", teacher_name: "Meera Kapoor", display_title: "Mathematics", version_id: "draft-1", version_state: "draft", weekday: 3, period_number: 1, starts_at: "09:00", ends_at: "09:45", subject_id: "math", teacher_user_id: "teacher-1", title: "Mathematics", slot_type: "class", room: "201" };
const draft: ScheduleVersion = { id: "draft-1", class_section_id: "class-1", term_id: "term-1", state: "draft", starts_on: "2026-10-15", ends_on: "2027-03-31", revision: 4, baseline: false, periods: [period] };
const data: ScheduleScreen = { school_id: "school-1", school_date: "2026-10-14", selected_term_id: "term-1", terms: [{ id: "term-1", academic_year: "2026-27", name: "Term 1", starts_on: "2026-04-01", ends_on: "2027-03-31", is_active: true }], classes: [{ id: "class-1", name: "Class 6A", grade: "6", section: "A", room_number: "201" }], subjects: [{ id: "math", name: "Mathematics", code: "MATH", short_name: "Math", color: "blue" }], teachers: [{ id: "teacher-1", name: "Meera Kapoor" }], versions: [draft], slots: [], conflicts: [], coverage: [], calendar_exceptions: [] };

describe("calendar lesson workflow", () => {
  it("opens details without writing, then saves an edit only to the selected draft", async () => {
    const saved = vi.fn(), close = vi.fn();
    vi.mocked(scheduleCommand).mockResolvedValue({ revision: 5 });
    render(<MemoryRouter><PlannerLessonSheet data={data} period={period} date="2026-10-21" onClose={close} onSaved={saved} /></MemoryRouter>);
    expect(scheduleCommand).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Edit recurring class" }));
    fireEvent.change(screen.getByLabelText("Room"), { target: { value: "202" } });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(scheduleCommand).toHaveBeenCalledTimes(1);
    expect(scheduleCommand).toHaveBeenCalledWith("draft-1/save", "school-1", expect.objectContaining({ expected_revision: 4, periods: [expect.objectContaining({ id: "lesson-1", room: "202" })] }));
    expect(vi.mocked(scheduleCommand).mock.calls[0]![2].periods).toEqual([expect.not.objectContaining({ class_name: "Class 6A" })]);
    expect(close).toHaveBeenCalled();
  });

  it("creates a future draft for a published lesson and edits its copied identity", async () => {
    const copied = { ...draft, periods: [{ ...period, id: "copied-lesson" }] };
    vi.mocked(scheduleCommand).mockResolvedValueOnce({ id: "draft-1" }).mockResolvedValueOnce({ revision: 5 });
    vi.mocked(getScheduleSettings).mockResolvedValue({ ...data, versions: [copied] });
    render(<MemoryRouter><PlannerLessonSheet data={{ ...data, versions: [] }} period={{ ...period, version_state: "published" }} date="2026-10-14" onClose={vi.fn()} onSaved={vi.fn()} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Edit recurring class" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(scheduleCommand).toHaveBeenCalledTimes(2));
    expect(scheduleCommand).toHaveBeenNthCalledWith(1, "drafts", "school-1", expect.objectContaining({ starts_on: "2026-10-15" }));
    expect(scheduleCommand).toHaveBeenNthCalledWith(2, "draft-1/save", "school-1", expect.objectContaining({ periods: [expect.objectContaining({ id: "copied-lesson" })] }));
  });

  it("does not confuse two lessons of the same subject", () => {
    const twice = { ...draft, periods: [{ ...period, id: "earlier", period_number: 2, starts_at: "08:00" }, { ...period, id: "correct" }] };
    expect(findDraftPeriod(twice, period)?.id).toBe("correct");
    expect(findDraftPeriod({ ...draft, periods: [twice.periods[0]!] }, period)).toBeUndefined();
  });

  it("keeps failed edits open with the server explanation", async () => {
    vi.mocked(scheduleCommand).mockRejectedValue(new Error("This draft changed. Refresh to use its latest revision."));
    const close = vi.fn();
    render(<MemoryRouter><PlannerLessonSheet data={data} period={period} date="2026-10-21" onClose={close} onSaved={vi.fn()} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Edit recurring class" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("latest revision");
    expect(close).not.toHaveBeenCalled();
  });

  it("reviews dates before publishing and retains the new revision after a rejected publication", async () => {
    vi.mocked(scheduleCommand).mockResolvedValueOnce({ revision: 5 }).mockRejectedValueOnce(new Error("Resolve the teacher clash.")).mockResolvedValueOnce({ revision: 6 }).mockResolvedValueOnce({});
    const published = vi.fn();
    render(<PlannerPublishSheet data={data} draft={{ ...draft, starts_on: "2026-10-09" }} onClose={vi.fn()} onPublished={published} />);
    expect(scheduleCommand).not.toHaveBeenCalled();
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-15");
    await userEvent.click(screen.getByRole("button", { name: "Publish timetable" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("teacher clash");
    expect(scheduleCommand).toHaveBeenNthCalledWith(2, "draft-1/publish", "school-1", { expected_revision: 5 });
    expect(published).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Publish timetable" }));
    await waitFor(() => expect(published).toHaveBeenCalled());
    expect(scheduleCommand).toHaveBeenNthCalledWith(3, "draft-1/save", "school-1", expect.objectContaining({ expected_revision: 5 }));
  });
});
