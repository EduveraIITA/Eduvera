import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiBlob } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { actOnRepair, confirmFacilitiesCommand, getFacilitiesOptions, getFacilitiesSettings, getRepair, reportRepair, saveFacilitiesSettings, uploadRepairPhoto } from "./facilitiesApi";
import { RepairReportDialog } from "./RepairReportDialog";
import { RepairActionDialog } from "./RepairActionDialog";
import { RepairDetailView } from "./RepairDetailView";
import { RepairPhotoDialog } from "./RepairPhotoDialog";
import { FacilitiesSetupDialog } from "./FacilitiesSetupDialog";
import { repairFixture, repairOptions, repairSettings } from "./facilities.test-fixtures";

vi.mock("./facilitiesApi", async original => ({ ...await original<typeof import("./facilitiesApi")>(), actOnRepair: vi.fn(), confirmFacilitiesCommand: vi.fn(), getFacilitiesOptions: vi.fn(), getFacilitiesSettings: vi.fn(), getRepair: vi.fn(), reportRepair: vi.fn(), saveFacilitiesSettings: vi.fn(), uploadRepairPhoto: vi.fn() }));
vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiBlob: vi.fn() }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => {
  vi.mocked(getFacilitiesOptions).mockResolvedValue(repairOptions()); vi.mocked(getRepair).mockResolvedValue(repairFixture());
  vi.mocked(reportRepair).mockImplementation((_school, body) => Promise.resolve(repairFixture({ id: body.command_id })));
  vi.mocked(actOnRepair).mockResolvedValue(repairFixture({ revision: 2 })); vi.mocked(uploadRepairPhoto).mockResolvedValue(repairFixture({ revision: 2 }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount(children: React.ReactNode, environment: ExecutionEnvironment = { mode: "live" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter>{children}</MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
}
function mountReport(canManage = false, refresh = vi.fn().mockResolvedValue(undefined)) {
  const onSaved = vi.fn(), onClose = vi.fn(); mount(<RepairReportDialog schoolId="school" actorId="actor" settings={repairSettings()} canManage={canManage} refresh={refresh} onClose={onClose} onSaved={onSaved} />); return { onSaved, onClose, refresh };
}
function staleRepair(id: string, commandId: string, expected = 1, current = 2) {
  return new ApiError("Repair changed", 409, { error: { code: "facilities_obsolete", fields: { facilities_obsolete: { confirmation: "permanently_inapplicable", receipt_state: "absent", repair_id: id, command_id: commandId, expected_revision: expected, current_revision: current, reason: "stream_advanced" } } } });
}
async function fillReport(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "Where?" }), "Hostel room 203"); await user.type(screen.getByRole("textbox", { name: "What’s wrong?" }), "Water leaking below the sink");
}
describe("short direct and assisted repair intake", () => {
  it("prefills the exact selected asset and shares structured status only by an explicit choice", async () => {
    const user = userEvent.setup(), onSaved = vi.fn();
    mount(<RepairReportDialog schoolId="school" actorId="actor" settings={repairSettings()} canManage={false} refresh={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} onSaved={onSaved}
      initialContext={{ holding: { id: "lamp-holding", label: "Courtyard lamp", asset_tag: "L-1", map_status_supported: true }, place: { id: "courtyard", label: "Courtyard" } }} />);
    expect(screen.getByRole("button", { name: "Courtyard lamp" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Courtyard" })).toBeVisible();
    expect(screen.getByLabelText("Asset status")).toHaveValue("");
    await user.click(screen.getByText("Share asset status on campus map"));
    await user.selectOptions(screen.getByLabelText("Asset status"), "not_working");
    expect(screen.getByText("This asset status appears on the campus map. Your description and photos stay private.")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "What’s wrong?" }), "Lamp does not light up");
    await user.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(reportRepair).toHaveBeenCalledWith("school", expect.objectContaining({ holding_id: "lamp-holding", space_id: "courtyard", asset_impact: "not_working", location_note: "" }));
  });
  it("keeps unmapped assets private and clears a shared status when the linked item is removed", async () => {
    const user = userEvent.setup(), onSaved = vi.fn();
    mount(<RepairReportDialog schoolId="school" actorId="actor" settings={repairSettings()} canManage={false} refresh={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} onSaved={onSaved}
      initialContext={{ holding: { id: "lamp-holding", label: "Courtyard lamp", asset_tag: null, map_status_supported: true }, place: { id: "courtyard", label: "Courtyard" } }} />);
    await user.click(screen.getByText("Share asset status on campus map"));
    await user.selectOptions(screen.getByLabelText("Asset status"), "degraded");
    await user.click(screen.getByRole("button", { name: "Clear selected item" }));
    expect(screen.queryByLabelText("Asset status")).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "What’s wrong?" }), "Water point needs checking");
    await user.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(reportRepair).toHaveBeenCalledWith("school", expect.objectContaining({ holding_id: null, asset_impact: null }));
  });
  it("reports with a location description without forcing inventory or assigning an account", async () => {
    const user = userEvent.setup(), result = mountReport(); await fillReport(user); await user.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(result.onSaved).toHaveBeenCalledOnce()); expect(reportRepair).toHaveBeenCalledWith("school", expect.objectContaining({ expected_revision: 0, location_note: "Hostel room 203", problem: "Water leaking below the sink", space_id: null, holding_id: null, urgent: false }));
    expect(vi.mocked(reportRepair).mock.calls[0]![1]).not.toHaveProperty("reporter_person_id"); expect(screen.queryByText("Recording for someone else")).not.toBeInTheDocument();
  });
  it("keeps the affected passive person separate from the recorder", async () => {
    const user = userEvent.setup(), result = mountReport(true); await fillReport(user); await user.click(screen.getByText("Recording for someone else")); await user.click(screen.getByRole("button", { name: "Choose the person reporting" }));
    await user.click(await screen.findByRole("button", { name: /Amit Kumar/ })); await user.click(screen.getByRole("button", { name: "Send report" })); await waitFor(() => expect(result.onSaved).toHaveBeenCalledOnce());
    expect(reportRepair).toHaveBeenCalledWith("school", expect.objectContaining({ reporter_person_id: "passive" }));
  });
  it("surfaces urgent contact guidance without claiming an emergency response", async () => {
    const user = userEvent.setup(); mountReport(); await user.click(screen.getByRole("checkbox", { name: "Urgent safety concern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Campus security desk"); expect(screen.getByRole("alert")).toHaveTextContent("does not guarantee an immediate response"); expect(reportRepair).not.toHaveBeenCalled();
  });
  it("preserves the selected photo for a separate upload after the accepted report", async () => {
    const user = userEvent.setup(), result = mountReport(), file = new File(["synthetic image"], "leak.png", { type: "image/png" });
    await fillReport(user); await user.upload(screen.getByLabelText("Attach a photo"), file); await user.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(result.onSaved).toHaveBeenCalledWith(expect.any(String), file)); expect(uploadRepairPhoto).not.toHaveBeenCalled(); expect(reportRepair).toHaveBeenCalledOnce();
  });
  it("rejects an invalid optional photo without hiding the report", () => {
    mountReport(); fireEvent.change(screen.getByLabelText("Attach a photo"), { target: { files: [new File(["text"], "file.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("JPEG or PNG"); expect(screen.getByRole("textbox", { name: "What’s wrong?" })).toBeVisible();
  });
  it("locks a lost report response and retries its exact command only after checking", async () => {
    const user = userEvent.setup(), result = mountReport(); vi.mocked(reportRepair).mockRejectedValueOnce(new TypeError("Connection lost")); vi.mocked(confirmFacilitiesCommand).mockResolvedValue({ state: "not_found" });
    await fillReport(user); await user.click(screen.getByRole("button", { name: "Send report" })); await screen.findByRole("button", { name: "Check result" });
    expect(screen.getByRole("textbox", { name: "Where?" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Check result" })); await user.click(await screen.findByRole("button", { name: "Retry same action" })); await waitFor(() => expect(result.onSaved).toHaveBeenCalledOnce());
    expect(vi.mocked(reportRepair).mock.calls[1]).toEqual(vi.mocked(reportRepair).mock.calls[0]);
  });
  it("does not resend an accepted report when only its refresh failed", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("Read unavailable")).mockResolvedValueOnce(undefined), user = userEvent.setup(), result = mountReport(false, refresh);
    await fillReport(user); await user.click(screen.getByRole("button", { name: "Send report" })); await user.click(await screen.findByRole("button", { name: "Refresh saved record" })); await waitFor(() => expect(result.onSaved).toHaveBeenCalledOnce()); expect(reportRepair).toHaveBeenCalledOnce();
  });
});
describe("owned progress and explicit checking", () => {
  it("shows the report heading once and retains the remaining description", () => {
    mount(<RepairDetailView schoolId="school" actorId="actor" repair={repairFixture({ title: "Projector has no image", problem: "Projector has no image\nThe status light is on but the screen is blank." })} timezone="Asia/Kolkata" readOnly refresh={vi.fn()} historyPage={1} onHistoryPage={vi.fn()} />);
    expect(screen.getAllByText("Projector has no image")).toHaveLength(1);
    expect(screen.getByText("The status light is on but the screen is blank.")).toBeVisible();
  });
  it("shows current responsibility, unknown estimate and latest progress without opening history", () => {
    const latest = { id: "latest", revision: 3, action: "updated", actor_label: "Dev Shah", note: "Projector cable ordered; the classroom can use the spare display.", state: "waiting" as const, wait_reason: "parts" as const, expected_finish_at: null, recorded_at: "2026-10-24T09:00:00Z" };
    mount(<RepairDetailView schoolId="school" actorId="actor" repair={repairFixture({ state: "waiting", wait_reason: "parts", latest_progress: latest, history: [] })} timezone="Asia/Kolkata" readOnly refresh={vi.fn()} historyPage={2} onHistoryPage={vi.fn()} />);
    expect(screen.getByLabelText("Current repair progress")).toHaveTextContent("Dev Shah is following up · waiting for parts");
    expect(screen.getByText("Finish estimate not shared yet")).toBeVisible();
    expect(screen.getByRole("region", { name: "Latest repair update" })).toHaveTextContent(latest.note);
  });
  it("keeps infrequent responsibility changes collapsed without hiding the primary action", async () => {
    const user = userEvent.setup();
    mount(<RepairDetailView schoolId="school" actorId="actor" repair={repairFixture()} timezone="Asia/Kolkata" readOnly={false} refresh={vi.fn()} historyPage={1} onHistoryPage={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Accept repair" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Change handler", hidden: true })).not.toBeVisible();
    await user.click(screen.getByText("Change responsibility", { selector: "summary" }));
    expect(screen.getByRole("button", { name: "Change handler" })).toBeVisible();
  });
  it("does not present a previous estimate as unfinished work after checked closure", () => {
    mount(<RepairDetailView schoolId="school" actorId="actor" repair={repairFixture({ state: "closed", expected_finish_at: "2026-10-24T12:00:00Z", allowed_actions: { accept: false, assign: false, update: false, complete: false, verify: false, reopen: true, add_photo: false } })} timezone="Asia/Kolkata" readOnly={false} refresh={vi.fn()} historyPage={1} onHistoryPage={vi.fn()} />);
    expect(screen.getByText("Repair checked and closed. Reopen it if more work is needed.")).toBeVisible();
    expect(screen.queryByText(/Expected finish/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen repair" })).toBeVisible();
  });
  it.each([false, true])("returns after a confirmed handoff removes detail access (lost response: %s)", async lost => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined), transferred = vi.fn().mockResolvedValue(undefined), closed = vi.fn();
    if (lost) { vi.mocked(actOnRepair).mockRejectedValueOnce(new TypeError("Response lost")); vi.mocked(confirmFacilitiesCommand).mockResolvedValue({ state: "accepted", result: { id: "repair-1", revision: 2, access_transferred: true } }); }
    else vi.mocked(actOnRepair).mockResolvedValueOnce(repairFixture({ revision: 2, access_transferred: true }));
    mount(<RepairActionDialog schoolId="school" actorId="actor" repair={repairFixture()} action="assign" refresh={refresh} onClose={closed} onTransferred={transferred} />);
    await user.click(screen.getByRole("button", { name: "Choose person" })); await user.click(await screen.findByRole("button", { name: /Asha Patel/ })); await user.type(screen.getByRole("textbox", { name: "Reason" }), "Covering this repair today"); await user.click(screen.getByRole("button", { name: "Change responsible person" })); if (lost) await user.click(await screen.findByRole("button", { name: "Check result" }));
    await waitFor(() => expect(transferred).toHaveBeenCalledOnce()); expect(closed).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled(); expect(actOnRepair).toHaveBeenCalledOnce();
  });
  it("assigns one repair to a person with app access without requiring campus-wide management", async () => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined);
    mount(<RepairActionDialog schoolId="school" actorId="actor" repair={repairFixture()} action="assign" refresh={refresh} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Choose person" }));
    expect(await screen.findByRole("button", { name: /Asha Patel/ })).toBeVisible();
    expect(getFacilitiesOptions).toHaveBeenCalledWith("school", "", 1, "repair-1");
    expect(screen.queryByRole("button", { name: /Amit Kumar/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Asha Patel/ })); await user.type(screen.getByRole("textbox", { name: "Reason" }), "Covering this repair today"); await user.click(screen.getByRole("button", { name: "Change responsible person" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce()); expect(actOnRepair).toHaveBeenCalledWith("school", "repair-1", expect.objectContaining({ action: "assign", handler_person_id: "reporter", expected_revision: 1 }));
  });
  it("recovers a verifier independently, without claiming the repair has been checked", async () => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined), repair = repairFixture({ state: "awaiting_verification", route_unavailable: true, allowed_actions: { accept: false, assign: true, assign_verifier: true, update: false, complete: false, verify: false, reopen: false, add_photo: true } });
    mount(<RepairDetailView schoolId="school" actorId="actor" repair={repair} timezone="Asia/Kolkata" readOnly={false} refresh={refresh} historyPage={1} onHistoryPage={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Change verifier" })); await user.click(screen.getByRole("button", { name: "Choose person" })); await user.click(await screen.findByRole("button", { name: /Dev Shah/ }));
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "Warden will inspect instead"); await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Change verifier" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce()); expect(actOnRepair).toHaveBeenCalledWith("school", "repair-1", expect.objectContaining({ action: "assign", verifier_person_id: "handler" })); expect(vi.mocked(actOnRepair).mock.calls[0]![2]).not.toHaveProperty("handler_person_id");
  });
  it("restores an orphaned coordinator without changing the worker or verifier", async () => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined), repair = repairFixture({ recovery_only: true, route_unavailable: true, allowed_actions: { accept: false, assign: false, assign_coordinator: true, update: false, complete: false, verify: false, reopen: false, add_photo: false } });
    mount(<RepairDetailView schoolId="school" actorId="actor" repair={repair} timezone="Asia/Kolkata" readOnly={false} refresh={refresh} historyPage={1} onHistoryPage={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Change coordinator" })); await user.click(screen.getByRole("button", { name: "Choose person" })); await user.click(await screen.findByRole("button", { name: /Asha Patel/ }));
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "Previous coordinator has left"); await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Change coordinator" })); await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const body = vi.mocked(actOnRepair).mock.calls[0]![2]; expect(body).toMatchObject({ action: "assign", coordinator_person_id: "reporter" }); expect(body).not.toHaveProperty("handler_person_id"); expect(body).not.toHaveProperty("verifier_person_id");
  });
  it("records a parts wait and estimate on the same revision, not completion", async () => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined), repair = repairFixture({ state: "accepted", allowed_actions: { accept: false, assign: true, update: true, complete: true, verify: false, reopen: false, add_photo: true } });
    mount(<RepairActionDialog schoolId="school" actorId="actor" repair={repair} action="update" refresh={refresh} onClose={vi.fn()} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Progress" }), "waiting"); await user.selectOptions(screen.getByRole("combobox", { name: "Waiting for" }), "parts");
    await user.click(screen.getByText("Expected finish", { selector: "summary" })); fireEvent.change(screen.getByLabelText(/Expected finish/), { target: { value: "2026-11-02T15:30" } }); await user.type(screen.getByRole("textbox", { name: "Update" }), "Replacement pipe ordered"); await user.click(screen.getByRole("button", { name: "Update progress" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce()); expect(actOnRepair).toHaveBeenCalledWith("school", "repair-1", expect.objectContaining({ action: "update", expected_revision: 1, status: "waiting", wait_reason: "parts", note: "Replacement pipe ordered", expected_finish_at: new Date("2026-11-02T15:30").toISOString() }));
  });
  it("requires an explicit check before closing, without giving a verifier handler actions", async () => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined), repair = repairFixture({ state: "awaiting_verification", allowed_actions: { accept: false, assign: false, update: false, complete: false, verify: true, reopen: true, add_photo: true } });
    mount(<RepairDetailView schoolId="school" actorId="actor" repair={repair} timezone="Asia/Kolkata" readOnly={false} refresh={refresh} historyPage={1} onHistoryPage={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Update progress" })).not.toBeInTheDocument(); await user.click(screen.getByRole("button", { name: "Confirm repaired" }));
    const dialog = screen.getByRole("dialog"), submit = within(dialog).getByRole("button", { name: "Confirm repaired" }); expect(submit).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox", { name: /I checked the repair/ })); await user.click(submit); await waitFor(() => expect(refresh).toHaveBeenCalledOnce()); expect(actOnRepair).toHaveBeenCalledWith("school", "repair-1", expect.objectContaining({ action: "verify", expected_revision: 1 }));
  });
  it("reopens the same repair with a reason instead of making another complaint", async () => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined), repair = repairFixture({ state: "closed", allowed_actions: { accept: false, assign: false, update: false, complete: false, verify: false, reopen: true, add_photo: false } });
    mount(<RepairActionDialog schoolId="school" actorId="actor" repair={repair} action="reopen" refresh={refresh} onClose={vi.fn()} />);
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "Water is still dripping"); await user.click(screen.getByRole("button", { name: "Reopen repair" })); await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(actOnRepair).toHaveBeenCalledWith("school", "repair-1", expect.objectContaining({ action: "reopen", note: "Further work needed: Water is still dripping" })); expect(reportRepair).not.toHaveBeenCalled();
    expect(vi.mocked(actOnRepair).mock.calls[0]![2]).not.toHaveProperty("reopen_kind");
  });
  it.each(["further_work", "record_amendment"] as const)("records an explicit %s when reopening a shared asset repair", async kind => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined);
    const repair = repairFixture({ state: "closed", asset_impact: "not_working", allowed_actions: { accept: false, assign: false, update: false, complete: false, verify: false, reopen: true, add_photo: false } });
    mount(<RepairActionDialog schoolId="school" actorId="actor" repair={repair} action="reopen" refresh={refresh} onClose={vi.fn()} />);
    const choice = screen.getByRole("combobox", { name: "Reopen for" });
    expect(choice).toHaveValue("Further work needed");
    if (kind === "record_amendment") {
      await user.selectOptions(choice, "Record amendment needed");
      expect(screen.getByText("A record amendment does not report a new fault or clear an unresolved fault.")).toBeVisible();
    } else expect(screen.getByText("Further work marks this asset as needing work again on the campus map.")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "Please review this repair");
    await user.click(screen.getByRole("button", { name: "Reopen repair" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(actOnRepair).toHaveBeenCalledWith("school", "repair-1", expect.objectContaining({ action: "reopen", reopen_kind: kind, expected_revision: 1 }));
  });
  it("requires current reviewed state after a source-bound stale proof", async () => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(actOnRepair).mockImplementationOnce((_school, id, body) => Promise.reject(new ApiError("Repair changed", 409, { error: { code: "facilities_obsolete", fields: { facilities_obsolete: { confirmation: "permanently_inapplicable", receipt_state: "absent", repair_id: id, command_id: body.command_id, expected_revision: 1, current_revision: 2, reason: "stream_advanced" } } } })));
    vi.mocked(getRepair).mockResolvedValue(repairFixture({ revision: 2 }));
    mount(<RepairActionDialog schoolId="school" actorId="actor" repair={repairFixture()} action="accept" refresh={refresh} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Accept repair" })); await user.click(await screen.findByRole("button", { name: "Review current record" })); await waitFor(() => expect(screen.getByRole("button", { name: "Accept repair" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Accept repair" })); await waitFor(() => expect(refresh).toHaveBeenCalledOnce()); const calls = vi.mocked(actOnRepair).mock.calls;
    expect(calls[1]![2].expected_revision).toBe(2); expect(calls[1]![2].command_id).not.toBe(calls[0]![2].command_id);
  });
  it("shows a changed completion recipient before retrying a stale report of work done", async () => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined), repair = repairFixture({ state: "in_progress", allowed_actions: { accept: false, assign: false, update: true, complete: true, verify: false, reopen: false, add_photo: true } });
    vi.mocked(actOnRepair).mockImplementationOnce((_school, id, body) => Promise.reject(staleRepair(id, body.command_id)));
    vi.mocked(getRepair).mockResolvedValue({ ...repair, revision: 2, verifier: { id: "new-verifier", label: "Meera Rao" } });
    mount(<RepairActionDialog schoolId="school" actorId="actor" repair={repair} action="complete" refresh={refresh} onClose={vi.fn()} />);
    await user.type(screen.getByRole("textbox", { name: "What was done?" }), "Replaced and tested the pipe"); await user.click(screen.getByRole("button", { name: "Report work done" })); await user.click(await screen.findByRole("button", { name: "Review current record" }));
    expect(await screen.findByRole("status", { name: "Current repair state" })).toHaveTextContent("Meera Rao"); expect(screen.getByText(/Your report goes to Meera Rao/)).toBeVisible(); expect(screen.getByRole("textbox", { name: "What was done?" })).toHaveValue("Replaced and tested the pipe");
    expect(actOnRepair).toHaveBeenCalledOnce(); await user.click(screen.getByRole("button", { name: "Report work done" })); await waitFor(() => expect(refresh).toHaveBeenCalledOnce()); expect(vi.mocked(actOnRepair).mock.calls[1]![2].expected_revision).toBe(2);
  });
  it("clears earlier verification consent when fresh evidence advanced the repair", async () => {
    const user = userEvent.setup(), repair = repairFixture({ state: "awaiting_verification", allowed_actions: { accept: false, assign: false, update: false, complete: false, verify: true, reopen: true, add_photo: true } }), refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(actOnRepair).mockImplementationOnce((_school, id, body) => Promise.reject(staleRepair(id, body.command_id)));
    vi.mocked(getRepair).mockResolvedValue({ ...repair, revision: 2, photos: [{ id: "new-photo", file_name: "remaining-drip.png", content_type: "image/png", size: 100, created_at: "2026-10-24T10:00:00Z", href: "/unused" }], history: [{ id: "photo-entry", revision: 2, action: "photo_added", actor_label: "Dev Shah", note: "Inspect the remaining drip", state: "awaiting_verification", wait_reason: null, expected_finish_at: null, recorded_at: "2026-10-24T10:00:00Z" }] });
    mount(<RepairActionDialog schoolId="school" actorId="actor" repair={repair} action="verify" refresh={refresh} onClose={vi.fn()} />);
    await user.click(screen.getByText("Add note", { selector: "summary" })); await user.type(screen.getByRole("textbox", { name: "Note Optional" }), "Checked the bathroom"); await user.click(screen.getByRole("checkbox", { name: /I checked the repair/ })); await user.click(screen.getByRole("button", { name: "Confirm repaired" })); await user.click(await screen.findByRole("button", { name: "Review current record" }));
    const summary = await screen.findByRole("status", { name: "Current repair state" }); expect(summary).toHaveTextContent("1 photo"); expect(summary).toHaveTextContent("Inspect the remaining drip"); expect(screen.getByRole("checkbox", { name: /I checked the repair/ })).not.toBeChecked(); expect(screen.getByRole("textbox", { name: "Note Optional" })).toHaveValue("Checked the bathroom"); expect(screen.getByRole("button", { name: "Confirm repaired" })).toBeDisabled(); expect(actOnRepair).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("checkbox", { name: /I checked the repair/ })); await user.click(screen.getByRole("button", { name: "Confirm repaired" })); await waitFor(() => expect(refresh).toHaveBeenCalledOnce()); expect(vi.mocked(actOnRepair).mock.calls[1]![2].expected_revision).toBe(2);
  });
  it("keeps orphan recovery private and exposes only the permitted repair action", () => {
    mount(<RepairDetailView schoolId="school" actorId="actor" repair={repairFixture({ recovery_only: true, route_unavailable: true, title: "Repair needs reassignment", problem: "Repair needs reassignment", history: [], photos: [], allowed_actions: { accept: false, assign: true, update: false, complete: false, verify: false, reopen: false, add_photo: false } })} timezone="Asia/Kolkata" readOnly={false} refresh={vi.fn()} historyPage={1} onHistoryPage={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("cannot receive this work"); expect(screen.getByRole("button", { name: "Change handler" })).toBeEnabled(); expect(screen.queryByText(/Report details|Repair history|Photos/)).not.toBeInTheDocument();
  });
  it("distinguishes a verifier handoff from work completion in history", async () => {
    const user = userEvent.setup(); mount(<RepairDetailView schoolId="school" actorId="actor" repair={repairFixture({ history: [{ id: "history-1", revision: 2, action: "assigned", assignment_target: "verifier", actor_label: "Dev Shah", note: "Warden will check", verifier_label: "Meera Rao", previous_verifier_label: "Asha Patel", state: "awaiting_verification", wait_reason: null, expected_finish_at: null, recorded_at: "2026-10-24T09:00:00Z" }] })} timezone="Asia/Kolkata" readOnly refresh={vi.fn()} historyPage={1} onHistoryPage={vi.fn()} />);
    await user.click(screen.getByText("Repair history · 1")); expect(screen.getByText("Verifier changed")).toBeVisible(); expect(screen.getByText("Asha Patel → Meera Rao")).toBeVisible(); expect(screen.queryByText("Repair checked and closed")).not.toBeInTheDocument();
  });
});
describe("explicit settings and protected photos", () => {
  it("recovers a stale settings revision without an endless same-command retry", async () => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined), onClose = vi.fn();
    vi.mocked(saveFacilitiesSettings).mockImplementationOnce((_school, body) => Promise.reject(staleRepair("school", body.command_id))).mockResolvedValueOnce(repairSettings({ revision: 3 }));
    vi.mocked(getFacilitiesSettings).mockResolvedValue(repairSettings({ revision: 2, handler_person_id: "new-handler", handler: { id: "new-handler", label: "Meera Rao" } }));
    mount(<FacilitiesSetupDialog schoolId="school" actorId="actor" settings={repairSettings()} refresh={refresh} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Save settings" })); await user.click(await screen.findByRole("button", { name: "Review current record" }));
    expect(await screen.findByRole("status", { name: "Current repair settings" })).toHaveTextContent("Meera Rao"); expect(confirmFacilitiesCommand).not.toHaveBeenCalled(); expect(saveFacilitiesSettings).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Save settings" })); await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const calls = vi.mocked(saveFacilitiesSettings).mock.calls; expect(calls[1]![1].expected_revision).toBe(2); expect(calls[1]![1].command_id).not.toBe(calls[0]![1].command_id);
  });
  it("does not activate a hidden default handler", async () => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined); vi.mocked(saveFacilitiesSettings).mockResolvedValue(repairSettings());
    mount(<FacilitiesSetupDialog schoolId="school" actorId="actor" settings={repairSettings({ configured: false, revision: 0, handler_person_id: null })} refresh={refresh} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start repairs" })).toBeDisabled(); await user.click(screen.getByRole("button", { name: "Choose responsible person" })); await user.click(await screen.findByRole("button", { name: /Dev Shah/ })); await user.click(screen.getByRole("button", { name: "Start repairs" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce()); expect(saveFacilitiesSettings).toHaveBeenCalledWith("school", expect.objectContaining({ expected_revision: 0, handler_person_id: "handler", verifier_mode: "reporter" }));
  });
  it("keeps an accepted report separate from photo upload failure", async () => {
    const user = userEvent.setup(), photo = new File(["synthetic image"], "leak.png", { type: "image/png" }); vi.mocked(uploadRepairPhoto).mockRejectedValueOnce(new TypeError("Photo connection lost")); vi.mocked(confirmFacilitiesCommand).mockResolvedValue({ state: "not_found" });
    mount(<RepairPhotoDialog schoolId="school" repair={repairFixture()} initialFile={photo} reportSaved refresh={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Report saved"); await user.click(await screen.findByRole("button", { name: "Check result" })); await user.click(await screen.findByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(uploadRepairPhoto).toHaveBeenCalledTimes(2)); expect(vi.mocked(uploadRepairPhoto).mock.calls[1]).toEqual(vi.mocked(uploadRepairPhoto).mock.calls[0]); expect(reportRepair).not.toHaveBeenCalled();
  });
  it("labels omitted Simulation originals without rendering or downloading them as evidence", async () => {
    const user = userEvent.setup(); vi.mocked(apiBlob).mockResolvedValue(new Blob(["placeholder"], { type: "image/svg+xml" }));
    const photo = { id: "photo-1", file_name: "leak.png", content_type: "image/png", size: 100, created_at: "2026-10-24T08:00:00Z", href: "/untrusted-not-used" };
    mount(<RepairDetailView schoolId="school" actorId="actor" repair={repairFixture({ photos: [photo] })} timezone="Asia/Kolkata" readOnly={false} refresh={vi.fn()} historyPage={1} onHistoryPage={vi.fn()} />, { mode: "simulation", namespaceId: "simulation:repairs", runId: "repairs-run", runStatus: "running", virtualClock: { now: "2026-10-24T09:00:00Z", timeZone: "Asia/Kolkata" } });
    await user.click(screen.getByRole("button", { name: /leak.png/ })); expect(await screen.findByRole("status")).toHaveTextContent("not repair evidence"); expect(apiBlob).toHaveBeenCalledWith("/api/v1/schools/school/facilities/repairs/repair-1/photos/photo-1"); expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(screen.queryByRole("link", { name: "Download" })).not.toBeInTheDocument();
  });
});
