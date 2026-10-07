import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AccessRole, RoleAssignment, RoleOptions } from "./access-api";
import { StaffAssignmentOverview } from "./StaffAssignmentOverview";

const examiner: AccessRole = { id: "examiner", name: "Internal examiner", context_kind: "assessment", description: "", permissions: ["assessments.view", "assessments.mark"], source_kind: "system", is_active: true, revision: 1, assignment_count: 12 };
const teacher: AccessRole = { ...examiner, id: "teacher", name: "Class teacher", context_kind: "class", permissions: ["attendance.view"] };
const attendant: AccessRole = { ...examiner, id: "attendant", name: "Transport attendant", context_kind: "trip", permissions: ["departure.collect"] };
const reviewer: AccessRole = { ...teacher, id: "reviewer", name: "Attendance reviewer", source_kind: "institute" };
const options: RoleOptions = { contexts: [], permissions: [{ code: "assessments.view", label: "View assigned assessments", group: "Assessment", description: "" }, { code: "assessments.mark", label: "Enter marks", group: "Assessment", description: "" }], prerequisites: {} };
function assignment(overrides: Partial<RoleAssignment> = {}): RoleAssignment {
  return { source_id: "exam-1", source_kind: "assessment_assignment", staff_profile_id: "kavita", user_id: "kavita-user", role_id: examiner.id, role_name: examiner.name, context_kind: "assessment", scope_id: "exam-1", scope_label: "English annual examination", subject_name: null, permissions: examiner.permissions, starts_on: "2026-10-07", ends_on: null, status: "active", display_status: "active", revision: 1, ...overrides };
}
function setup(assignments: RoleAssignment[], roles = [examiner, teacher, attendant, reviewer], canAssign = true) {
  const onAssign = vi.fn();
  const onManage = vi.fn();
  const view = render(<MemoryRouter><StaffAssignmentOverview assignments={assignments} roles={roles} options={options} canAssign={canAssign} onAssign={onAssign} onManage={onManage}/></MemoryRouter>);
  return { ...view, onAssign, onManage, user: userEvent.setup() };
}
afterEach(cleanup);

