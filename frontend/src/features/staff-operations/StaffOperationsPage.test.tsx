import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { StaffOperationsPage } from "./StaffOperationsPage";
import type { AdminStaffWorkspace, ResponsibilityAssignment, StaffLeaveRequest, StaffProfile, TeacherStaffWorkspace } from "./api";

const profile: StaffProfile = {
  id: "profile-1", user_id: "teacher-1", staff_code: "T-001", first_name: "Kavita", last_name: "Mehta",
  email: "kavita@example.test", phone: "", staff_kind: "teaching", designation: "Mathematics teacher",
  department: "Secondary", employment_type: "full_time", joined_on: "2026-04-01", status: "active", revision: 1,
  onboarding_total: 5, onboarding_complete: 5, pending_requests: 1,
};
const policy = { id: "policy-1", academic_year: "2026-27", code: "CASUAL", name: "Casual leave", annual_allowance: "12.00", carry_forward_limit: "0.00", requires_document_after_days: null, is_paid: true, is_statutory: false, is_active: true, revision: 1 };
const balance = { staff_profile_id: profile.id, policy_id: policy.id, code: policy.code, name: policy.name, annual_allowance: policy.annual_allowance, adjustments: "0", used: "2", pending: "1", is_paid: true, is_statutory: false };
const request: StaffLeaveRequest = { id: "request-1", staff_profile_id: profile.id, policy_id: policy.id, policy_name: policy.name, policy_code: policy.code, first_name: profile.first_name, last_name: profile.last_name, staff_code: profile.staff_code, designation: profile.designation, starts_on: "2026-10-05", ends_on: "2026-10-05", portion: "full_day", requested_days: "1", reason: "Family medical appointment", handover_note: "Period 2 needs cover", status: "submitted", revision: 1, decision_note: "", submitted_at: "2026-10-03T08:00:00Z", affected_periods: 2 };
const responsibilityType = { id: "type-1", code: "event_judge", name: "Event judge", category: "event" as const, scope_kind: "event" as const, description: "Judge a school event", access_summary: "Only the assigned event and rubric.", requires_acceptance: true, restricted: true };
const assignment: ResponsibilityAssignment = { id: "assignment-1", responsibility_type_id: responsibilityType.id, staff_profile_id: profile.id, type_code: responsibilityType.code, type_name: responsibilityType.name, category: responsibilityType.category, scope_kind: responsibilityType.scope_kind, first_name: profile.first_name, last_name: profile.last_name, staff_code: profile.staff_code, designation: profile.designation, user_id: profile.user_id, class_section_id: null, subject_id: null, event_id: "event-1", class_name: null, subject_name: null, event_title: "Inter-house debate", scope_label: "", location: "Auditorium", starts_on: "2026-10-10", ends_on: "2026-10-10", starts_at: null, ends_at: null, status: "offered", notes: "Use the published rubric.", response_note: "", access_summary: responsibilityType.access_summary, restricted: true, revision: 1 };

function renderPage(data: AdminStaffWorkspace | TeacherStaffWorkspace, portal: "principal" | "teacher") {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><StaffOperationsPage portal={portal} schoolId="school-1" schoolName="Cambridge International School" data={data} refresh={vi.fn().mockResolvedValue(undefined)} /></MemoryRouter></QueryClientProvider>);
}

afterEach(cleanup);

describe("StaffOperationsPage", () => {
  it("gives the teacher balances, request history and an application form", async () => {
    const data: TeacherStaffWorkspace = { mode: "staff", academic_year: "2026-27", profile, policies: [policy], balances: [balance], requests: [request], responsibility_types: [], assignments: [], coverage_tasks: [] };
    renderPage(data, "teacher");
    expect(screen.getByRole("heading", { name: "10 days available" })).toBeVisible();
    expect(screen.getByText("2 used · 1 pending · 12 total")).toBeVisible();
    expect(screen.getByText("Family medical appointment")).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Apply for leave" }));
    expect(screen.getByRole("heading", { name: "Apply for leave" })).toBeVisible();
    expect(screen.getByLabelText("Handover note")).toBeVisible();
  });

  it("shows principals onboarding, policy and timetable impact in one workspace", async () => {
    const data: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [{ id: "item-1", staff_profile_id: profile.id, item_key: "identity", label: "Identity verified", required: true, completed_at: "2026-04-01T00:00:00Z", note: "" }], policies: [policy], balances: [balance], requests: [request], responsibility_types: [], assignments: [], coverage_tasks: [], references: { classes: [], subjects: [], events: [] } };
    renderPage(data, "principal");
    expect(screen.getByRole("heading", { name: "1 active staff" })).toBeVisible();
    expect(screen.getByText("Identity verified")).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: /Leave/ }));
    expect(screen.getByText("2 duties")).toBeVisible();
    expect(screen.getByText(/need coverage if approved/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve" })).toBeVisible();
  });

  it("shows scoped duty offers to staff and the principal staffing board", async () => {
    const teacher: TeacherStaffWorkspace = { mode: "staff", academic_year: "2026-27", profile, policies: [policy], balances: [balance], requests: [], responsibility_types: [responsibilityType], assignments: [assignment], coverage_tasks: [] };
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><StaffOperationsPage portal="teacher" teacherView="responsibilities" schoolId="school-1" schoolName="Cambridge International School" data={teacher} refresh={vi.fn().mockResolvedValue(undefined)} /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "My responsibilities", level: 1 })).toBeVisible();
    expect(screen.getByText("Inter-house debate · 10 Oct 2026")).toBeVisible();
    expect(screen.getByRole("button", { name: "Accept" })).toBeVisible();
    cleanup();
    const principal: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [policy], balances: [balance], requests: [], responsibility_types: [responsibilityType], assignments: [assignment], coverage_tasks: [], references: { classes: [], subjects: [], events: [{ id: "event-1", title: "Inter-house debate", starts_at: "2026-10-10T09:00:00Z", ends_at: "2026-10-10T12:00:00Z" }] } };
    renderPage(principal, "principal");
    await userEvent.setup().click(screen.getByRole("button", { name: /Duties/ }));
    expect(screen.getByText("Staffing board")).toBeVisible();
    expect(screen.getByText("Event judge")).toBeVisible();
    expect(screen.getByText(/Restricted purpose/)).toBeVisible();
  });
});
