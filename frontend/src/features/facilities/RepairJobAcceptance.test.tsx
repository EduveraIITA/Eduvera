import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { actOnRepair, confirmFacilitiesCommand } from "./facilitiesApi";
import { activateRepairExternalAccess } from "./repairExternalAccessApi";
import { repairFixture } from "./facilities.test-fixtures";
import { RepairJobAcceptance } from "./RepairJobAcceptance";

vi.mock("./facilitiesApi", async original => ({ ...await original<typeof import("./facilitiesApi")>(), actOnRepair: vi.fn(), confirmFacilitiesCommand: vi.fn() }));
vi.mock("./repairExternalAccessApi", () => ({ activateRepairExternalAccess: vi.fn() }));
const access = { id: "grant-1", person: { id: "technician", label: "Amit Kumar", revision: 1, has_app_access: true }, starts_at: "2026-10-26T00:00:00Z", ends_at: "2026-11-02T00:00:00Z", instructions: "Replace the light fitting", shared_photo_ids: [], state: "ready" as const, can_manage: false, can_activate: true };
const activated = () => repairFixture({ revision: 2, external_view: true, external_access: { ...access, state: "active", can_activate: false } });
beforeEach(() => { vi.mocked(activateRepairExternalAccess).mockResolvedValue(activated()); vi.mocked(actOnRepair).mockResolvedValue(repairFixture({ revision: 3, state: "accepted" })); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount() {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<MemoryRouter><RepairJobAcceptance schoolId="school" repair={repairFixture({ external_view: true, external_access: access })} refresh={refresh} /></MemoryRouter>);
  return refresh;
}
describe("one decision to accept an external repair job", () => {
  it("activates then accepts with two independent immutable commands and the resulting revision", async () => {
    const refresh = mount(); await userEvent.click(screen.getByRole("button", { name: "Accept job" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const activation = vi.mocked(activateRepairExternalAccess).mock.calls[0]![3], acceptance = vi.mocked(actOnRepair).mock.calls[0]![2];
    expect(activation.expected_revision).toBe(1); expect(acceptance).toMatchObject({ action: "accept", expected_revision: 2 });
    expect(activation.command_id).not.toBe(acceptance.command_id);
  });
  it("does not accept after an unknown activation; accepted receipt then advances exactly once", async () => {
    vi.mocked(activateRepairExternalAccess).mockRejectedValueOnce(new Error("Connection lost"));
    vi.mocked(confirmFacilitiesCommand).mockResolvedValue({ state: "accepted", result: { id: "repair-1", revision: 2, external_access_id: access.id } });
    const refresh = mount(); await userEvent.click(screen.getByRole("button", { name: "Accept job" }));
    await screen.findByRole("button", { name: "Check result" }); expect(actOnRepair).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
    const command = vi.mocked(activateRepairExternalAccess).mock.calls[0]![3].command_id;
    await userEvent.click(screen.getByRole("button", { name: "Check result" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(confirmFacilitiesCommand).toHaveBeenCalledWith("school", "repair-1", command); expect(activateRepairExternalAccess).toHaveBeenCalledOnce();
  });
  it("retries missing activation with its original payload and never accepts on pending or wrong receipt", async () => {
    vi.mocked(activateRepairExternalAccess).mockRejectedValueOnce(new Error("Connection lost"));
    vi.mocked(confirmFacilitiesCommand).mockResolvedValueOnce({ state: "pending" }).mockResolvedValueOnce({ state: "accepted", result: { id: "other", revision: 2 } }).mockResolvedValueOnce({ state: "not_found" });
    mount(); await userEvent.click(screen.getByRole("button", { name: "Accept job" }));
    await userEvent.click(await screen.findByRole("button", { name: "Check result" })); expect(actOnRepair).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Check result" })); expect(await screen.findByRole("alert")).toHaveTextContent("does not identify");
    await userEvent.click(screen.getByRole("button", { name: "Check result" }));
    await userEvent.click(await screen.findByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(actOnRepair).toHaveBeenCalledOnce());
    expect(vi.mocked(activateRepairExternalAccess).mock.calls[1]).toEqual(vi.mocked(activateRepairExternalAccess).mock.calls[0]);
  });
  it("keeps unknown acceptance separate from activation, without repeating the first command", async () => {
    vi.mocked(actOnRepair).mockRejectedValueOnce(new Error("Lost acceptance response"));
    vi.mocked(confirmFacilitiesCommand).mockResolvedValue({ state: "accepted", result: { id: "repair-1", revision: 3 } });
    const refresh = mount(); await userEvent.click(screen.getByRole("button", { name: "Accept job" }));
    await userEvent.click(await screen.findByRole("button", { name: "Check result" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(activateRepairExternalAccess).toHaveBeenCalledOnce(); expect(actOnRepair).toHaveBeenCalledOnce();
    expect(confirmFacilitiesCommand).toHaveBeenCalledWith("school", "repair-1", vi.mocked(actOnRepair).mock.calls[0]![2].command_id);
  });
  it("never converts a refused acceptance into success after access activation", async () => {
    vi.mocked(actOnRepair).mockRejectedValue(new ApiError("Job access ended", 403));
    const refresh = mount(); await userEvent.click(screen.getByRole("button", { name: "Accept job" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Access was connected, but acceptance was not saved");
    expect(refresh).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Accept job" })).toBeDisabled();
  });
  it("does not send acceptance after the source component unmounts during activation", async () => {
    let finish!: (value: ReturnType<typeof activated>) => void;
    vi.mocked(activateRepairExternalAccess).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount(); await userEvent.click(screen.getByRole("button", { name: "Accept job" })); cleanup();
    await act(async () => { finish(activated()); await Promise.resolve(); }); expect(actOnRepair).not.toHaveBeenCalled();
  });
  it("requires the exact grant identity in an activation receipt before accepting", async () => {
    vi.mocked(activateRepairExternalAccess).mockRejectedValueOnce(new Error("Response lost"));
    vi.mocked(confirmFacilitiesCommand).mockResolvedValue({ state: "accepted", result: { id: "repair-1", revision: 2, external_access_id: "different-grant" } });
    mount(); await userEvent.click(screen.getByRole("button", { name: "Accept job" })); await userEvent.click(await screen.findByRole("button", { name: "Check result" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not identify this invitation"); expect(actOnRepair).not.toHaveBeenCalled();
  });
  it("retries only the saved view after acceptance succeeds but refresh fails", async () => {
    const refresh = mount(); refresh.mockRejectedValueOnce(new Error("Refresh failed"));
    await userEvent.click(screen.getByRole("button", { name: "Accept job" })); expect(await screen.findByRole("alert")).toHaveTextContent("Job accepted");
    await userEvent.click(screen.getByRole("button", { name: "Check result" })); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(actOnRepair).toHaveBeenCalledOnce(); expect(activateRepairExternalAccess).toHaveBeenCalledOnce();
  });
  it("allows review only with exact native proof the stale command can never be accepted", async () => {
    vi.mocked(activateRepairExternalAccess).mockImplementation((_school, id, _grant, body) => Promise.reject(new ApiError("Source changed", 409, { error: { code: "facilities_obsolete", fields: { facilities_obsolete: { confirmation: "permanently_inapplicable", receipt_state: "absent", reason: "stream_advanced", repair_id: id, command_id: body.command_id, expected_revision: body.expected_revision, current_revision: 2 } } } })));
    mount(); await userEvent.click(screen.getByRole("button", { name: "Accept job" }));
    expect(await screen.findByRole("button", { name: "Review repair" })).toBeVisible(); expect(screen.queryByRole("button", { name: "Check result" })).not.toBeInTheDocument(); expect(actOnRepair).not.toHaveBeenCalled();
  });
  it("keeps a generic conflict locked for receipt recovery instead of treating it as stale proof", async () => {
    vi.mocked(activateRepairExternalAccess).mockRejectedValue(new ApiError("Concurrent update", 409));
    mount(); await userEvent.click(screen.getByRole("button", { name: "Accept job" }));
    expect(await screen.findByRole("button", { name: "Check result" })).toBeVisible(); expect(screen.queryByRole("button", { name: "Review repair" })).not.toBeInTheDocument(); expect(actOnRepair).not.toHaveBeenCalled();
  });
});
