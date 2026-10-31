import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { cancelVisit, confirmVisitCommand, createVisit, getVisit, getVisitOptions, getVisits, recordVisitMovement, updateVisit } from "./visitApi";
import { VisitsWorkspace, WorkspaceVisitsRoute } from "./VisitsWorkspaceRoute";
import { visitDetail, visitFixture, visitOptions, visitPage } from "./visits.test-fixtures";
import { getVisitSharing, getVisitSharingDiscovery } from "./visitSharingApi";

vi.mock("./visitApi", async original => ({ ...await original<typeof import("./visitApi")>(), getVisits: vi.fn(), getVisit: vi.fn(), getVisitOptions: vi.fn(), createVisit: vi.fn(), updateVisit: vi.fn(), cancelVisit: vi.fn(), recordVisitMovement: vi.fn(), confirmVisitCommand: vi.fn() }));
vi.mock("./visitSharingApi", async original => ({ ...await original<typeof import("./visitSharingApi")>(), getVisitSharing: vi.fn(), getVisitSharingDiscovery: vi.fn() }));
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "actor" } }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ title, children }: { title: string; children: ReactNode }) => <><h1>{title}</h1>{children}</> }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => {
  vi.mocked(getVisits).mockResolvedValue(visitPage()); vi.mocked(getVisit).mockResolvedValue(visitDetail()); vi.mocked(getVisitOptions).mockResolvedValue(visitOptions());
  vi.mocked(getVisitSharing).mockResolvedValue({ visit_revision: 1, share_revision: 0, can_share: true, can_open_shared: false, current: null }); vi.mocked(getVisitSharingDiscovery).mockResolvedValue({ can_manage: true, has_shared: false, has_questions: false });
  vi.mocked(useWorkspaceManifest).mockReturnValue({ isPending: false, error: null, data: { context: { institution_id: "school", actor_user_id: "actor", time_zone: "UTC", environment: { kind: "live" } }, areas: [{ key: "gate", surfaces: [{ href: "/areas/in-out/visits" }] }] }, refetch: vi.fn() } as unknown as ReturnType<typeof useWorkspaceManifest>);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function Location() { return <output aria-label="Location">{useLocation().search}</output>; }
function mount({ path = "/areas/in-out/visits", environment = { mode: "live" }, route = false }: { path?: string; environment?: ExecutionEnvironment; route?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[path]}>{route ? <WorkspaceVisitsRoute /> : <VisitsWorkspace schoolId="school" actorId="actor" timezone="UTC" />}<Location /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return client;
}
async function openGuestEditor() {
  fireEvent.click(await screen.findByRole("button", { name: "Arrange visit" }));
  const dialog = await screen.findByRole("dialog", { name: "Arrange visit" });
  await within(dialog).findByRole("button", { name: "Meera Das" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Guest name" }), { target: { value: "Riverview School" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Visit for" }), { target: { value: "Laboratory demonstration" } });
  fireEvent.change(within(dialog).getByLabelText("Until"), { target: { value: "2027-10-27T10:00" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Choose place" }));
  fireEvent.click(await screen.findByRole("button", { name: "Robotics laboratory Main campus" }));
  return dialog;
}
describe("source-owned arranged visits", () => {
  it.each<ExecutionEnvironment>([{ mode: "live" }, { mode: "simulation", namespaceId: "simulation:visits", runId: "visits-run", runStatus: "running", virtualClock: { now: "2026-10-26T09:00:00Z", timeZone: "UTC" } }])("uses one list and isolates cache in $mode", async environment => {
    const client = mount({ environment }); expect(await screen.findByRole("link", { name: /Riverview School/ })).toHaveAttribute("href", "/areas/in-out/visits?visit=visit-1");
    expect(client.getQueryCache().findAll()[0]!.queryKey).toContain(environment.mode === "live" ? "live" : "simulation:visits");
    expect(recordVisitMovement).not.toHaveBeenCalled();
  });
  it("preserves list context through detail and back without implying arrival", async () => {
    mount({ path: "/areas/in-out/visits?view=all&search=Riverview&page=2" });
    fireEvent.click(await screen.findByRole("link", { name: /Riverview School/ }));
    expect(await screen.findByText("Confirmed plan")).toBeVisible(); expect(screen.getByText(/No movement recorded/)).toBeVisible(); expect(recordVisitMovement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back to visits" })); expect(screen.getByLabelText("Location")).toHaveTextContent("?view=all&search=Riverview&page=2");
  });
  it("confirms a guest plan directly without creating an account or movement", async () => {
    vi.mocked(createVisit).mockImplementation((_school, input) => Promise.resolve(visitDetail({ visit: visitFixture({ id: input.command_id, title: input.title }) })));
    mount(); const dialog = await openGuestEditor(); fireEvent.click(within(dialog).getByRole("button", { name: "Confirm visit" }));
    await waitFor(() => expect(createVisit).toHaveBeenCalledWith("school", expect.objectContaining({ expected_revision: 0, person_id: null, person_revision: null, guest_name: "Riverview School", contact_person_id: "contact", contact_revision: 3, place_id: "room", party_size: 1 })));
    expect(recordVisitMovement).not.toHaveBeenCalled(); expect(await screen.findByText("Visit saved.")).toBeVisible();
  });
  it("requires explicit canonical identity selection and its current revision", async () => {
    mount(); const dialog = await openGuestEditor();
    fireEvent.click(within(dialog).getByRole("button", { name: "Campus person" })); fireEvent.click(within(dialog).getByRole("button", { name: "Choose person" }));
    fireEvent.click(await screen.findByRole("button", { name: "Aarav Sharma" }));
    vi.mocked(createVisit).mockImplementation((_school, input) => Promise.resolve(visitDetail({ visit: visitFixture({ id: input.command_id }) })));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm visit" }));
    await waitFor(() => expect(createVisit).toHaveBeenCalledWith("school", expect.objectContaining({ person_id: "person-1", person_revision: 8, guest_name: null })));
  });
  it("checks an uncertain result without sending a second create", async () => {
    vi.mocked(createVisit).mockRejectedValue(new TypeError("Connection lost")); mount(); const dialog = await openGuestEditor();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm visit" }));
    expect(await within(dialog).findByRole("button", { name: "Check result" })).toBeVisible(); expect(within(dialog).getByRole("textbox", { name: "Guest name" })).toBeDisabled();
    const command = vi.mocked(createVisit).mock.calls[0]![1].command_id;
    vi.mocked(confirmVisitCommand).mockResolvedValue({ state: "accepted", result: visitDetail({ visit: visitFixture({ id: command }) }) });
    fireEvent.click(within(dialog).getByRole("button", { name: "Check result" }));
    await waitFor(() => expect(confirmVisitCommand).toHaveBeenCalledWith("school", command, command)); expect(createVisit).toHaveBeenCalledTimes(1); expect(await screen.findByText("Visit saved.")).toBeVisible();
  });
  it("retries only the retained command and unchanged payload after a missing receipt", async () => {
    vi.mocked(createVisit).mockRejectedValueOnce(new TypeError("Connection lost")).mockImplementation((_school, input) => Promise.resolve(visitDetail({ visit: visitFixture({ id: input.command_id }) })));
    vi.mocked(confirmVisitCommand).mockResolvedValue({ state: "not_found" }); mount(); const dialog = await openGuestEditor(); fireEvent.click(within(dialog).getByRole("button", { name: "Confirm visit" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Check result" })); fireEvent.click(await within(dialog).findByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(createVisit).toHaveBeenCalledTimes(2)); expect(vi.mocked(createVisit).mock.calls[1]).toEqual(vi.mocked(createVisit).mock.calls[0]);
  });
  it("retains an uncertain command when its retry loses authority", async () => {
    vi.mocked(createVisit).mockRejectedValueOnce(new TypeError("Connection lost")).mockRejectedValueOnce(new ApiError("Access changed", 403));
    vi.mocked(confirmVisitCommand).mockResolvedValue({ state: "not_found" }); mount(); const dialog = await openGuestEditor(); fireEvent.click(within(dialog).getByRole("button", { name: "Confirm visit" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Check result" })); fireEvent.click(await within(dialog).findByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(createVisit).toHaveBeenCalledTimes(2)); expect(vi.mocked(createVisit).mock.calls[1]).toEqual(vi.mocked(createVisit).mock.calls[0]);
    expect(await within(dialog).findByRole("button", { name: "Check result" })).toBeVisible(); expect(within(dialog).getByRole("textbox", { name: "Guest name" })).toBeDisabled(); expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled(); expect(within(dialog).getByRole("button", { name: "Confirm visit" })).toBeDisabled();
  });
  it("keeps edit fields after a stale revision and requires review before resending", async () => {
    vi.mocked(updateVisit).mockImplementation((_school, _id, input) => Promise.reject(new ApiError("Visit changed", 409, { error: { code: "visit_changed", fields: { visit_changed: { confirmation: "permanently_inapplicable", receipt_state: "absent", visit_id: "visit-1", command_id: input.command_id, expected_revision: input.expected_revision, current_revision: 2 } } } }))); mount({ path: "/areas/in-out/visits?visit=visit-1" }); fireEvent.click(await screen.findByRole("button", { name: "Edit visit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit visit" }); await within(dialog).findByRole("button", { name: "Meera Das" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Visit for" }), { target: { value: "Revised purpose" } }); fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByRole("button", { name: "Review latest" })).toBeVisible(); expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
    vi.mocked(getVisit).mockResolvedValue(visitDetail({ visit: visitFixture({ revision: 2, title: "Another operator’s change" }) }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Review latest" }));
    expect(await within(dialog).findByRole("region", { name: "Current saved visit" })).toHaveTextContent("Another operator’s change"); expect(within(dialog).getByRole("textbox", { name: "Visit for" })).toHaveValue("Revised purpose");
    expect(updateVisit).toHaveBeenCalledTimes(1);
  });
  it("records an explicit partial group observation rather than whole-group presence", async () => {
    vi.mocked(recordVisitMovement).mockResolvedValue(visitDetail({ visit: visitFixture({ revision: 2, last_movement: { direction: "in", observed_count: 4, occurred_at: "2026-10-27T09:00:00Z" } }), can_record_exit: true }));
    mount({ path: "/areas/in-out/visits?visit=visit-1" }); fireEvent.click(await screen.findByRole("button", { name: "Record arrival" })); const dialog = screen.getByRole("dialog", { name: "Record arrival" });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "People observed" }), { target: { value: "4" } }); fireEvent.click(within(dialog).getByRole("button", { name: "Record arrival" }));
    await waitFor(() => expect(recordVisitMovement).toHaveBeenCalledWith("school", "visit-1", expect.objectContaining({ expected_revision: 1, direction: "in", observed_count: 4 })));
    expect(await screen.findByText("Arrival recorded · 4 people")).toBeVisible(); expect(screen.queryByText(/inside/i)).not.toBeInTheDocument();
  });
  it("allows first-observed departure and unexpected extra people without inventing arrival", async () => {
    vi.mocked(recordVisitMovement).mockResolvedValue(visitDetail({ visit: visitFixture({ revision: 2, last_movement: { direction: "out", observed_count: 15, occurred_at: "2026-10-27T10:00:00Z" } }) }));
    mount({ path: "/areas/in-out/visits?visit=visit-1" }); fireEvent.click(await screen.findByRole("button", { name: "Record departure" }));
    const dialog = screen.getByRole("dialog", { name: "Record departure" }); fireEvent.change(within(dialog).getByRole("spinbutton", { name: "People observed" }), { target: { value: "15" } });
    expect(within(dialog).getByRole("button", { name: "Record departure" })).toBeEnabled(); fireEvent.click(within(dialog).getByRole("button", { name: "Record departure" }));
    await waitFor(() => expect(recordVisitMovement).toHaveBeenCalledWith("school", "visit-1", expect.objectContaining({ direction: "out", observed_count: 15 })));
    expect(recordVisitMovement).toHaveBeenCalledTimes(1); expect(await screen.findByText("Departure recorded · 15 people")).toBeVisible(); expect(screen.queryByText(/Arrival recorded/)).not.toBeInTheDocument();
  });
  it("keeps planned group size editable after a movement while retaining guest identity", async () => {
    vi.mocked(getVisit).mockResolvedValue(visitDetail({ visit: visitFixture({ last_movement: { direction: "in", observed_count: 4, occurred_at: "2026-10-27T09:00:00Z" } }) }));
    mount({ path: "/areas/in-out/visits?visit=visit-1" }); fireEvent.click(await screen.findByRole("button", { name: "Edit visit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit visit" }); await within(dialog).findByRole("button", { name: "Meera Das" });
    await waitFor(() => expect(within(dialog).getByRole("spinbutton", { name: "People" })).toBeEnabled()); expect(within(dialog).getByRole("textbox", { name: "Group contact name" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Campus person" })).toBeDisabled();
  });
  it("cancels the plan without fabricating an exit", async () => {
    vi.mocked(cancelVisit).mockResolvedValue(visitDetail({ visit: visitFixture({ state: "cancelled", revision: 2 }), can_edit: false, can_cancel: false, can_record_arrival: false })); mount({ path: "/areas/in-out/visits?visit=visit-1" });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel visit" })); fireEvent.click(within(screen.getByRole("dialog", { name: "Cancel visit" })).getByRole("button", { name: "Cancel visit" }));
    await screen.findByText("Cancelled"); expect(cancelVisit).toHaveBeenCalledWith("school", "visit-1", expect.objectContaining({ expected_revision: 1 })); expect(recordVisitMovement).not.toHaveBeenCalled();
  });
  it("keeps pending conflicts locked until the exact receipt can be checked", async () => {
    vi.mocked(createVisit).mockRejectedValue(new ApiError("Still pending", 409, { error: { code: "visit_pending" } })); mount(); const dialog = await openGuestEditor(); fireEvent.click(within(dialog).getByRole("button", { name: "Confirm visit" }));
    expect(await within(dialog).findByRole("button", { name: "Check result" })).toBeVisible(); expect(within(dialog).getByRole("textbox", { name: "Guest name" })).toBeDisabled(); expect(within(dialog).queryByRole("button", { name: "Review latest" })).not.toBeInTheDocument();
  });
  it("shows retained historical destinations and dates without technical record IDs", async () => {
    vi.mocked(getVisit).mockResolvedValue(visitDetail({ history: [{ revision: 1, action: "arranged", recorded_at: "2026-10-26T08:00:00Z", actor: { id: "actor", label: "Meera Das" }, title: "Original demonstration", guest_name: "Riverview School", guest_label: "Riverview School", person_id: null, party_size: 12, starts_at: "2026-10-27T09:00:00Z", ends_at: "2026-10-27T10:00:00Z", place_id: "private-room-id", place_label: "Original laboratory", contact_person_id: "contact", contact_label: "Meera Das", state: "confirmed", last_movement: null }], history_has_more: false }));
    mount({ path: "/areas/in-out/visits?visit=visit-1" }); fireEvent.click(await screen.findByText("History"));
    expect(await screen.findByText("Original demonstration · Riverview School")).toBeVisible(); expect(screen.getByText(/Original laboratory/)).toBeVisible(); expect(screen.queryByText("private-room-id")).not.toBeInTheDocument();
  });
  it("pauses every mutation in a stopped Simulation", async () => {
    mount({ path: "/areas/in-out/visits?visit=visit-1", environment: { mode: "simulation", namespaceId: "simulation:visits", runId: "visits-run", runStatus: "stopped", virtualClock: { now: "2026-10-26T09:00:00Z", timeZone: "UTC" } } });
    expect(await screen.findByRole("button", { name: "Record arrival" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Edit visit" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Cancel visit" })).toBeDisabled();
  });
  it("hides retained details after denied refresh and never reads when the manifest denies the surface", async () => {
    const client = mount({ path: "/areas/in-out/visits?visit=visit-1" }); await screen.findByRole("region", { name: "Visit arrangement" }); vi.mocked(getVisit).mockRejectedValue(new ApiError("Access revoked", 403));
    await client.invalidateQueries({ queryKey: executionEnvironmentQueryKey({ mode: "live" }, ["gate-visits", "school", "actor"]) }); expect(await screen.findByRole("alert")).toHaveTextContent("Access revoked"); expect(screen.queryByText("Riverview School")).not.toBeInTheDocument();
    cleanup(); vi.mocked(getVisits).mockClear(); vi.mocked(useWorkspaceManifest).mockReturnValue({ isPending: false, error: null, data: { context: { institution_id: "school", environment: { kind: "live" } }, areas: [] } } as unknown as ReturnType<typeof useWorkspaceManifest>); mount({ route: true });
    await screen.findByRole("heading", { name: "Your workspace access changed" }); expect(getVisits).not.toHaveBeenCalled();
  });
});
