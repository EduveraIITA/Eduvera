import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { getMemberInvitation, resendMemberInvitation, revokeMember } from "../onboarding/api";
import { repairFixture } from "./facilities.test-fixtures";
import { RepairInvitationDialog } from "./RepairInvitationDialog";
vi.mock("../onboarding/api", async original => ({ ...await original<typeof import("../onboarding/api")>(), getMemberInvitation: vi.fn(), resendMemberInvitation: vi.fn(), revokeMember: vi.fn() }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
const invitation = { id: "invite-1", person_id: "technician", email: "amit@example.test", expires_at: "2099-11-02T00:00:00Z", accepted_at: null, revoked_at: null, delivery: "manual" as const };
const access = { id: "grant", person: { id: "technician", label: "Amit", revision: 1, has_app_access: false }, starts_at: "2026-10-26T00:00:00Z", ends_at: "2026-11-02T00:00:00Z", instructions: "Fix light", shared_photo_ids: [], state: "awaiting_sign_in" as const, can_manage: true, can_activate: false, invitation };
beforeEach(() => { vi.mocked(getMemberInvitation).mockResolvedValue(invitation); vi.mocked(resendMemberInvitation).mockResolvedValue({ id: invitation.id, email: invitation.email, token: "never-render-token", expires_at: invitation.expires_at, delivery: "manual" }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount(environment: ExecutionEnvironment = { mode: "live" }) { const refresh = vi.fn().mockResolvedValue(undefined); render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ExecutionEnvironmentProvider environment={environment}><RepairInvitationDialog schoolId="school" actorId="coordinator" repair={repairFixture({ external_access: access })} refresh={refresh} onClose={vi.fn()} /></ExecutionEnvironmentProvider></MemoryRouter></QueryClientProvider>); return refresh; }
describe("manage the same source-scoped invitation", () => {
  it("resends the exact existing invitation without recreating a grant, person or account", async () => {
    const refresh = mount(); await userEvent.click(await screen.findByRole("button", { name: "Resend email" })); await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(getMemberInvitation).toHaveBeenCalledWith("school", "invite-1"); expect(resendMemberInvitation).toHaveBeenCalledWith("school", "invite-1"); expect(screen.queryByText("never-render-token")).not.toBeInTheDocument();
  });
  it("refuses a mismatched recipient before exposing any management action", async () => {
    vi.mocked(getMemberInvitation).mockResolvedValue({ ...invitation, person_id: "different-person" }); mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("does not match"); expect(screen.queryByRole("button", { name: "Resend email" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Revoke invitation" })).not.toBeInTheDocument();
  });
  it("revokes only the existing invitation and never offers a generic replacement invitation", async () => {
    const refresh = mount(); await userEvent.click(await screen.findByRole("button", { name: "Revoke invitation" })); await waitFor(() => expect(refresh).toHaveBeenCalledOnce()); expect(revokeMember).toHaveBeenCalledWith("school", "invite-1");
    expect(screen.queryByRole("button", { name: "Create another invitation" })).not.toBeInTheDocument();
  });
  it("shows accepted app linkage without claiming job acceptance or offering invitation revocation", async () => {
    vi.mocked(getMemberInvitation).mockResolvedValue({ ...invitation, accepted_at: "2026-10-26T00:00:00Z" }); mount();
    expect(await screen.findByText("App account linked")).toBeVisible(); expect(screen.getByText(/End it from this repair/)).toBeVisible(); expect(screen.queryByRole("button", { name: "Revoke invitation" })).not.toBeInTheDocument();
  });
  it("does not read Live invitation metadata or send email in Simulation", () => {
    mount({ mode: "simulation", namespaceId: "simulation:repairs", runId: "run", runStatus: "running", virtualClock: { now: "2026-10-26T00:00:00Z", timeZone: "Asia/Kolkata" } });
    expect(screen.getByText(/Real app invitations are managed in Live/)).toBeVisible(); expect(getMemberInvitation).not.toHaveBeenCalled(); expect(resendMemberInvitation).not.toHaveBeenCalled();
  });
});
