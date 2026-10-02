import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrincipalTimetableResponse } from "../../features/operations/api";
import { PrincipalTimetablePage } from "./TimetableBuilderPage";
import { nextSlot } from "./TimetableBuilderSheets";

const data: PrincipalTimetableResponse = {
  terms: [{ id: "term-1", academic_year: "2026-27", name: "Term 1", starts_on: "2026-08-01", ends_on: "2026-12-16", is_active: true }],
  selected_term_id: "term-1",
  classes: [{ id: "class-1", name: "Class 7A", grade: "7", section: "A", room_number: "204" }],
  subjects: [{ id: "subject-1", code: "MAT", name: "Mathematics", short_name: "Maths", color: "#1d4ed8" }],
  teachers: [{ id: "teacher-1", name: "Kavita Mehta" }],
  slots: [{ id: "slot-1", class_section_id: "class-1", class_name: "Class 7A", subject_id: "subject-1", display_title: "Mathematics", teacher_user_id: "teacher-1", teacher_name: "Kavita Mehta", weekday: 1, weekday_label: "Monday", period_number: 1, starts_at: "09:00:00", ends_at: "09:45:00", slot_type: "class", room: "204" }],
  conflicts: [],
  coverage: [{ class_section_id: "class-1", subject_id: "subject-1", weekly_periods: 1, weekly_minutes: 45, projected_periods: 19, projected_minutes: 855, target_minutes: 1200, revision: 1 }],
  calendar_exceptions: [],
  school_date: "2026-10-02",
};

afterEach(cleanup);

function show(overrides: Partial<Parameters<typeof PrincipalTimetablePage>[0]> = {}) {
  const props = {
    data,
    onTermChange: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onCopy: vi.fn().mockResolvedValue({ copied: true, periods_created: 1, target_weekdays: [2] }),
    onSaveTarget: vi.fn().mockResolvedValue(undefined),
    onCreateClosure: vi.fn().mockResolvedValue(undefined),
    onDeleteClosure: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PrincipalTimetablePage {...props} /></MemoryRouter></QueryClientProvider>);
  return props;
}

describe("principal timetable management", () => {
  it("keeps the published timetable as the primary module", () => {
    show();
    expect(screen.getByRole("heading", { name: "Manage timetable" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Published timetable" })).toHaveAttribute("href", "/principal/timetable");
  });

  it("opens a focused mobile period editor with the next usable time", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: /Mon 28/ }));
    expect(screen.getByRole("heading", { name: "Monday" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add period" }));
    expect(screen.getByRole("dialog", { name: "Add period" })).toBeVisible();
    expect(screen.getByLabelText("Period")).toHaveValue(2);
    expect(screen.getByLabelText("Starts")).toHaveValue("09:50");
    expect(screen.getByLabelText("Ends")).toHaveValue("10:35");
  });

  it("copies one planned day to selected empty weekdays", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn().mockResolvedValue({ copied: true, periods_created: 1, target_weekdays: [2] });
    show({ onCopy });
    await user.click(screen.getByRole("button", { name: /Mon 28/ }));
    await user.click(screen.getByRole("button", { name: "Copy day" }));
    await user.click(screen.getByRole("button", { name: /Tuesday/ }));
    await user.click(screen.getByRole("button", { name: "Copy to 1 day" }));
    expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ term_id: "term-1", class_section_id: "class-1", source_weekday: 1, target_weekdays: [2], replace: false }));
  });

  it("builds the next period from the selected day's final slot", () => {
    expect(nextSlot(data.slots, data.classes[0]!, "term-1", 1)).toMatchObject({ period_number: 2, starts_at: "09:50", ends_at: "10:35", room: "204" });
  });

  it("shows effective term coverage and saves a subject-hours target", async () => {
    const user = userEvent.setup();
    const onSaveTarget = vi.fn().mockResolvedValue(undefined);
    show({ onSaveTarget });
    await user.click(screen.getByRole("button", { name: /Coverage targets/ }));
    expect(screen.queryByRole("combobox", { name: "Add target" })).not.toBeInTheDocument();
    expect(screen.getByText("5.8h short")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Mathematics/ }));
    expect(screen.getByRole("dialog", { name: "Mathematics" })).toBeVisible();
    await user.clear(screen.getByLabelText("Target hours for the term"));
    await user.type(screen.getByLabelText("Target hours for the term"), "24");
    await user.click(screen.getByRole("button", { name: "Save target" }));
    expect(onSaveTarget).toHaveBeenCalledWith(expect.objectContaining({ target_minutes: 1440, expected_revision: 1 }));
  });

  it("switches weeks and lets the principal jump directly to a date", async () => {
    const user = userEvent.setup();
    show();
    const picker = screen.getByLabelText("Jump to date");
    expect(picker).toHaveValue("2026-10-02");
    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(picker).toHaveValue("2026-10-09");
    fireEvent.change(picker, { target: { value: "2026-11-12" } });
    expect(screen.getByRole("heading", { name: "Thursday" })).toBeVisible();
    expect(picker).toHaveValue("2026-11-12");
  });

  it("snaps to the next week after a deliberate horizontal pull", () => {
    show();
    const rail = screen.getByRole("navigation", { name: /Dates in selected week/ });
    const pointer = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, clientX: { value: clientX }, clientY: { value: clientY } });
      fireEvent(rail, event);
    };
    pointer("pointerdown", 300, 200);
    pointer("pointermove", 210, 204);
    pointer("pointerup", 210, 204);
    expect(screen.getByLabelText("Jump to date")).toHaveValue("2026-10-09");
  });

  it("creates a dated emergency closure without changing the weekly plan", async () => {
    const user = userEvent.setup();
    const onCreateClosure = vi.fn().mockResolvedValue(undefined);
    show({ onCreateClosure });
    await user.click(screen.getByRole("button", { name: /School dates/ }));
    await user.selectOptions(screen.getByLabelText("Type"), "emergency_closure");
    await user.type(screen.getByLabelText("Name"), "Weather closure");
    await user.type(screen.getByLabelText("Reason"), "District safety advisory");
    await user.click(screen.getByRole("button", { name: "Close selected date" }));
    expect(onCreateClosure).toHaveBeenCalledWith(expect.objectContaining({ kind: "emergency_closure", label: "Weather closure", starts_on: "2026-10-02" }));
  });
});
