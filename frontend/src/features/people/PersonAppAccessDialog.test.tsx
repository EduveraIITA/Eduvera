import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { getMemberInvitation, invitePersonToApp, resendMemberInvitation, revokeMember, type Invitation } from "../onboarding/api";
import type { CampusParticipant } from "./participationApi";
import { PersonAppAccessDialog } from "./PersonAppAccessDialog";

vi.mock("../onboarding/api", async original => ({ ...await original<typeof import("../onboarding/api")>(), getMemberInvitation: vi.fn(), invitePersonToApp: vi.fn(), resendMemberInvitation: vi.fn(), revokeMember: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const person: CampusParticipant = { id: "person-1", label: "Aarav Sharma", affiliations: ["learner"], has_account: false, account_state: "not_linked", is_you: false };
const invitation: Invitation = { id: "invitation-1", person_id: person.id, email: "aarav@example.com", role: "member", expires_at: "2099-10-20T12:00:00Z", accepted_at: null, revoked_at: null, delivery: "manual" };
const pendingPerson: CampusParticipant = { ...person, pending_invitation: { id: invitation.id, expires_at: invitation.expires_at, state: "pending" } };
const ready = { id: invitation.id, email: invitation.email, token: "private-not-for-rendering", expires_at: invitation.expires_at, delivery: "manual" as const };
function mount(value = person, environment: ExecutionEnvironment = { mode: "live" }) {
  const changed = vi.fn(), close = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ExecutionEnvironmentProvider environment={environment}><PersonAppAccessDialog schoolId="campus" person={value} onClose={close} onChanged={changed} /></ExecutionEnvironmentProvider></QueryClientProvider>);
  return { changed, close };
}
describe("same-person app invitation", () => {
  it("creates app-only membership for the exact existing person, retaining email and command identity after failure", async () => {
    vi.mocked(invitePersonToApp).mockRejectedValueOnce(new Error("Creation was not confirmed.")).mockResolvedValueOnce(ready);
    vi.mocked(getMemberInvitation).mockResolvedValue(invitation);
    const { changed } = mount();
    expect(screen.getByText("Aarav Sharma")).toBeVisible();
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/account type|role|password/i)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Recipient email"), "Aarav@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
    expect(screen.getByLabelText("Recipient email")).toHaveValue("Aarav@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("heading", { name: "Invitation pending" })).toBeVisible();
    expect(changed).toHaveBeenCalledOnce();
    expect(vi.mocked(invitePersonToApp).mock.calls[0]).toEqual(vi.mocked(invitePersonToApp).mock.calls[1]);
    const [school, body] = vi.mocked(invitePersonToApp).mock.calls[0]!;
    const { idempotency_key, ...input } = body;
    expect(school).toBe("campus");
    expect(input).toEqual({ email: "aarav@example.com", role: "member", person_id: "person-1" });
    expect(idempotency_key).toMatch(/^[a-f\d-]{36}$/);
    const dialog = screen.getByRole("dialog", { name: "Manage app invitation" });
    expect(within(dialog).getByRole("heading", { name: "Invitation created" })).toBeVisible();
    expect(within(dialog).getByText(/Email sending is unavailable/)).toBeVisible();
    expect(screen.queryByText(ready.token)).not.toBeInTheDocument();
    expect(screen.queryByText("Invitation sent")).not.toBeInTheDocument();
  });
  it("uses a new command key only when the email input changes", async () => {
    vi.mocked(invitePersonToApp).mockRejectedValue(new Error("Creation not confirmed"));
    mount();
    await userEvent.type(screen.getByLabelText("Recipient email"), "first@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await screen.findByRole("alert");
    await userEvent.clear(screen.getByLabelText("Recipient email"));
    await userEvent.type(screen.getByLabelText("Recipient email"), "second@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(invitePersonToApp).toHaveBeenCalledTimes(2));
    expect(vi.mocked(invitePersonToApp).mock.calls[0]![1].idempotency_key).not.toBe(vi.mocked(invitePersonToApp).mock.calls[1]![1].idempotency_key);
  });
  it("reports retained replay as pending rather than pretending another email was sent", async () => {
    vi.mocked(invitePersonToApp).mockResolvedValue({ ...ready, token: "", replayed: true, delivery: "email_accepted" });
    vi.mocked(getMemberInvitation).mockResolvedValue({ ...invitation, delivery: "email_accepted" });
    mount();
    await userEvent.type(screen.getByLabelText("Recipient email"), "aarav@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText("Invitation already created. It remains pending until the recipient accepts.")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Invitation sent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "App account linked" })).not.toBeInTheDocument();
  });
  it("keeps the person's management context open when a sending receipt is dismissed", async () => {
    vi.mocked(invitePersonToApp).mockResolvedValue({ ...ready, delivery: "queued", delivery_job_id: "job" });
    vi.mocked(getMemberInvitation).mockResolvedValue({ ...invitation, delivery: "queued", delivery_job_id: "job" });
    const { close } = mount();
    await userEvent.type(screen.getByLabelText("Recipient email"), "aarav@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    const popup = await screen.findByRole("dialog", { name: "Sending invitation…" });
    expect(within(popup).getByText("Aarav Sharma")).toBeVisible();
    fireEvent(popup, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(screen.queryByRole("dialog", { name: "Sending invitation…" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Manage app invitation" })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Invitation pending" })).toHaveFocus());
    expect(close).not.toHaveBeenCalled();
  });
  it("manages the exact pending invitation and recipient, then revokes without creating another person or account", async () => {
    vi.mocked(getMemberInvitation).mockResolvedValue(invitation);
    vi.mocked(resendMemberInvitation).mockResolvedValue(ready);
    const { changed } = mount(pendingPerson);
    expect(await screen.findByText("aarav@example.com")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Resend invitation email" }));
    await waitFor(() => expect(resendMemberInvitation).toHaveBeenCalledWith("campus", "invitation-1"));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    vi.mocked(getMemberInvitation).mockResolvedValue({ ...invitation, revoked_at: "2026-10-20T12:00:00Z" });
    vi.mocked(revokeMember).mockResolvedValue({ revoked: true });
    await userEvent.click(screen.getByRole("button", { name: "Revoke invitation" }));
    expect(await screen.findByRole("heading", { name: "Invitation revoked" })).toBeVisible();
    expect(revokeMember).toHaveBeenCalledWith("campus", "invitation-1");
    expect(invitePersonToApp).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create another invitation" })).toBeVisible();
  });
  it("refuses mismatched invitation context before offering management controls", async () => {
    vi.mocked(getMemberInvitation).mockResolvedValue({ ...invitation, person_id: "different-person" });
    mount(pendingPerson);
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer matches this campus person");
    expect(screen.queryByRole("button", { name: "Resend invitation email" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke invitation" })).not.toBeInTheDocument();
    expect(resendMemberInvitation).not.toHaveBeenCalled();
  });
  it("recognizes acceptance without offering additional invitation or access actions", async () => {
    vi.mocked(getMemberInvitation).mockResolvedValue({ ...invitation, accepted_at: "2026-10-20T12:00:00Z" });
    const { changed } = mount(pendingPerson);
    expect(await screen.findByRole("heading", { name: "App account linked" })).toBeVisible();
    expect(changed).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Resend|Revoke/ })).not.toBeInTheDocument();
  });
  it("never reads invitation email or sends real account actions in Simulation", () => {
    mount(pendingPerson, { mode: "simulation", namespaceId: "namespace", runId: "run", runStatus: "running", virtualClock: { now: "2026-10-20T12:00:00Z", timeZone: "UTC" } });
    expect(screen.getByText(/App access is managed in Live/)).toBeVisible();
    expect(screen.queryByLabelText("Recipient email")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send invitation|Resend|Revoke/ })).not.toBeInTheDocument();
    expect(getMemberInvitation).not.toHaveBeenCalled();
    expect(invitePersonToApp).not.toHaveBeenCalled();
  });
  it.each(["active", "inactive"] as const)("does not invite or reactivate a person with %s app linkage", state => {
    mount({ ...person, has_account: true, account_state: state });
    expect(screen.queryByLabelText("Recipient email")).not.toBeInTheDocument();
    expect(screen.getByText(state === "inactive" ? /cannot reactivate or replace/ : /already has an app account/)).toBeVisible();
    expect(invitePersonToApp).not.toHaveBeenCalled();
  });
});