describe("staff assignment overview", () => {
  it("collapses repeated assignments into one role and prioritises class roles", async () => {
    const exams = Array.from({ length: 12 }, (_, i) => assignment({ source_id: `exam-${i}`, scope_id: `exam-${i}`, scope_label: `English class test ${i + 1}` }));
    const { container, user } = setup([...exams, assignment({ role_id: teacher.id, role_name: teacher.name, permissions: teacher.permissions, context_kind: "class", scope_label: "Class 7A", source_kind: "class_assignment", source_id: "class-7a" })]);
    expect(screen.getAllByText("Internal examiner")).toHaveLength(1);
    expect(container.querySelectorAll(".staff-assignment-group")).toHaveLength(2);
    expect(container.querySelector(".staff-assignment-group strong")).toHaveTextContent("Class teacher");
    expect(screen.getByRole("button", { name: "Assigned 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("English class test 1")).not.toBeVisible();
    await user.click(screen.getByLabelText("Internal examiner, 12 assignments"));
    expect(screen.getByText("English class test 1")).toBeVisible();
    expect(screen.getAllByText("Allowed actions")).toHaveLength(2);
    expect(screen.getByText("Enter marks")).not.toBeVisible();
    await user.click(screen.getAllByText("Allowed actions")[1]);
    expect(screen.getByText("Enter marks")).toBeVisible();
  });

  it("searches by role, class, exam and subject without showing unrelated assignments", async () => {
    const { user } = setup([assignment(), assignment({ source_id: "exam-2", scope_id: "exam-2", scope_label: "Science practical", subject_name: "Chemistry" })]);
    const search = screen.getByRole("searchbox", { name: "Search roles and assignments" });
    await user.type(search, "  CHEMISTRY science ");
    expect(screen.getByText("Science practical · Chemistry")).toBeVisible();
    expect(screen.queryByText("English annual examination")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 assigned role found.");
    await user.clear(search);
    await user.type(search, "examiner");
    expect(screen.getByText("Internal examiner")).toBeVisible();
    expect(screen.getByText("English annual examination")).not.toBeVisible();
  });

  it("makes missing roles explicit and keeps domain staffing in its own plan", async () => {
    const { user, onAssign } = setup([assignment()], [examiner, teacher, attendant, { ...reviewer, is_active: false }]);
    await user.click(screen.getByRole("button", { name: "Not assigned 2" }));
    expect(screen.queryByText("Internal examiner")).not.toBeInTheDocument();
    expect(screen.queryByText("Attendance reviewer")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Assign Class teacher" }));
    expect(onAssign).toHaveBeenCalledWith(teacher);
    expect(screen.getByRole("link", { name: "Journey roster: Transport attendant" })).toHaveAttribute("href", "/principal/departure");
    expect(screen.queryByRole("button", { name: "Assign Transport attendant" })).not.toBeInTheDocument();
  });

  it("separates history, preserves status, and never presents an ended grant as current", async () => {
    const old = assignment({ display_status: "revoked", status: "revoked", ends_on: "2026-10-08" });
    const { user } = setup([old]);
    expect(screen.getByRole("button", { name: "Assigned 0" })).toBeVisible();
    expect(screen.getByText("No roles assigned.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "History 1" }));
    await user.click(screen.getByLabelText("Internal examiner, 1 assignment"));
    expect(screen.getByText("revoked")).toBeVisible();
    expect(screen.getByText("7 Oct 2026 – 8 Oct 2026")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Manage assignment/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Allowed actions")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Not assigned 4" }));
    expect(screen.getByText("Internal examiner")).toBeVisible();
  });

  it("counts scheduled and offered assignments without calling them active", async () => {
    const { user } = setup([assignment({ display_status: "scheduled", starts_on: "2026-12-01" }), assignment({ source_id: "exam-2", scope_id: "exam-2", display_status: "offered", status: "offered" })]);
    expect(screen.getByText("1 scheduled · 1 awaiting response")).toBeVisible();
    expect(screen.queryByText(/\d+ active/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Not assigned 3" }));
    expect(screen.queryByText("Internal examiner")).not.toBeInTheDocument();
  });

  it("shows separate journey dates and acceptance instead of repeated multi-day active rows", async () => {
    const trips = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"].map((date) => assignment({
      source_id: `trip-${date}`, source_kind: "transport_trip", scope_id: `trip-${date}`,
      role_id: attendant.id, role_name: attendant.name, context_kind: "trip", permissions: attendant.permissions,
      scope_label: "South Bengaluru", starts_on: "2026-10-06", ends_on: date,
      trip_service_date: date, trip_departure_time: "15:30:00", trip_direction: "from_institution",
      trip_state: "planned", trip_assignment_status: "pending", trip_is_backup: false,
    }));
    const { user, onManage } = setup(trips, [attendant]);
    expect(screen.getByText("4 awaiting acceptance")).toBeVisible();
    await user.click(screen.getByLabelText("Transport attendant, 4 assignments"));
    expect(screen.getAllByText("Awaiting acceptance")).toHaveLength(4);
    expect(screen.getByRole("heading", { name: "Wed, 7 Oct 2026" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Sat, 10 Oct 2026" })).toBeVisible();
    expect(screen.getAllByText("South Bengaluru · 3:30 PM · From institution")).toHaveLength(4);
    expect(screen.queryByText("6 Oct 2026 – 10 Oct 2026")).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "10 Oct");
    expect(screen.getAllByText("South Bengaluru · 3:30 PM · From institution")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Wed, 7 Oct 2026" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage assignment: South Bengaluru, Sat, 10 Oct 2026 · 3:30 PM · From institution" }));
    expect(onManage).toHaveBeenCalledWith(trips[3]);
  });

  it("does not call a cancelled journey completed", async () => {
    const cancelled = assignment({ source_kind: "transport_trip", context_kind: "trip", role_id: attendant.id,
      role_name: attendant.name, trip_service_date: "2026-10-06", trip_state: "cancelled", display_status: "completed" });
    const { user } = setup([cancelled], [attendant]);
    await user.click(screen.getByRole("button", { name: "History 1" }));
    await user.click(screen.getByLabelText("Transport attendant, 1 assignment"));
    expect(screen.getByText("Cancelled")).toBeVisible();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("opens and manages the exact assignment within a role group", async () => {
    const first = assignment();
    const second = assignment({ source_id: "exam-2", scope_id: "exam-2", scope_label: "Hindi practical" });
    const { user, onManage } = setup([first, second]);
    await user.click(screen.getByLabelText("Internal examiner, 2 assignments"));
    await user.click(screen.getByRole("button", { name: "Manage assignment: Hindi practical" }));
    expect(onManage).toHaveBeenCalledWith(second);
    expect(screen.getByRole("link", { name: "Open work: Hindi practical" })).toHaveAttribute("href", "/principal/assessments?assessment=exam-2");
  });

  it("recovers from no search matches and disables direct grants for inactive staff", async () => {
    const { user } = setup([], [teacher], false);
    await user.type(screen.getByRole("searchbox"), "accountant");
    expect(screen.getByText("No matching roles or assignments.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Check unassigned roles" }));
    expect(screen.getByRole("searchbox")).toHaveValue("accountant");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("button", { name: "Assign Class teacher" })).toBeDisabled();
  });

  it("updates counts and unassigned roles when an assignment is revoked on refresh", async () => {
    const item = assignment();
    const { rerender, user } = setup([item], [examiner]);
    rerender(<MemoryRouter><StaffAssignmentOverview assignments={[{ ...item, display_status: "revoked" }]} roles={[examiner]} canAssign onAssign={vi.fn()} onManage={vi.fn()}/></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Assigned 0" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Not assigned 1" }));
    expect(within(screen.getByRole("group", { name: "Assignment view" })).getByRole("button", { name: "History 1" })).toBeVisible();
    expect(screen.getByText("Internal examiner")).toBeVisible();
  });
});
