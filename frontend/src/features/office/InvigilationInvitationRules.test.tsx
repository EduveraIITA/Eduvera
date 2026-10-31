import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { InvigilationInvitationRules, type InvigilationInvitationSetup } from "./InvigilationInvitationRules";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
const url = "/api/v1/schools/school-1/assessments/invigilation-invitations/";
const setup: InvigilationInvitationSetup = {
  school_id: "school-1",
  policy: { state: "unconfigured", revision: 0, enabled: false, recipient_person_ids: [], response_due_minutes: null, expires_after_minutes: null, approved_at: null, approved_by: null, approval_note: null },
  eligible_recipients: Array.from({ length: 12 }, (_, index) => ({ person_id: `person-${index}`, user_id: `user-${index}`, name: `Staff ${String(index).padStart(2, "0")}`, designation: "Exam staff" })),
  readiness: { can_create_invitations: false, missing_recipient_count: 0 }, capabilities: { can_approve: true },
};
function show(completed = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const dirty = vi.fn();
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={completed ? { mode: "simulation", namespaceId: "simulation-one", runId: "run-one", runStatus: "completed", virtualClock: { now: "2026-10-20T12:00:00Z", timeZone: "UTC" } } : { mode: "live" }}><InvigilationInvitationRules schoolId="school-1" onDirtyChange={dirty} /></ExecutionEnvironmentProvider></QueryClientProvider>);
  return { dirty, client };
}
beforeEach(() => { vi.mocked(apiFetch).mockResolvedValue(structuredClone(setup)); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("explicit institution invigilation approval", () => {
  it("starts unconfigured, does not auto-enable, and keeps the setup out of the main form", async () => {
    show();
    expect(await screen.findByText(/Not set up/)).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith(url);
  });
  it("paginates eligible staff while preserving selection and requires a reason before explicit approval", async () => {
    const { dirty } = show();
    await userEvent.click(await screen.findByRole("button", { name: "Set up invitations" }));
    expect(screen.getByText("Page 1 of 2 · 12 staff")).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: /Staff 10/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Enable invigilation invitations for selected staff" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Staff 00/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next staff" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Staff 10/ }));
    expect(screen.getByText(/2 selected/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve and enable invitations" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Approval reason" }), "Approved institution examination team");
    const approved: InvigilationInvitationSetup = { ...setup, policy: { ...setup.policy, state: "enabled", enabled: true, revision: 1, recipient_person_ids: ["person-0", "person-10"], response_due_minutes: 1440, expires_after_minutes: 4320 }, readiness: { can_create_invitations: true, missing_recipient_count: 0 } };
    vi.mocked(apiFetch).mockResolvedValue(approved);
    await userEvent.click(screen.getByRole("button", { name: "Approve and enable invitations" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: "POST" })));
    const request = vi.mocked(apiFetch).mock.calls.find(([, options]) => options?.method === "POST")!;
    const body: unknown = JSON.parse(request[1]!.body as string);
    expect(body).toEqual(expect.objectContaining({ expected_revision: 0, enabled: true, recipient_person_ids: ["person-0", "person-10"], response_due_minutes: 1440, expires_after_minutes: 4320, approval_note: "Approved institution examination team" }));
    expect(body).toHaveProperty("idempotency_key", expect.any(String));
    expect(await screen.findByRole("status")).toHaveTextContent("Each duty still needs an explicit offer and response");
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it("keeps the reason and selections after a rejected approval", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Set up invitations" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Approval reason" }), "Pause new invitations while staffing is reviewed");
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("The policy changed. Review the latest revision."));
    await userEvent.click(screen.getByRole("button", { name: "Approve disabled policy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("policy changed");
    expect(screen.getByRole("textbox", { name: "Approval reason" })).toHaveValue("Pause new invitations while staffing is reviewed");
  });
  it("does not permit another approval in an ended simulation", async () => {
    show(true);
    await userEvent.click(await screen.findByRole("button", { name: "Set up invitations" }));
    expect(screen.getByText("This ended simulation is read-only.")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Enable invigilation invitations for selected staff" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve disabled policy" })).toBeDisabled();
  });
  it("retains an actionable retry for failed discovery", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Unavailable"));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Retry invitation policy" }));
    expect(await screen.findByRole("button", { name: "Set up invitations" })).toBeVisible();
  });
});
