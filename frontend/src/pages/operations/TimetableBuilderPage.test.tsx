import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
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

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}{location.search}</span>;
}

function show(overrides: Partial<Parameters<typeof PrincipalTimetablePage>[0]> = {}, entry = "/principal/timetable/weekly") {
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
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[entry]}><PrincipalTimetablePage {...props} /><LocationProbe /></MemoryRouter></QueryClientProvider>);
  return props;
}

describe("principal timetable management", () => {
  it("opens a separate settings page without the browsing tabs or dashboard totals", () => {
    show();
    expect(screen.getByRole("heading", { name: "Edit timetable" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Go back" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Timetable and calendar" })).not.toBeInTheDocument();
    expect(screen.queryByText("Class days")).not.toBeInTheDocument();
    expect(screen.queryByText("No teacher or room conflicts")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Class" })).toHaveValue("class-1");
    expect(screen.getByText("Every week in this term")).toBeVisible();
    expect(screen.getByText("1 Aug 2026 – 16 Dec 2026")).toBeVisible();
  });

  it("opens a focused mobile period editor with the next usable time", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: /Monday, 1 period/ }));
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
    await user.click(screen.getByRole("button", { name: /Monday, 1 period/ }));
    await user.click(screen.getByRole("button", { name: "Copy day" }));
    await user.click(within(screen.getByRole("dialog", { name: "Copy Monday" })).getByRole("button", { name: /Tuesday/ }));
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

  it("keeps weekday selection in the URL without extra calendar controls", async () => {
    const user = userEvent.setup();
    show();
    expect(screen.queryByLabelText("Jump to date")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Thursday, 0 periods/ }));
    expect(screen.getByRole("heading", { name: "Thursday" })).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("?day=4");
    expect(screen.getByText("Repeats weekly in Term 1")).toBeVisible();
  });

  it("opens the editor on the date selected in the daily timetable", async () => {
    const user = userEvent.setup();
    show({}, "/principal/timetable/weekly?school=s1&date=2026-11-12&class=class-1&view=month");
    expect(screen.getByRole("heading", { name: "Thursday" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Change one date only/ })).toHaveAttribute("href", "/principal/timetable?school=s1&date=2026-11-12&class=class-1&view=day");
    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/principal/timetable?school=s1&date=2026-11-12&class=class-1&view=month");
  });

  it.each(["invalid", "2026-02-30", "2027-01-04"])("ignores invalid or out-of-term entry date %s", (date) => {
    show({}, `/principal/timetable/weekly?date=${date}`);
    expect(screen.getByRole("heading", { name: "Friday" })).toBeVisible();
  });

  it("keeps the compact day rail and does not duplicate week dates", () => {
    show();
    expect(screen.getByRole("navigation", { name: "School week" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Monday, 1 period/ })).toBeVisible();
    expect(screen.queryByLabelText(/Week \d+ of \d+/)).not.toBeInTheDocument();
  });

  it("returns from coverage settings to the same class and weekday", async () => {
    const user = userEvent.setup();
    show({}, "/principal/timetable/weekly?class=class-1&day=1");
    await user.click(screen.getByRole("button", { name: /Coverage targets/ }));
    expect(screen.getByRole("heading", { name: "Coverage targets", level: 1 })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "School week" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByRole("heading", { name: "Edit timetable" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Monday, 1 period/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("saves changes from a tappable period row", async () => {
    const user = userEvent.setup();
    const props = show({}, "/principal/timetable/weekly?day=1");
    await user.click(screen.getByRole("button", { name: "Edit period 1, Mathematics" }));
    await user.clear(screen.getByLabelText("Room"));
    await user.type(screen.getByLabelText("Room"), "205");
    await user.click(screen.getByRole("button", { name: "Save period" }));
    expect(props.onUpdate).toHaveBeenCalledWith("slot-1", expect.objectContaining({ room: "205", weekday: 1, term_id: "term-1", class_section_id: "class-1" }));
    expect(screen.getByRole("status")).toHaveTextContent("Period updated.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the period editor and user input on save failure", async () => {
    const user = userEvent.setup();
    show({ onUpdate: vi.fn().mockRejectedValue(new Error("This teacher is already assigned.")) }, "/principal/timetable/weekly?day=1");
    await user.click(screen.getByRole("button", { name: "Edit period 1, Mathematics" }));
    await user.click(screen.getByRole("button", { name: "Save period" }));
    expect(screen.getByRole("alert")).toHaveTextContent("This teacher is already assigned.");
    expect(screen.getByRole("dialog", { name: "Edit period" })).toBeVisible();
  });

  it("offers no unusable editing action before classes exist", () => {
    show({ data: { ...data, classes: [] } });
    expect(screen.getByRole("heading", { name: "No classes yet" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add period" })).not.toBeInTheDocument();
  });

  it("creates a period in the chosen weekday and class", async () => {
    const user = userEvent.setup();
    const props = show({}, "/principal/timetable/weekly?day=2");
    await user.click(screen.getByRole("button", { name: "Add period" }));
    await user.selectOptions(screen.getByLabelText("Subject"), "subject-1");
    await user.click(screen.getByRole("button", { name: "Save period" }));
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ weekday: 2, class_section_id: "class-1", subject_id: "subject-1", term_id: "term-1" }));
    expect(screen.getByRole("status")).toHaveTextContent("Period added.");
  });

  it("requires confirmation to remove a repeating period", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const props = show({}, "/principal/timetable/weekly?day=1");
      await user.click(screen.getByRole("button", { name: "Edit period 1, Mathematics" }));
      await user.click(screen.getByRole("button", { name: "Remove", exact: true }));
      expect(confirm).toHaveBeenCalledWith("Remove this period from the repeating timetable?");
      expect(props.onDelete).toHaveBeenCalledWith("slot-1");
      expect(screen.getByRole("status")).toHaveTextContent("Period removed.");
    } finally { confirm.mockRestore(); }
  });

  it("keeps keyboard focus in the editor and restores it when dismissed", async () => {
    const user = userEvent.setup();
    show({}, "/principal/timetable/weekly?day=1");
    const row = screen.getByRole("button", { name: "Edit period 1, Mathematics" });
    await user.click(row);
    expect(screen.getByRole("button", { name: "Close period editor" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Save period" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });

  it("shows real allocation conflicts on the class, weekday and period", () => {
    show({ data: { ...data, conflicts: [{ first_slot_id: "slot-1", second_slot_id: "other-slot", weekday: 1, starts_at: "09:00:00", ends_at: "09:45:00", type: "teacher" }] } }, "/principal/timetable/weekly?day=1");
    expect(screen.getByRole("option", { name: "Class 7A · Conflicts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Monday, 1 period, conflicts need review/ })).toBeVisible();
    expect(screen.getByText("Allocation conflict")).toBeVisible();
  });

  it("switches class without showing the previous class's periods", async () => {
    const user = userEvent.setup();
    show({ data: { ...data, classes: [...data.classes, { ...data.classes[0]!, id: "class-2", name: "Class 7B" }] } }, "/principal/timetable/weekly?day=1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Class" }), "class-2");
    expect(screen.getByRole("heading", { name: "No periods yet" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit period 1, Mathematics" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Monday, 0 periods/ })).toHaveAttribute("aria-pressed", "true");
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
