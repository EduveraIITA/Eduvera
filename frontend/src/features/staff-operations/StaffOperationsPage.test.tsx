import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { StaffOperationsPage } from "./StaffOperationsPage";
import { saveCoveragePolicy, type AdminStaffWorkspace, type CoverageTask, type ResponsibilityAssignment, type StaffLeaveRequest, type StaffProfile, type TeacherStaffWorkspace } from "./api";
import { saveAccessRole, assignAccessRole, type AccessRole, type RoleOptions, type RoleAssignment } from "./access-api";
vi.mock("./access-api", async (original) => ({...(await original<typeof import("./access-api")>()),saveAccessRole:vi.fn(),assignAccessRole:vi.fn()}));
vi.mock("./api", async (original) => ({...(await original<typeof import("./api")>()),saveCoveragePolicy:vi.fn()}));
vi.mock("../attention/AttentionOpenAcknowledgement",()=>({AttentionOpenAcknowledgement:()=> <output data-testid="attention-opened"/>}));

vi.mock("../roles/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../roles/api")>()), getRoles: vi.fn(), assignProfiles: vi.fn() }));

const profile: StaffProfile = {
  id: "profile-1", user_id: "teacher-1", staff_code: "T-001", first_name: "Kavita", last_name: "Mehta",
  email: "kavita@example.test", phone: "", staff_kind: "teaching", designation: "Mathematics teacher",
  department: "Secondary", employment_type: "full_time", joined_on: "2026-04-01", status: "active", revision: 1,
  onboarding_total: 5, onboarding_complete: 5, pending_requests: 1,
};
const policy = { id: "policy-1", academic_year: "2026-27", code: "CASUAL", name: "Casual leave", annual_allowance: "12.00", carry_forward_limit: "0.00", requires_document_after_days: null, is_paid: true, is_statutory: false, is_active: true, revision: 1 };
const balance = { staff_profile_id: profile.id, policy_id: policy.id, code: policy.code, name: policy.name, annual_allowance: policy.annual_allowance, adjustments: "0", used: "2", pending: "1", is_paid: true, is_statutory: false };
const request: StaffLeaveRequest = { id: "request-1", staff_profile_id: profile.id, policy_id: policy.id, policy_name: policy.name, policy_code: policy.code, first_name: profile.first_name, last_name: profile.last_name, staff_code: profile.staff_code, designation: profile.designation, starts_on: "2026-10-05", ends_on: "2026-10-05", portion: "full_day", requested_days: "1", reason: "Family medical appointment", handover_note: "Period 2 needs cover", status: "submitted", revision: 1, decision_note: "", submitted_at: "2026-10-03T08:00:00Z", affected_periods: 2 };
const responsibilityType = { id: "type-1", code: "event_judge", name: "Event judge", category: "event" as const, scope_kind: "event" as const, workflow_family: "event_judge", source_kind: "system" as const, cloned_from_type_id: null, description: "Judge a school event", access_summary: "Only the assigned event and rubric.", requires_acceptance: true, restricted: true, is_active: true, revision: 1, active_assignment_count: 1 };
const accessRole:AccessRole={id:"class-role",name:"Class teacher",description:"",context_kind:"class",permissions:["attendance.view","attendance.record"],source_kind:"system",is_active:true,revision:1,assignment_count:1};
const roleOptions:RoleOptions={contexts:[{code:"class",label:"Class",permissions:["attendance.view","attendance.record"]},{code:"event",label:"Event",permissions:["events.view"]}],permissions:[{code:"attendance.view",group:"Attendance",label:"View assigned registers",description:""},{code:"attendance.record",group:"Attendance",label:"Record attendance",description:""},{code:"events.view",group:"Events",label:"View assigned events",description:""}],prerequisites:{"attendance.record":["attendance.view"]}};
const roleAssignment:RoleAssignment={source_id:"event-1",source_kind:"event_assignment",staff_profile_id:profile.id,user_id:"teacher-1",role_id:"event-role",role_name:"Event judge",context_kind:"event",scope_id:"event-1",scope_label:"Inter-house debate",subject_name:null,permissions:["events.view"],starts_on:"2026-10-01",ends_on:null,status:"active",display_status:"active",revision:1};
const assignment: ResponsibilityAssignment = { id: "assignment-1", responsibility_type_id: responsibilityType.id, staff_profile_id: profile.id, type_code: responsibilityType.code, type_name: responsibilityType.name, category: responsibilityType.category, scope_kind: responsibilityType.scope_kind, first_name: profile.first_name, last_name: profile.last_name, staff_code: profile.staff_code, designation: profile.designation, user_id: profile.user_id, class_section_id: null, subject_id: null, event_id: "event-1", class_name: null, subject_name: null, event_title: "Inter-house debate", scope_label: "", location: "Auditorium", starts_on: "2026-10-10", ends_on: "2026-10-10", starts_at: null, ends_at: null, status: "offered", notes: "Use the published rubric.", response_note: "", access_summary: responsibilityType.access_summary, restricted: true, revision: 1 };
const coverage: CoverageTask = { id: "coverage-1", leave_request_id: request.id, absent_staff_profile_id: profile.id, replacement_staff_profile_id: null, absent_first_name: profile.first_name, absent_last_name: profile.last_name, absent_designation: profile.designation, replacement_first_name: null, replacement_last_name: null, replacement_user_id: null, class_name: "Class 7A", subject_name: "Mathematics", duty_date: "2026-10-05", period_number: 2, starts_at: "09:50", ends_at: "10:35", title: "Period 2 mathematics", location: "Room 204", status: "open", handover_note: "Continue fractions", response_note: "", revision: 1 };

