import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { invitePersonToApp } from "../onboarding/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { getVisit, getVisitOptions, getVisits } from "./visitApi";
import * as sharingApi from "./visitSharingApi";
import { VisitsEntry } from "./VisitsWorkspaceRoute";
import { VisitShareDialog } from "./VisitShareDialog";
import { VisitSharing } from "./VisitSharing";
import { sharedVisitFixture, visitSharingFixture, organiser } from "./visitSharing.test-fixtures";
import { visitFixture, visitOptions, visitPage } from "./visits.test-fixtures";

vi.mock("./visitSharingApi", () => ({ getVisitSharingDiscovery: vi.fn(), getSharedVisits: vi.fn(), getSharedVisit: vi.fn(), getVisitSharing: vi.fn(), shareVisit: vi.fn(), revokeVisitSharing: vi.fn(), takeOverVisitQuestions: vi.fn(), askVisitQuestion: vi.fn(), replyToVisitQuestion: vi.fn(), confirmVisitSharingCommand: vi.fn() }));
vi.mock("./visitApi", async original => ({ ...await original<typeof import("./visitApi")>(), getVisits: vi.fn(), getVisit: vi.fn(), getVisitOptions: vi.fn() }));
vi.mock("../onboarding/api", async original => ({ ...await original<typeof import("../onboarding/api")>(), invitePersonToApp: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "actor" } }) }));
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: vi.fn() }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => {
  vi.mocked(sharingApi.getVisitSharingDiscovery).mockResolvedValue({ can_manage: false, has_shared: true, has_questions: false });
  vi.mocked(sharingApi.getSharedVisit).mockResolvedValue(sharedVisitFixture()); vi.mocked(sharingApi.getVisitSharing).mockResolvedValue(visitSharingFixture());
  vi.mocked(sharingApi.getSharedVisits).mockResolvedValue({ visits: [sharedVisitFixture().visit], timezone: "UTC", pagination: { page: 1, page_size: 10, total: 1, total_pages: 1 } });
  vi.mocked(getVisitOptions).mockResolvedValue({ ...visitOptions(), people: [organiser] }); vi.mocked(getVisits).mockResolvedValue(visitPage());
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount(node = <VisitsEntry schoolId="school" actorId="actor" timezone="UTC" />, path = "/areas/in-out/visits?visit=visit-1&shared=1", environment: ExecutionEnvironment = { mode: "live" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>); return client;
}
const shareDialog = (refresh = vi.fn().mockResolvedValue(undefined)) => <VisitShareDialog schoolId="school" actorId="actor" visit={visitFixture({ person: organiser })} initial={visitSharingFixture({ share_revision: 0, current: null })} refresh={refresh} onClose={vi.fn()} />;
const question = { id: "question-1", revision: 1, state: "waiting_for_review" as const, entries: [{ id: "entry-1", kind: "question" as const, note: "Can the bus use the east gate?", recorded_at: "2026-10-26T10:00:00Z", author: "organiser" as const, author_label: "Kavita Sen" }], entries_has_more: false };

describe("private shared visit experience", () => {
  it("opens an exact safe view without manager detail, choices or discovery preflight", async () => {
    mount(); expect(await screen.findByRole("region", { name: "Shared visit" })).toHaveTextContent("Laboratory demonstration");
    expect(screen.getByText("Use the east entrance, then reception.")).toBeVisible(); expect(screen.queryByText("Arrival & departure")).not.toBeInTheDocument(); expect(screen.queryByText("History")).not.toBeInTheDocument();
    expect(getVisit).not.toHaveBeenCalled(); expect(getVisits).not.toHaveBeenCalled(); expect(getVisitOptions).not.toHaveBeenCalled(); expect(sharingApi.getVisitSharingDiscovery).not.toHaveBeenCalled(); expect(sharingApi.askVisitQuestion).not.toHaveBeenCalled();
  });
  it("uses the source school's timezone instead of a restricted UTC manifest default", async () => {
    vi.mocked(sharingApi.getSharedVisit).mockResolvedValue(sharedVisitFixture({ timezone: "Asia/Kolkata" }));
    mount(<VisitsEntry schoolId="school" actorId="actor" timezone="UTC" />);
    const plan = await screen.findByRole("region", { name: "Shared visit" }); expect(within(plan).getByText("When · Asia/Kolkata")).toBeVisible(); expect(plan).toHaveTextContent("2:30 pm"); expect(plan).not.toHaveTextContent("9:00 am");
  });
  it("discovers a restricted organiser's own visits without trying the manager endpoint", async () => {
    mount(undefined, "/areas/in-out/visits"); expect(await screen.findByRole("link", { name: /Laboratory demonstration/ })).toHaveAttribute("href", "/areas/in-out/visits?shared=1&visit=visit-1"); expect(getVisits).not.toHaveBeenCalled(); expect(getVisitOptions).not.toHaveBeenCalled();
  });
  it("keeps campus and own visits available in the same shell for independent campus responsibility", async () => {
    vi.mocked(sharingApi.getVisitSharingDiscovery).mockResolvedValue({ can_manage: true, has_shared: true, has_questions: false }); mount(undefined, "/areas/in-out/visits");
    fireEvent.click(await screen.findByRole("button", { name: "Shared with me" })); expect(await screen.findByRole("link", { name: /Laboratory demonstration/ })).toBeVisible(); expect(screen.getByRole("button", { name: "Shared with me" })).toHaveAttribute("aria-pressed", "true");
  });
  it("shows current cancellation and only safe post-share changes", async () => {
    const base = sharedVisitFixture(); vi.mocked(sharingApi.getSharedVisit).mockResolvedValue({ ...base, visit: { ...base.visit, state: "cancelled", place: { ...base.visit.place, label: "East hall" } }, changes: [{ revision: 2, recorded_at: "2026-10-26T11:00:00Z", title: "Revised visit", starts_at: base.visit.starts_at, ends_at: base.visit.ends_at, state: "cancelled", party_size: 12, place_label: "East hall", contact_label: "Meera Das" }], changes_has_more: true });
    mount(); expect(await screen.findByText(/Contact the campus before travelling/)).toBeVisible(); fireEvent.click(screen.getByText("Visit changes · 1")); expect(screen.getByText("Showing the latest 25 changes.")).toBeVisible(); expect(screen.queryByText("Record departure")).not.toBeInTheDocument();
  });
  it("sends one source question with no separate acceptance or resolve action", async () => {
    vi.mocked(sharingApi.askVisitQuestion).mockResolvedValue(sharedVisitFixture({ question })); mount(); fireEvent.change(await screen.findByLabelText("Your question"), { target: { value: question.entries[0]!.note } }); fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() => expect(sharingApi.askVisitQuestion).toHaveBeenCalledWith("school", "visit-1", expect.objectContaining({ expected_revision: 0, share_id: "share-1", note: question.entries[0]!.note })));
    expect(typeof vi.mocked(sharingApi.askVisitQuestion).mock.calls[0]?.[2].command_id).toBe("string");
    expect(await screen.findByText("Question sent.")).toBeVisible(); expect(screen.queryByRole("button", { name: /Accept|Resolve|Acknowledge/ })).not.toBeInTheDocument();
  });
  it("reconciles an unknown question using its exact safe receipt before refreshing, without resending", async () => {
    vi.mocked(sharingApi.askVisitQuestion).mockRejectedValue(new TypeError("Response lost")); mount(); fireEvent.change(await screen.findByLabelText("Your question"), { target: { value: "Where should the bus stop?" } }); fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    vi.mocked(sharingApi.confirmVisitSharingCommand).mockResolvedValue({ state: "accepted", result: { visit_id: "visit-1", share_id: "share-1", share_root_id: "root-1", question_id: "question-1", revision: 1, action: "asked" } });
    fireEvent.click(await screen.findByRole("button", { name: "Check result" })); expect(await screen.findByText("Question sent.")).toBeVisible(); expect(sharingApi.askVisitQuestion).toHaveBeenCalledTimes(1); expect(sharingApi.getSharedVisit).toHaveBeenCalledTimes(2);
  });
  it("will not accept another share's receipt as this question", async () => {
    vi.mocked(sharingApi.askVisitQuestion).mockRejectedValue(new TypeError("Response lost")); vi.mocked(sharingApi.confirmVisitSharingCommand).mockResolvedValue({ state: "accepted", result: { visit_id: "visit-1", share_id: "other-share", share_root_id: "root-1", revision: 1, action: "asked" } }); mount();
    fireEvent.change(await screen.findByLabelText("Your question"), { target: { value: "Where should the bus stop?" } }); fireEvent.click(screen.getByRole("button", { name: "Send question" })); fireEvent.click(await screen.findByRole("button", { name: "Check result" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not confirm this exact action"); expect(screen.getByLabelText("Your question")).toBeDisabled(); expect(sharingApi.askVisitQuestion).toHaveBeenCalledTimes(1);
  });
  it("retries an unknown action only with the identical retained command and payload", async () => {
    vi.mocked(sharingApi.askVisitQuestion).mockRejectedValueOnce(new TypeError("Response lost")).mockResolvedValue(sharedVisitFixture({ question })); vi.mocked(sharingApi.confirmVisitSharingCommand).mockResolvedValue({ state: "not_found" }); mount();
    fireEvent.change(await screen.findByLabelText("Your question"), { target: { value: "Where should the bus stop?" } }); fireEvent.click(screen.getByRole("button", { name: "Send question" })); fireEvent.click(await screen.findByRole("button", { name: "Check result" })); fireEvent.click(await screen.findByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(sharingApi.askVisitQuestion).toHaveBeenCalledTimes(2)); expect(vi.mocked(sharingApi.askVisitQuestion).mock.calls[1]).toEqual(vi.mocked(sharingApi.askVisitQuestion).mock.calls[0]);
  });
  it("lets the exact campus answerer reply and finish without a second resolve step", async () => {
    const base = sharedVisitFixture({ question }); vi.mocked(sharingApi.getSharedVisit).mockResolvedValue({ ...base, share: { ...base.share, can_ask: false, can_reply: true } }); vi.mocked(sharingApi.replyToVisitQuestion).mockResolvedValue({ ...base, question: { ...question, revision: 2, state: "answered" } }); mount();
    fireEvent.change(await screen.findByLabelText("Your reply"), { target: { value: "Please use the east gate." } }); fireEvent.click(screen.getByRole("button", { name: "Send reply" })); expect(await screen.findByText("Reply sent.")).toBeVisible(); expect(sharingApi.replyToVisitQuestion).toHaveBeenCalledWith("school", "visit-1", "question-1", expect.objectContaining({ expected_revision: 1 })); expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
  });
  it("keeps a withdrawn question truthful after same-organiser renewal without reopening work", async () => {
    vi.mocked(sharingApi.getSharedVisit).mockResolvedValue(sharedVisitFixture({ question: { ...question, state: "withdrawn", revision: 2 } })); mount();
    expect(await screen.findByText("No reply pending")).toBeVisible(); expect(screen.getByLabelText("Ask a follow-up")).toBeEnabled(); expect(screen.queryByText("Waiting for campus reply")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Send reply" })).not.toBeInTheDocument(); expect(sharingApi.askVisitQuestion).not.toHaveBeenCalled();
  });
  it("does not fetch another answerer's private thread from manager metadata", async () => {
    mount(<VisitSharing schoolId="school" actorId="actor" visit={visitFixture()} timezone="UTC" disabled={false} />); await screen.findByText("Shared with Kavita Sen"); expect(sharingApi.getSharedVisit).not.toHaveBeenCalled();
  });
  it.each(["revoke", "takeover"] as const)("reconciles a lost %s response using the new version and stable sharing root", async action => {
    const initial = visitSharingFixture(); initial.current!.can_takeover = action === "takeover"; initial.current!.owner.available = action !== "takeover";
    vi.mocked(sharingApi.getVisitSharing).mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, share_revision: 2, current: { ...initial.current!, id: "share-version-2", revision: 2, can_takeover: false, state: action === "revoke" ? "revoked" : "active" } });
    const operation = action === "revoke" ? sharingApi.revokeVisitSharing : sharingApi.takeOverVisitQuestions; vi.mocked(operation).mockRejectedValue(new TypeError("Response lost"));
    vi.mocked(sharingApi.confirmVisitSharingCommand).mockResolvedValue({ state: "accepted", result: { visit_id: "visit-1", share_id: "share-version-2", share_root_id: "root-1", revision: 2, action: action === "revoke" ? "revoked" : "taken_over" } });
    mount(<VisitSharing schoolId="school" actorId="actor" visit={visitFixture()} timezone="UTC" disabled={false} />); const name = action === "revoke" ? "Stop sharing" : "Take over questions"; fireEvent.click(await screen.findByRole("button", { name })); const dialog = screen.getByRole("dialog"); fireEvent.click(within(dialog).getByRole("button", { name })); fireEvent.click(await within(dialog).findByRole("button", { name: "Check result" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(operation).toHaveBeenCalledOnce(); expect(sharingApi.getVisitSharing).toHaveBeenCalledTimes(2);
  });
  it("shares to an existing account in one action without inviting or recording attendance", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined); vi.mocked(sharingApi.shareVisit).mockResolvedValue(visitSharingFixture()); mount(shareDialog(refresh)); const dialog = await screen.findByRole("dialog", { name: "Share visit" }); fireEvent.click(within(dialog).getByRole("button", { name: "Share visit" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce()); expect(sharingApi.shareVisit).toHaveBeenCalledWith("school", "visit-1", expect.objectContaining({ organiser_person_id: "organiser", organiser_person_revision: 3, expected_revision: 0, expected_visit_revision: 1, directions: "" })); expect(invitePersonToApp).not.toHaveBeenCalled();
  });
  it("retains the original question owner when another coordinator renews the same organiser", async () => {
    mount(<VisitShareDialog schoolId="school" actorId="actor" visit={visitFixture({ person: organiser })} initial={visitSharingFixture()} refresh={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/Questions stay with Meera Das/)).toBeVisible(); expect(screen.queryByText(/Questions come to you/)).not.toBeInTheDocument();
  });
  it("creates a scoped app invitation only after sharing is saved, retaining its key when delivery is unknown", async () => {
    const person = { ...organiser, has_app_access: false }, data = visitSharingFixture(); data.current!.organiser = person;
    vi.mocked(sharingApi.shareVisit).mockResolvedValue(data); vi.mocked(invitePersonToApp).mockRejectedValueOnce(new TypeError("Response lost")).mockResolvedValueOnce({ id: "invitation-1", token: "synthetic-never-rendered", email: "kavita@example.test", expires_at: "2026-11-01T10:00:00Z", delivery: "manual" });
    mount(<VisitShareDialog schoolId="school" actorId="actor" visit={visitFixture({ person })} initial={visitSharingFixture({ share_revision: 0, current: null })} refresh={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Invitation email"), { target: { value: "kavita@example.test" } }); fireEvent.click(screen.getByRole("button", { name: "Share visit" }));
    const retry = await screen.findByRole("button", { name: "Retry same invitation" }); expect(screen.getByRole("button", { name: "Done" })).toBeDisabled(); expect(sharingApi.shareVisit).toHaveBeenCalledOnce();
    fireEvent.click(retry); await waitFor(() => expect(invitePersonToApp).toHaveBeenCalledTimes(2)); expect(vi.mocked(invitePersonToApp).mock.calls[1]).toEqual(vi.mocked(invitePersonToApp).mock.calls[0]); expect(vi.mocked(invitePersonToApp).mock.calls[0]?.[1].work_context).toEqual({ kind: "visit_arrangement", source_id: "visit-1", access_id: "share-1" }); expect(screen.queryByText("synthetic-never-rendered")).not.toBeInTheDocument(); expect(screen.queryByText(/email delivered/i)).not.toBeInTheDocument();
  });
  it("reviews a proven stale question before allowing a new command", async () => {
    vi.mocked(sharingApi.askVisitQuestion).mockImplementation((_school, _visit, input) => Promise.reject(new ApiError("Changed", 409, { error: { code: "visit_sharing_changed", fields: { visit_sharing_changed: { confirmation: "permanently_inapplicable", receipt_state: "absent", visit_id: "visit-1", command_id: input.command_id, expected_revision: input.expected_revision, current_revision: 1 } } } })));
    mount(); fireEvent.change(await screen.findByLabelText("Your question"), { target: { value: "Where should the bus stop?" } }); fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(await screen.findByRole("button", { name: "Review latest" })).toBeVisible(); expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "Review latest" })); await waitFor(() => expect(screen.getByRole("button", { name: "Send question" })).toBeEnabled()); expect(sharingApi.askVisitQuestion).toHaveBeenCalledOnce();
  });
  it.each([true, false])("only releases a known invitation conflict when its not-created proof matches the exact key (%s)", async matches => {
    const person = { ...organiser, has_app_access: false }, data = visitSharingFixture(); data.current!.organiser = person; vi.mocked(sharingApi.shareVisit).mockResolvedValue(data);
    vi.mocked(invitePersonToApp).mockImplementation((_school, input) => Promise.reject(new ApiError("This person already has another pending invitation.", 409, { error: { code: "person_invitation_exists", fields: { person_invitation: { confirmation: "not_created", idempotency_key: matches ? input.idempotency_key : "other-key" } } } })));
    mount(<VisitShareDialog schoolId="school" actorId="actor" visit={visitFixture({ person })} initial={visitSharingFixture({ share_revision: 0, current: null })} refresh={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Invitation email"), { target: { value: "kavita@example.test" } }); fireEvent.click(screen.getByRole("button", { name: "Share visit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(matches ? "not created" : "not confirmed"); if (matches) expect(screen.getByRole("button", { name: "Done" })).toBeEnabled(); else expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  });
  it.each<ExecutionEnvironment>([{ mode: "live" }, { mode: "simulation", namespaceId: "simulation:visits", runId: "visits-run", runStatus: "stopped", virtualClock: { now: "2026-10-26T09:00:00Z", timeZone: "UTC" } }])("partitions the shared source and pauses stopped Simulation writes in $mode", async environment => {
    const client = mount(undefined, undefined, environment); const input = await screen.findByLabelText("Your question"); expect(client.getQueryCache().findAll()[0]!.queryKey).toContain(environment.mode === "live" ? "live" : "simulation:visits"); if (environment.mode === "simulation") expect(input).toBeDisabled(); expect(sharingApi.askVisitQuestion).not.toHaveBeenCalled();
  });
  it("hides a retained private view after access is revoked, without falling back to manager detail", async () => {
    const client = mount(); await screen.findByRole("region", { name: "Shared visit" }); vi.mocked(sharingApi.getSharedVisit).mockRejectedValue(new ApiError("Sharing stopped", 410)); await client.invalidateQueries(); expect(await screen.findByRole("alert")).toHaveTextContent("Sharing stopped"); expect(screen.queryByText("Laboratory demonstration")).not.toBeInTheDocument(); expect(getVisit).not.toHaveBeenCalled();
  });
});
