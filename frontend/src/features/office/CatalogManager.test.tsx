import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogManager } from "./CatalogManager";
import { saveCatalog, type Administration } from "./api";

vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(),
  saveCatalog: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const administration = (): Administration => ({
  school: { id: "school-1", name: "Cambridge International School", code: "CIS" },
  students: [],
  terms: [{
    id: "term-1", name: "Term 1", academic_year: "2026-27", starts_on: "2026-07-01", ends_on: "2026-12-20",
    attendance_threshold: "85.00", is_active: true, revision: 1, updated_at: "2026-07-01T00:00:00Z", updated_by: null,
    enrollment_count: 25, timetable_count: 48, register_count: 32,
  }],
  classes: [{
    id: "class-7a", grade: "7", section: "A", academic_year: "2026-27", board: "CBSE", room_number: "204",
    revision: 3, updated_at: "2026-09-01T00:00:00Z", updated_by: null,
    enrollment_count: 25, timetable_count: 48, assignment_count: 8,
  }],
  subjects: [{
    id: "subject-math", code: "MATH", name: "Mathematics", short_name: "Maths", color: "#1D4ED8", icon: "calculator",
    revision: 2, updated_at: "2026-09-01T00:00:00Z", updated_by: null,
    timetable_count: 0, attendance_count: 0, diary_count: 0, day_plan_count: 0,
  }],
  members: [], invitations: [], grants: [], audit: [],
});

describe("school catalogue management", () => {
  it("opens linked class editing in a focused sheet and requires reviewed impact before persisting", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(saveCatalog).mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(<CatalogManager schoolId="school-1" data={administration()} refresh={refresh} />);

    await user.click(screen.getByRole("tab", { name: /Classes/ }));
    await user.click(screen.getByRole("button", { name: "Edit Class 7A" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Class 7A" });
    expect(within(dialog).getByRole("heading", { name: "Edit Class 7A" })).toHaveFocus();
    expect(within(dialog).getByText("81 linked records")).toBeVisible();
    expect(within(dialog).getByText("25 enrolments")).toBeVisible();

    const room = within(dialog).getByLabelText("Home room");
    await user.clear(room);
    await user.type(room, "205");
    await user.type(within(dialog).getByLabelText("Reason for change"), "Reviewed room allocation");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(saveCatalog).toHaveBeenCalledWith("school-1", "classes", expect.objectContaining({
      academic_year: "2026-27",
      grade: "7",
      section: "A",
      board: "CBSE",
      room_number: "205",
      expected_revision: 3,
      confirmed: true,
      change_reason: "Reviewed room allocation",
    }), "class-7a"));
    expect(refresh).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("Class 7A updated.");
  });

  it("persists subject color and icon as real catalogue fields", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(saveCatalog).mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(<CatalogManager schoolId="school-1" data={administration()} refresh={refresh} />);

    await user.click(screen.getByRole("tab", { name: /Subjects/ }));
    await user.click(screen.getByRole("button", { name: "Edit Mathematics" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Mathematics" });
    await user.selectOptions(within(dialog).getByLabelText("Timetable icon"), "flask-conical");
    fireEvent.input(within(dialog).getByLabelText("Subject color"), { target: { value: "#0F766E" } });
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(saveCatalog).toHaveBeenCalledWith("school-1", "subjects", expect.objectContaining({
      code: "MATH",
      color: "#0f766e",
      icon: "flask-conical",
      expected_revision: 2,
      confirmed: true,
    }), "subject-math"));
  });

  it("keeps a stale edit open and shows the server conflict without losing entered values", async () => {
    vi.mocked(saveCatalog).mockRejectedValue(new Error("This class changed after you opened it. Refresh and review the latest values."));
    const user = userEvent.setup();
    render(<CatalogManager schoolId="school-1" data={administration()} refresh={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: /Classes/ }));
    await user.click(screen.getByRole("button", { name: "Edit Class 7A" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Class 7A" });
    const room = within(dialog).getByLabelText("Home room");
    await user.clear(room);
    await user.type(room, "206");
    await user.type(within(dialog).getByLabelText("Reason for change"), "Reviewed room allocation");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("changed after you opened it");
    expect(room).toHaveValue("206");
    expect(screen.getByRole("dialog", { name: "Edit Class 7A" })).toBeVisible();
  });
});