function renderPage(data: AdminStaffWorkspace | TeacherStaffWorkspace, portal: "principal" | "teacher", staffProfileId?: string, path = "/") {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><StaffOperationsPage portal={portal} teacherView={path.startsWith("/teacher/responsibilities")?"responsibilities":"leave"} staffProfileId={staffProfileId} schoolId="school-1" schoolName="Cambridge International School" data={data} refresh={vi.fn().mockResolvedValue(undefined)} /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => undefined);
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("StaffOperationsPage", () => {
  it("gives the teacher balances, request history and an application form", async () => {
    const data: TeacherStaffWorkspace = { mode: "staff", academic_year: "2026-27", profile, policies: [policy], balances: [balance], requests: [request], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [] };
    renderPage(data, "teacher");
    expect(screen.getByText("10 days available · 2026-27")).toBeVisible();
    expect(document.querySelector(".staff-hero")).toBeNull();
    expect(screen.getByText("Family medical appointment")).toBeVisible();
    await userEvent.setup().click(screen.getByRole('link',{name:'Balances'}));
    expect(screen.getByText("2 used · 1 pending · 12 total")).toBeVisible();
    expect(screen.queryByText('Family medical appointment')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Apply for leave" }));
    expect(screen.getByRole("heading", { name: "Apply for leave" })).toBeVisible();
    expect(screen.getByLabelText("Handover note")).toBeVisible();
    expect(screen.queryByRole('navigation',{name:'Leave sections'})).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button',{name:'Cancel'}));
    expect(screen.getByRole('link',{name:'Balances'})).toHaveAttribute('aria-current','page');
    await userEvent.setup().click(screen.getByRole('link',{name:'Requests'}));
    expect(screen.getByText('Family medical appointment')).toBeVisible();
  });

  it("opens people from the directory in a separate staff profile route", async () => {
    const data: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [{ id: "item-1", staff_profile_id: profile.id, item_key: "identity", label: "Identity verified", required: true, completed_at: "2026-04-01T00:00:00Z", note: "" }], policies: [policy], balances: [balance], requests: [request], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [], references: { classes: [], subjects: [], events: [] } };
    renderPage(data, "principal");
    expect(screen.getByText("1 active staff")).toBeVisible();
    expect(screen.queryByText("STAFF SETUP")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Staff directory" })).not.toBeInTheDocument();
    expect(document.querySelector(".staff-hero")).toBeNull();
    expect(screen.queryByText("Identity verified")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Kavita Mehta staff profile" })).toHaveAttribute("href", "/principal/staff/profile-1");
    await userEvent.setup().click(screen.getByRole("button", { name: /Leave/ }));
    expect(screen.getByText("2 classes or shifts")).toBeVisible();
    expect(screen.getByText(/need coverage if approved/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Leave requests" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Leave coverage" })).toBeVisible();
    expect(screen.queryByText("APPROVAL QUEUE")).not.toBeInTheDocument();
    expect(screen.queryByText("LEAVE COVER")).not.toBeInTheDocument();

    cleanup();
    renderPage(data, "principal", profile.id);
    expect(screen.getByRole("heading", { name: "Staff profile" })).toBeVisible();
    expect(screen.getByText("Onboarding complete")).toBeVisible();
    expect(screen.getByText("Identity verified")).not.toBeVisible();
    await userEvent.setup().click(screen.getByText("Onboarding complete"));
    expect(screen.getByText("Identity verified")).toBeVisible();
    expect(screen.getByRole("button", { name: "Go back" })).toBeVisible();

    cleanup();
    renderPage({ ...data, onboarding_items: [{ ...data.onboarding_items[0], completed_at: null }] }, "principal", profile.id);
    expect(screen.getByRole("heading", { name: "0 of 1 complete" })).toBeVisible();
    expect(screen.getByText("Identity verified")).toBeVisible();
    expect(screen.queryByText("Onboarding complete")).not.toBeInTheDocument();
  });

  it("creates a genuine role with selected actions instead of a work-type workflow alias", async () => {
    const data: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [policy], balances: [balance], requests: [], work_types: [responsibilityType], responsibility_types: [responsibilityType], assignments: [], coverage_tasks: [], references: { classes: [], subjects: [], events: [] } };
    renderPage({...data,access_roles:[accessRole],role_options:roleOptions}, "principal");
    const user=userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Roles" }));
    expect(screen.getByRole("heading", { name: "Roles & access" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /New role/ }));
    expect(screen.getByRole("heading", { name: "Create role" })).toBeVisible();
    expect(screen.queryByLabelText("Workflow")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Role name"),"Class mentor");
    await user.click(screen.getByLabelText("Record attendance"));
    expect(screen.getByLabelText("View assigned registers")).toBeChecked();
    await user.click(screen.getByRole("button",{name:"Save role"}));
    expect(saveAccessRole).toHaveBeenCalledWith("school-1",expect.objectContaining({name:"Class mentor",context_kind:"class",template_id:null}),undefined);
    expect(vi.mocked(saveAccessRole).mock.calls[0]?.[1].permissions).toEqual(expect.arrayContaining(["attendance.view","attendance.record"]));
  });

  it("shows scoped responsibility offers to staff and on the selected staff record", async () => {
    const teacher: TeacherStaffWorkspace = { mode: "staff", academic_year: "2026-27", profile, policies: [policy], balances: [balance], requests: [], work_types: [responsibilityType], responsibility_types: [responsibilityType], assignments: [assignment], coverage_tasks: [] };
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><StaffOperationsPage portal="teacher" teacherView="responsibilities" schoolId="school-1" schoolName="Cambridge International School" data={teacher} refresh={vi.fn().mockResolvedValue(undefined)} /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "My work", level: 1 })).toBeVisible();
    expect(screen.getByText("Inter-house debate · 10 Oct 2026")).toBeVisible();
    expect(screen.getByRole("button", { name: "Accept" })).toBeVisible();
    cleanup();
    const principal: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [policy], balances: [balance], requests: [], work_types: [responsibilityType], responsibility_types: [responsibilityType], assignments: [assignment], coverage_tasks: [], references: { classes: [], subjects: [], events: [{ id: "event-1", title: "Inter-house debate", starts_at: "2026-10-10T09:00:00Z", ends_at: "2026-10-10T12:00:00Z" }] } };
    renderPage({...principal,role_assignments:[roleAssignment],role_options:roleOptions}, "principal", profile.id);
    expect(screen.getByText("Event judge")).toBeVisible();
    await userEvent.setup().click(screen.getByLabelText("Event judge, 1 assignment"));
    expect(screen.getByText("Inter-house debate")).toBeVisible();
    expect(screen.getByRole("link",{name:"Open work: Inter-house debate"})).toHaveAttribute("href","/principal/events/event-1");
  });

  it("consumes an assignment link on the selected staff profile", async () => {
    const principal: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [], balances: [], requests: [], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [], references: { classes: [], subjects: [], events: [] }, access_roles: [accessRole], role_options: roleOptions, role_assignments: [roleAssignment] };
    renderPage(principal,"principal",profile.id,"/principal/staff/profile-1?assignment=event-1");
    const target=document.getElementById("attention-staff-assignment-event-1");
    expect(target).toHaveClass("is-attention-target");
    expect(screen.getByText("Inter-house debate")).toBeVisible();
    await waitFor(()=>expect(target).toHaveFocus());
  });

  it("opens the leave workspace and focuses the exact cover gap", async () => {
    const principal: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [policy], balances: [balance], requests: [], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [coverage], references: { classes: [], subjects: [], events: [] } };
    renderPage(principal, "principal", undefined, "/principal/staff?coverage=coverage-1");
    expect(screen.getByRole("heading", { name: "Leave coverage" })).toBeVisible();
    expect(screen.getByLabelText("Cover teacher for Period 2 mathematics")).toBeVisible();
    const target = document.getElementById("attention-coverage-1");
    expect(target).toHaveClass("attention-focus");
    await waitFor(() => expect(target).toHaveFocus());
  });

  it("configures a bounded automatic cover fallback", async () => {
    vi.mocked(saveCoveragePolicy).mockResolvedValue({
      school_id:"school-1",enabled:true,deadline_minutes_before:30,fallback_kind:"physical_activity",
      fallback_label:"Games period",supervisor_staff_profile_id:profile.id,supervisor_first_name:"Kavita",supervisor_last_name:"Mehta",revision:2,
    });
    const principal: AdminStaffWorkspace = {
      mode:"admin",academic_year:"2026-27",profiles:[profile],onboarding_items:[],policies:[policy],balances:[balance],requests:[],
      work_types:[],responsibility_types:[],assignments:[],coverage_tasks:[],references:{classes:[],subjects:[],events:[]},
      coverage_policy:{school_id:"school-1",enabled:false,deadline_minutes_before:30,fallback_kind:"independent_study",fallback_label:"Independent study",supervisor_staff_profile_id:null,supervisor_first_name:null,supervisor_last_name:null,revision:1},
    };
    renderPage(principal,"principal",undefined,"/principal/staff?section=policies");
    const user=userEvent.setup();
    expect(screen.getByRole("heading",{name:"Deadline fallback"})).toBeVisible();
    await user.click(screen.getByLabelText("Enabled"));
    await user.selectOptions(screen.getByLabelText("Fallback"),"physical_activity");
    await user.clear(screen.getByLabelText("Name shown to staff"));
    await user.type(screen.getByLabelText("Name shown to staff"),"Games period");
    await user.selectOptions(screen.getByLabelText("Responsible staff (optional)"),profile.id);
    await user.click(screen.getByRole("button",{name:"Save fallback"}));
    await waitFor(()=>expect(saveCoveragePolicy).toHaveBeenCalledWith("school-1",expect.objectContaining({
      enabled:true,deadline_minutes_before:30,fallback_kind:"physical_activity",fallback_label:"Games period",
      supervisor_staff_profile_id:profile.id,expected_revision:1,
    })));
  });

  it("keeps past resolved cover out of the live queue", () => {
    const expired: CoverageTask={...coverage,status:"expired_unconfirmed",revision:2,fallback_kind:"unconfirmed",fallback_label:"Period ended without a recorded cover outcome",resolved_at:"2026-10-05T11:00:00Z"};
    const principal: AdminStaffWorkspace={mode:"admin",academic_year:"2026-27",profiles:[profile],onboarding_items:[],policies:[policy],balances:[balance],requests:[],work_types:[],responsibility_types:[],assignments:[],coverage_tasks:[expired],references:{classes:[],subjects:[],events:[]}};
    renderPage(principal,"principal",undefined,"/principal/staff?section=leave");
    expect(screen.getByRole("heading",{name:"Leave coverage"})).toBeVisible();
    expect(screen.getByText("0 open")).toBeVisible();
    expect(screen.queryByText("Recent automatic outcomes")).not.toBeInTheDocument();
    expect(screen.queryByText("No outcome recorded")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cover teacher for Period 2 mathematics")).not.toBeInTheDocument();
  });

  it("keeps decided leave compact until its decision is opened", async () => {
    const decided: StaffLeaveRequest={
      ...request,status:"approved",revision:2,coverage_tasks:6,coverage_open:0,
      coverage_fallback:6,coverage_filled:0,coverage_expired:0,
      coverage_fallback_labels:"Independent study",
    };
    const principal: AdminStaffWorkspace={mode:"admin",academic_year:"2026-27",profiles:[profile],onboarding_items:[],policies:[policy],balances:[balance],requests:[decided],work_types:[],responsibility_types:[],assignments:[],coverage_tasks:[],references:{classes:[],subjects:[],events:[]}};
    renderPage(principal,"principal",undefined,"/principal/staff?section=leave");
    expect(screen.getByText("0 pending")).toBeVisible();
    expect(screen.getByText("Fallback · Independent study")).not.toBeVisible();
    const summary=screen.getByText("Kavita Mehta").closest("summary");
    expect(summary).not.toBeNull();
    await userEvent.setup().click(summary!);
    expect(screen.getByText("Fallback · Independent study")).toBeVisible();
    expect(screen.queryByText(/still need cover/i)).not.toBeInTheDocument();
  });

  it("acknowledges a responsibility alert only at its exact authoritative revision", () => {
    const teacher: TeacherStaffWorkspace = { mode: "staff", academic_year: "2026-27", profile, policies: [], balances: [], requests: [], work_types: [responsibilityType], responsibility_types: [responsibilityType], assignments: [assignment], coverage_tasks: [] };
    renderPage(teacher,"teacher",undefined,"/teacher/responsibilities?assignment=assignment-1&assignment_revision=1&attention_notification_id=10000000-0000-4000-a000-000000000001");
    expect(screen.getByTestId("attention-opened")).toBeInTheDocument();
    expect(screen.queryByText(/changed after the alert/i)).not.toBeInTheDocument();

    cleanup();
    renderPage(teacher,"teacher",undefined,"/teacher/responsibilities?assignment=assignment-1&assignment_revision=2&attention_notification_id=10000000-0000-4000-a000-000000000001");
    expect(screen.queryByTestId("attention-opened")).not.toBeInTheDocument();
    expect(screen.getByText(/changed after the alert/i)).toBeVisible();
  });

  it("keeps revoked work exact and removes completed cover decisions from the live queue", () => {
    const revoked={...assignment,status:"revoked" as const,revision:2,revocation_reason:"Event staffing changed."};
    const teacher: TeacherStaffWorkspace = { mode: "staff", academic_year: "2026-27", profile, policies: [], balances: [], requests: [], work_types: [responsibilityType], responsibility_types: [responsibilityType], assignments: [revoked], coverage_tasks: [] };
    renderPage(teacher,"teacher",undefined,"/teacher/responsibilities?assignment=assignment-1&assignment_revision=2&attention_notification_id=10000000-0000-4000-a000-000000000001");
    expect(screen.getByTestId("attention-opened")).toBeInTheDocument();
    expect(screen.getByText("Event staffing changed.")).toBeVisible();

    cleanup();
    const decidedCoverage={...coverage,status:"accepted" as const,revision:2,replacement_staff_profile_id:profile.id,replacement_user_id:profile.user_id,replacement_first_name:profile.first_name,replacement_last_name:profile.last_name};
    const principal: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [], balances: [], requests: [], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [decidedCoverage], references: { classes: [], subjects: [], events: [] } };
    renderPage(principal,"principal",undefined,"/principal/staff?section=leave&coverage=coverage-1&coverage_revision=2&attention_notification_id=10000000-0000-4000-a000-000000000001");
    expect(screen.getByTestId("attention-opened")).toBeInTheDocument();
    expect(screen.getByText("Cover duty resolved")).toBeVisible();
    expect(screen.queryByText("accepted")).not.toBeInTheDocument();
  });

  it("acknowledges the principal's exact responsibility response", () => {
    const accepted={...assignment,status:"active" as const,revision:2,response_note:"Confirmed"};
    const projected:RoleAssignment={...roleAssignment,source_id:assignment.id,source_kind:"assignment",role_id:responsibilityType.id,role_name:responsibilityType.name,revision:2};
    const principal: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [], balances: [], requests: [], work_types: [responsibilityType], responsibility_types: [responsibilityType], assignments: [accepted], coverage_tasks: [], references: { classes: [], subjects: [], events: [] }, role_assignments:[projected], access_roles:[accessRole], role_options:roleOptions };
    renderPage(principal,"principal",profile.id,"/principal/staff/profile-1?assignment=assignment-1&assignment_revision=2&attention_notification_id=10000000-0000-4000-a000-000000000001");
    expect(screen.getByTestId("attention-opened")).toBeInTheDocument();
  });

  it("acknowledges an exact leave-review alert but not a later revision", () => {
    const principal: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [policy], balances: [balance], requests: [request], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [], references: { classes: [], subjects: [], events: [] } };
    renderPage(principal,"principal",undefined,"/principal/staff?section=leave&request=request-1&request_revision=1&attention_notification_id=10000000-0000-4000-a000-000000000001");
    expect(screen.getByTestId("attention-opened")).toBeInTheDocument();
    cleanup();
    renderPage(principal,"principal",undefined,"/principal/staff?section=leave&request=request-1&request_revision=2&attention_notification_id=10000000-0000-4000-a000-000000000001");
    expect(screen.queryByTestId("attention-opened")).not.toBeInTheDocument();
    expect(screen.getByText(/changed after the alert/i)).toBeVisible();
  });

  it("acknowledges the staff member's exact leave decision", () => {
    const decided={...request,status:"approved" as const,revision:2,decision_note:"Approved with cover."};
    const teacher: TeacherStaffWorkspace = { mode: "staff", academic_year: "2026-27", profile, policies: [policy], balances: [balance], requests: [decided], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [] };
    renderPage(teacher,"teacher",undefined,"/teacher/leave?request=request-1&request_revision=2&attention_notification_id=10000000-0000-4000-a000-000000000001");
    expect(screen.getByTestId("attention-opened")).toBeInTheDocument();
    expect(screen.getByText("Approved with cover.")).toBeVisible();
  });

  it("assigns a role directly to a class and directs exam and journey staffing to their planning screens", async () => {
    const principal: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [policy], balances: [balance], requests: [], work_types: [responsibilityType], responsibility_types: [responsibilityType], assignments: [], coverage_tasks: [], references: { classes: [], subjects: [], events: [{ id: "event-1", title: "Inter-house debate", starts_at: "2026-10-10T09:00:00Z", ends_at: "2026-10-10T12:00:00Z" }] } };
    renderPage({...principal,access_roles:[accessRole],role_options:roleOptions,references:{...principal.references,classes:[{id:"class-7a",name:"Class 7A"}]}}, "principal", profile.id);
    const user=userEvent.setup();
    expect(screen.getByRole("link",{name:"Journey roster"})).toHaveAttribute("href","/principal/departure");
    await user.click(screen.getByRole("button", { name: "Assign role" }));
    expect(screen.getByRole("heading", { name: "Assign role · Kavita" })).toBeVisible();
    expect(screen.getByLabelText("Role")).toHaveValue(accessRole.id);
    await user.selectOptions(screen.getByLabelText("Class"),"class-7a");
    expect(screen.queryByText(/eligible role/i)).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button",{name:"Assign role"}).at(-1)!);
    expect(assignAccessRole).toHaveBeenCalledWith("school-1",expect.objectContaining({role_id:accessRole.id,staff_profile_id:profile.id,scope_id:"class-7a",subject_id:null}));
  });

  it("requires review of assignment impact when a custom role's actions change",async()=>{
    const data:AdminStaffWorkspace={mode:"admin",academic_year:"2026-27",profiles:[profile],onboarding_items:[],policies:[],balances:[],requests:[],work_types:[],responsibility_types:[],assignments:[],coverage_tasks:[],references:{classes:[],subjects:[],events:[]},access_roles:[{...accessRole,name:"Class mentor",source_kind:"institute",revision:3,assignment_count:2}],role_options:roleOptions};
    renderPage(data,"principal");const user=userEvent.setup();
    await user.click(screen.getByRole("button",{name:"Roles"}));await user.click(screen.getByRole("button",{name:"Edit Class mentor"}));
    await user.click(screen.getByLabelText("Record attendance"));
    expect(screen.getByRole("button",{name:"Save role"})).toBeDisabled();
    await user.click(screen.getByLabelText("Apply these access changes to 2 existing assignments."));
    await user.click(screen.getByRole("button",{name:"Save role"}));
    expect(saveAccessRole).toHaveBeenCalledWith("school-1",expect.objectContaining({permissions:["attendance.view"],expected_revision:3,expected_assignment_count:2}),accessRole.id);
  });

  it("preselects an unassigned role from the overview without changing existing assignments", async () => {
    const reviewer: AccessRole = { ...accessRole, id: "reviewer", name: "Attendance reviewer", source_kind: "institute", permissions: ["attendance.view"], assignment_count: 0 };
    const data: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [], balances: [], requests: [], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [], references: { classes: [{ id: "class-7a", name: "Class 7A" }], subjects: [], events: [] }, access_roles: [accessRole, reviewer], role_options: roleOptions, role_assignments: [{ ...roleAssignment, role_id: accessRole.id, role_name: accessRole.name, context_kind: "class", scope_label: "Class 6A" }] };
    renderPage(data, "principal", profile.id);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Not assigned 1" }));
    await user.click(screen.getByRole("button", { name: "Assign Attendance reviewer" }));
    expect(screen.getByLabelText("Role")).toHaveValue(reviewer.id);
    expect(assignAccessRole).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("Class"), "class-7a");
    await user.click(screen.getAllByRole("button", { name: "Assign role" }).at(-1)!);
    expect(assignAccessRole).toHaveBeenCalledWith("school-1", expect.objectContaining({ role_id: reviewer.id, staff_profile_id: profile.id, scope_id: "class-7a" }));
  });
});
