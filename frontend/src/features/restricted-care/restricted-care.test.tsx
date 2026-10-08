import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RestrictedCarePage } from "./RestrictedCarePage";
import type { CareCaseDetail, CareWorkspace } from "./api";
import * as api from "./api";
vi.mock('../auth/AuthContext',async original=>({...await original<typeof import('../auth/AuthContext')>(),useAuth:()=>({refresh:vi.fn().mockResolvedValue(undefined)})}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, getCareWorkspace: vi.fn(), getCareCase: vi.fn(), openCareCase: vi.fn(), actOnCareCase: vi.fn(), assignCareRole: vi.fn(), revokeCareRole: vi.fn() };
});

const workspace: CareWorkspace = {
  can_manage_team: true,
  routes: { primary: 1, alternate: 1 },
  legal_notice: "This workspace records restricted operational evidence.",
  candidates: [
    { id: "admin-1", name: "Meera Kapoor", email: "meera@example.test", role: "admin" },
    { id: "staff-1", name: "Kavita Mehta", email: "kavita@example.test", role: "staff" },
  ],
  eligible_students: [{ id: "student-1", name: "Aarav Sharma", admission_number: "CIS-2023-071" }],
  team: [{ id: "role-1", user_id: "admin-1", role_kind: "designated_lead", route_kind: "primary", valid_from: "2026-04-01", valid_until: null, status: "active", revision: 1, member_name: "Meera Kapoor", email: "meera@example.test", created_at: "2026-04-01T00:00:00Z" }],
  cases: [{ id: "case-1", student_id: "student-1", owner_user_id: "admin-1", intake_route: "primary", urgency: "urgent", concern_category: "physical_safety", safety_state: "actions_underway", status: "triage", reporting_state: "assessment_required", opened_at: "2026-10-04T08:00:00Z", last_activity_at: "2026-10-04T08:30:00Z", revision: 2, assignment_role: "owner", access_level: "full", subject_name: "Aarav Sharma", owner_name: "Meera Kapoor" }],
};
const detail: CareCaseDetail = {
  case: { ...workspace.cases[0]!, source_kind: "child_disclosure", ordinary_handler_involved: false, observed_at: null, admission_number: "CIS-2023-071", reporter_name: "Kavita Mehta" },
  access: { assignment_role: "owner", access_level: "full" },
  entries: [{ id: "entry-1", entry_type: "intake_note", note: "The child used exact words and immediate safety actions were started.", created_by: "staff-1", created_at: "2026-10-04T08:00:00Z" }],
  external_reports: [], audits: [],
};

function renderPage(portal: "principal" | "teacher" = "principal",search='') {
  vi.mocked(api.getCareWorkspace).mockResolvedValue(workspace);
  vi.mocked(api.getCareCase).mockResolvedValue(detail);
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={[`/${portal}/safeguarding${search}`]}><RestrictedCarePage portal={portal} schoolId="school-1" schoolName="Cambridge International School" /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("RestrictedCarePage", () => {
  it('gives a message report its own title and returns to the report queue',async()=>{
    vi.mocked(api.getCareWorkspace).mockResolvedValue(workspace);
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/principal/safeguarding?section=message_reports&report_status=resolved&report=report-1']}><RestrictedCarePage portal="principal" schoolId="school-1" messageReports={<div>Message report workspace</div>}/></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('heading',{name:'Message report',level:1})).toBeVisible();
    expect(screen.queryByRole('navigation',{name:'Restricted care sections'})).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button',{name:'Go back'}));
    expect(screen.getByRole('button',{name:'Message reports'})).toHaveAttribute('aria-current','page');
    expect(screen.getByText('Message report workspace')).toBeVisible();
  });
  it('restores a direct case link and preserves a return path when the case fails to load',async()=>{
    renderPage('teacher','?case=case-1');
    vi.mocked(api.getCareCase).mockRejectedValue(new Error('Case unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't sync this view.");
    expect(screen.queryByRole('navigation',{name:'Restricted care sections'})).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button',{name:'Go back'}));
    expect(await screen.findByRole('navigation',{name:'Restricted care sections'})).toBeVisible();
  });
  it("keeps emergency action and assigned-case limits explicit", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Student concerns", level: 1 })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Call 112" })).toHaveAttribute("href", "tel:112");
    expect(screen.getByText("Primary route · 1 available")).toBeVisible();
    expect(screen.getByText("Alternate route · 1 available")).toBeVisible();
    expect(screen.queryByText(/You only see cases explicitly assigned to you/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Aarav Sharma/ })).toBeVisible();
  });

  it("forces the alternate route when the ordinary handler may be involved", async () => {
    renderPage("teacher");
    await userEvent.setup().click(await screen.findByRole("button", { name: /Record a concern/ }));
    const dialog = screen.getByRole("region", { name: "Record a concern" });
    expect(screen.queryByRole('navigation',{name:'Restricted care sections'})).not.toBeInTheDocument();
    await userEvent.setup().click(within(dialog).getByRole("checkbox", { name: /ordinary handler/i }));
    expect(within(dialog).getByLabelText("Recipient route")).toHaveValue("alternate");
    expect(within(dialog).getByLabelText("Recipient route")).toBeDisabled();
    expect(within(dialog).getByText(/Do not investigate/)).toBeVisible();
  });

  it("separates care-team configuration from protected case detail and reporting evidence", async () => {
    renderPage();
    await userEvent.setup().click(await screen.findByRole("button", { name: /Aarav Sharma/ }));
    const caseDialog = await screen.findByRole("region", { name: "Aarav Sharma" });
    expect(within(caseDialog).getByText("Reporting assessment is still open.")).toBeVisible();
    expect(within(caseDialog).getByText(/exact words/)).toBeVisible();
    expect(within(caseDialog).getByLabelText("Action")).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Go back" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Care team" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Restricted care team" })).toBeVisible());
    expect(screen.getByText(/Job title alone does not open case records/)).toBeVisible();
    expect(screen.getByText("Designated safeguarding lead · Primary route")).toBeVisible();
  });
});
