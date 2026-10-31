import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RestrictedCarePage } from "./RestrictedCarePage";
import type { CareCaseDetail, CareWorkspace } from "./api";
import * as api from "./api";
import { ApiError } from "../../lib/api";
vi.mock('../auth/AuthContext',async original=>({...await original<typeof import('../auth/AuthContext')>(),useAuth:()=>({refresh:vi.fn().mockResolvedValue(undefined)})}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, getCareWorkspace: vi.fn(), getCareCase: vi.fn(), openCareCase: vi.fn(), actOnCareCase: vi.fn(), confirmCareCommand: vi.fn(), getOrphanedCareCases: vi.fn(), recoverCareOwner: vi.fn(), assignCareRole: vi.fn(), revokeCareRole: vi.fn() };
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
  external_reports: [], audits: [], handover_candidates: [{ id: "lead-2", name: "Anita Rao", role_kind: "deputy_lead" }], source_content_omitted: false,
};

function renderPage(search='', data = workspace) {
  vi.mocked(api.getCareWorkspace).mockResolvedValue(data);
  vi.mocked(api.getCareCase).mockResolvedValue(detail);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/areas/care/concerns${search}`]}><RestrictedCarePage schoolId="school-1" schoolName="Cambridge International School" /></MemoryRouter></QueryClientProvider>) };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("RestrictedCarePage", () => {
  it("keeps a large assigned-case queue on finite pages without hiding emergency guidance", async () => {
    renderPage('', { ...workspace, cases: Array.from({ length: 21 }, (_, index) => ({ ...workspace.cases[0]!, id: `case-${index}`, subject_name: `Assigned person ${index}` })) });
    const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: /Assigned person 0 / })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Assigned person 20 / })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next", exact: true }));
    expect(screen.getByRole("button", { name: /Assigned person 20 / })).toBeVisible();
    expect(screen.getByText("Page 2 of 2 · 21 assigned cases")).toBeVisible();
    expect(screen.getByRole("link", { name: "Call 112" })).toHaveAttribute("href", "tel:112");
  });
  it('gives a message report its own title and returns to the report queue',async()=>{
    vi.mocked(api.getCareWorkspace).mockResolvedValue(workspace);
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/areas/care/concerns?section=message_reports&report_status=resolved&report=report-1']}><RestrictedCarePage schoolId="school-1" messageReports={<div>Message report workspace</div>}/></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('heading',{name:'Message report',level:1})).toBeVisible();
    expect(screen.queryByRole('navigation',{name:'Restricted care sections'})).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button',{name:'Go back'}));
    expect(screen.getByRole('button',{name:'Message reports'})).toHaveAttribute('aria-current','page');
    expect(screen.getByText('Message report workspace')).toBeVisible();
  });
  it('restores a direct case link and preserves a return path when the case fails to load',async()=>{
    renderPage('?case=case-1');
    vi.mocked(api.getCareCase).mockRejectedValue(new Error('Case unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't sync this view.");
    expect(screen.queryByRole('navigation',{name:'Restricted care sections'})).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button',{name:'Go back'}));
    expect(await screen.findByRole('navigation',{name:'Restricted care sections'})).toBeVisible();
  });
  it("opens and focuses the exact restricted-care case from an attention link", async () => {
    renderPage("?section=cases&case=case-1");
    const heading = await screen.findByRole("heading", { name: "Aarav Sharma", level: 2 });
    expect(screen.getByRole("region", { name: "Aarav Sharma" })).toHaveClass("care-sheet--attention");
    expect(api.getCareCase).toHaveBeenCalledWith("school-1", "case-1");
    await waitFor(() => expect(heading).toHaveFocus());
  });
  it("keeps emergency action and assigned-case limits explicit", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Student care", level: 1 })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Call 112" })).toHaveAttribute("href", "tel:112");
    expect(screen.getByText("Primary route · 1 available")).toBeVisible();
    expect(screen.getByText("Alternate route · 1 available")).toBeVisible();
    expect(screen.queryByText(/You only see cases explicitly assigned to you/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Aarav Sharma/ })).toBeVisible();
  });

  it("forces the alternate route when the ordinary handler may be involved", async () => {
    renderPage();
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

  it("reconciles a lost intake response without resubmitting or storing narrative in recovery references", async () => {
    vi.mocked(api.openCareCase).mockRejectedValue(new TypeError("Response lost after commit"));
    const { client } = renderPage('?create=concern'), user = userEvent.setup();
    await user.type(await screen.findByLabelText("Factual intake note"), "Synthetic private intake needing restricted handling.");
    await user.click(screen.getByRole("button", { name: "Record concern", exact: true }));
    expect(await screen.findByText(/Save not confirmed/)).toBeVisible();
    expect(screen.getByLabelText("Factual intake note")).toBeDisabled();
    const input = vi.mocked(api.openCareCase).mock.calls[0]![1], id = String(input.command_id);
    vi.mocked(api.confirmCareCommand).mockResolvedValue({ state: "accepted", result: { id, revision: 1, receipt_id: "receipt-1", receipt: "Recorded" } });
    const refs = client.getQueryCache().findAll().filter(query => query.queryKey.includes("command-recovery")).map(query => query.state.data);
    expect(JSON.stringify(refs)).not.toContain("Synthetic private intake");
    await user.click(screen.getByRole("button", { name: "Check exact result" }));
    expect(await screen.findByRole("heading", { name: "Aarav Sharma", level: 2 })).toBeVisible();
    expect(api.openCareCase).toHaveBeenCalledOnce(); expect(api.confirmCareCommand).toHaveBeenCalledWith("school-1", id);
  });

  it("retries only the original intent after not_found and retains uncertain references after retry403 and navigation", async () => {
    vi.mocked(api.openCareCase).mockRejectedValueOnce(new TypeError("Response lost")).mockRejectedValueOnce(new ApiError("Access changed", 403));
    vi.mocked(api.confirmCareCommand).mockResolvedValue({ state: "not_found" });
    const { client } = renderPage('?create=concern'), user = userEvent.setup();
    await user.type(await screen.findByLabelText("Factual intake note"), "Synthetic protected narrative stays in the original intent.");
    await user.click(screen.getByRole("button", { name: "Record concern", exact: true }));
    await user.click(await screen.findByRole("button", { name: "Check exact result" }));
    await user.click(await screen.findByRole("button", { name: "Retry exact save" }));
    await screen.findByText(/Save not confirmed/);
    expect(api.openCareCase).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.openCareCase).mock.calls[1]![1]).toEqual(vi.mocked(api.openCareCase).mock.calls[0]![1]);
    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(await screen.findByRole("region", { name: "Protected save confirmation" })).toBeVisible();
    const refs = client.getQueryCache().findAll().filter(query => query.queryKey.includes("command-recovery")).map(query => query.state.data);
    expect(JSON.stringify(refs)).toContain(String(vi.mocked(api.openCareCase).mock.calls[0]![1].command_id));
    expect(JSON.stringify(refs)).not.toContain("Synthetic protected narrative");
  });

  it("keeps an accepted intake latched when workspace refresh fails, then performs only a read retry", async () => {
    vi.mocked(api.openCareCase).mockImplementation((_school, input) => Promise.resolve({ id: String(input.command_id), revision: 1, receipt_id: "receipt-1", receipt: "Recorded" }));
    renderPage('?create=concern'); const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Factual intake note"), "Synthetic protected intake with failed readback only.");
    vi.mocked(api.getCareWorkspace).mockRejectedValueOnce(new ApiError("Temporary refresh failure", 500));
    await user.click(screen.getByRole("button", { name: "Record concern", exact: true }));
    expect(await screen.findByRole("button", { name: "Open saved concern" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open saved concern" }));
    expect(await screen.findByRole("heading", { name: "Aarav Sharma", level: 2 })).toBeVisible();
    expect(api.openCareCase).toHaveBeenCalledOnce(); expect(api.confirmCareCommand).not.toHaveBeenCalled();
  });

  it("requires explicit review after an exact stale-action refusal while retaining the draft", async () => {
    vi.mocked(api.actOnCareCase).mockImplementation((_school, caseId, input) => Promise.reject(new ApiError("This protected case changed.", 409, { error: { code: "care_command_refused", fields: { care_command_refused: { confirmation: "not_accepted", receipt_state: "absent", command_id: input.command_id, case_id: caseId, reason: "stream_advanced" } } } })));
    renderPage('?case=case-1'); const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Factual note / rationale"), "Synthetic note retained after stale case revision.");
    await user.click(screen.getByRole("button", { name: "Save action" }));
    expect(await screen.findByRole("button", { name: "Review latest record" })).toBeVisible();
    expect(screen.getByLabelText("Factual note / rationale")).toHaveValue("Synthetic note retained after stale case revision.");
    vi.mocked(api.getCareCase).mockResolvedValue({ ...detail, case: { ...detail.case, revision: 3 } });
    await user.click(screen.getByRole("button", { name: "Review latest record" }));
    expect(await screen.findByRole("button", { name: "Save action" })).toBeEnabled();
    expect(api.actOnCareCase).toHaveBeenCalledOnce();
  });

  it("offers an exact confidential lead handover and an editable actual Reported at, never only recording time", async () => {
    vi.mocked(api.actOnCareCase).mockImplementation((_school, id, input) => Promise.resolve({ id, revision: 3, receipt_id: "receipt-3", receipt: "Recorded", ...(input.action === "reassign" ? { action: "restricted_care.case.reassigned" } : {}) }));
    renderPage('?case=case-1'); const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Action"), "reassign");
    expect(screen.getByText(/transfers confidential access/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText("New care lead"), "lead-2");
    await user.type(screen.getByLabelText("Handover note"), "Synthetic handover to the exact configured replacement.");
    await user.click(screen.getByRole("button", { name: "Hand over case" }));
    await waitFor(() => expect(api.actOnCareCase).toHaveBeenCalledOnce());
    expect(vi.mocked(api.actOnCareCase).mock.calls[0]![2]).toMatchObject({ action: "reassign", owner_user_id: "lead-2", expected_revision: 2 });
    expect(typeof vi.mocked(api.actOnCareCase).mock.calls[0]![2].command_id).toBe("string");
    expect(await screen.findByRole("heading", { name: "Student care", level: 1 })).toBeVisible();
    cleanup(); renderPage('?case=case-1');
    await user.selectOptions(await screen.findByLabelText("Action"), "external_report");
    const field = screen.getByLabelText("Reported at"); expect(field).toHaveAttribute("type", "datetime-local");
    fireEvent.change(field, { target: { value: "2026-10-03T15:20" } });
    await user.type(screen.getByLabelText("Report reference"), "Synthetic prior-day reference");
    await user.click(screen.getByRole("button", { name: "Save action" }));
    expect(vi.mocked(api.actOnCareCase).mock.calls[1]![2]).toMatchObject({ action: "external_report", reported_at: new Date("2026-10-03T15:20").toISOString() });
  });

  it("releases only an exact unavailable-route refusal and retains the factual intake for route review", async () => {
    vi.mocked(api.openCareCase).mockImplementation((_school, input) => Promise.reject(new ApiError("Primary protected route is not configured.", 409, { error: { code: "care_command_refused", fields: { care_command_refused: { confirmation: "not_accepted", receipt_state: "absent", command_id: input.command_id, case_id: input.command_id, reason: "route_unavailable" } } } })));
    renderPage('?create=concern'); const user = userEvent.setup();
    const note = await screen.findByLabelText("Factual intake note"); await user.type(note, "Synthetic factual intake retained while a route is configured.");
    await user.click(screen.getByRole("button", { name: "Record concern", exact: true }));
    expect(await screen.findByRole("button", { name: "Review latest routes" })).toBeVisible();
    expect(note).toHaveValue("Synthetic factual intake retained while a route is configured.");
    await user.click(screen.getByRole("button", { name: "Review latest routes" }));
    expect(await screen.findByRole("button", { name: "Record concern", exact: true })).toBeEnabled();
    expect(api.openCareCase).toHaveBeenCalledOnce(); expect(api.confirmCareCommand).not.toHaveBeenCalled();
  });
});
