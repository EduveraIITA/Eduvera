import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { invitePersonToApp } from "../onboarding/api";
import { grantRepairExternalAccess } from "./repairExternalAccessApi";
import { repairFixture } from "./facilities.test-fixtures";
import { RepairTechnicianDialog } from "./RepairTechnicianDialog";

vi.mock("../onboarding/api", async original => ({ ...await original<typeof import("../onboarding/api")>(), invitePersonToApp: vi.fn() }));
vi.mock("./repairExternalAccessApi", () => ({ grantRepairExternalAccess: vi.fn() }));
vi.mock("./RepairTechnicianPicker", () => ({ RepairTechnicianPicker: ({ onSelected }: { onSelected: (person: unknown) => void }) => <button onClick={() => onSelected({ id: "technician", label: "Amit Kumar", revision: 4, has_app_access: false })}>Select Amit Kumar</button> }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
const access = { id: "grant-1", person: { id: "technician", label: "Amit Kumar", revision: 4, has_app_access: false }, starts_at: "2026-10-26T00:00:00Z", ends_at: "2026-11-02T00:00:00Z", instructions: "Fix pipe", shared_photo_ids: [], state: "awaiting_sign_in" as const, can_manage: true, can_activate: false };
beforeEach(() => { vi.mocked(grantRepairExternalAccess).mockResolvedValue(repairFixture({ revision: 2, external_access: access })); vi.mocked(invitePersonToApp).mockResolvedValue({ id: "invitation", email: "amit@example.test", token: "not-for-render", expires_at: "2026-10-26T01:00:00Z", delivery: "manual" }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount(simulation = false) { const refresh = vi.fn().mockResolvedValue(undefined); render(<MemoryRouter><ExecutionEnvironmentProvider environment={simulation ? { mode: "simulation", namespaceId: "simulation:repairs", runId: "repairs-run", runStatus: "running", virtualClock: { now: "2026-10-26T00:00:00Z", timeZone: "Asia/Kolkata" } } : { mode: "live" }}><RepairTechnicianDialog schoolId="school" actorId="actor" repair={repairFixture()} refresh={refresh} onClose={vi.fn()} /></ExecutionEnvironmentProvider></MemoryRouter>); return refresh; }
async function fill(email = true) { await userEvent.click(screen.getByRole("button", { name: "Choose person" })); await userEvent.click(screen.getByRole("button", { name: "Select Amit Kumar" })); fireEvent.change(screen.getByLabelText("Access until"), { target: { value: "2026-11-02T17:30" } }); if (email) await userEvent.type(screen.getByLabelText("Invitation email"), "amit@example.test"); }
describe("share one repair with a technician", () => {
  it("reviews source instructions and date, then saves exact access before a neutral contextual invitation", async () => {
    mount(); expect(screen.getByLabelText("Instructions")).toHaveValue("Leaking pipe below the washbasin");
    expect(screen.getByRole("button", { name: "Share job" })).toBeDisabled(); await fill(); await userEvent.click(screen.getByRole("button", { name: "Share job" }));
    await waitFor(() => expect(invitePersonToApp).toHaveBeenCalledOnce());
    expect(grantRepairExternalAccess).toHaveBeenCalledWith("school", "repair-1", expect.objectContaining({ person_id: "technician", expected_person_revision: 4, expected_revision: 1, shared_photo_ids: [] }));
    expect(invitePersonToApp).toHaveBeenCalledWith("school", expect.objectContaining({ role: "member", person_id: "technician", work_context: { kind: "facility_repair", source_id: "repair-1", access_id: "grant-1" } }));
    expect(await screen.findByRole("status")).toHaveTextContent("Job access saved"); expect(screen.getByText(/Email delivery is unavailable/)).toBeVisible(); expect(screen.queryByText("not-for-render")).not.toBeInTheDocument();
  });
  it("retains the same invitation commitment after an unknown response without regranting access", async () => {
    vi.mocked(invitePersonToApp).mockRejectedValueOnce(new Error("Lost response")); mount(); await fill(); await userEvent.click(screen.getByRole("button", { name: "Share job" }));
    await userEvent.click(await screen.findByRole("button", { name: "Retry same invitation" })); await waitFor(() => expect(invitePersonToApp).toHaveBeenCalledTimes(2));
    expect(vi.mocked(invitePersonToApp).mock.calls[1]).toEqual(vi.mocked(invitePersonToApp).mock.calls[0]); expect(grantRepairExternalAccess).toHaveBeenCalledOnce();
  });
  it("rehearses only the job grant in Simulation without calling a real invitation endpoint", async () => {
    mount(true); await fill(false); expect(screen.queryByLabelText("Invitation email")).not.toBeInTheDocument(); await userEvent.click(screen.getByRole("button", { name: "Share job" }));
    await waitFor(() => expect(grantRepairExternalAccess).toHaveBeenCalledOnce()); expect(invitePersonToApp).not.toHaveBeenCalled();
  });
});
