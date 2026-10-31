import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { repairFixture } from "./facilities.test-fixtures";
import { endRepairExternalAccess } from "./repairExternalAccessApi";
import { RepairTechnicianAccess } from "./RepairTechnicianAccess";
import type { RepairExternalAccess } from "./facilitiesApi";
vi.mock("./repairExternalAccessApi", async original => ({ ...await original<typeof import("./repairExternalAccessApi")>(), endRepairExternalAccess: vi.fn() }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount(state: RepairExternalAccess["state"], readOnly = false, retainedHandler = false) {
  const access: RepairExternalAccess = { id: "grant", person: { id: "technician", label: "Amit", revision: 1, has_app_access: true }, starts_at: "2026-10-25T00:00:00Z", ends_at: "2026-10-26T00:00:00Z", instructions: "Fix light", shared_photo_ids: [], state, can_manage: true, can_activate: false };
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<MemoryRouter><RepairTechnicianAccess schoolId="school" actorId="coordinator" repair={repairFixture({ state: "in_progress", can_invite_external: !retainedHandler, external_access: access, ...(retainedHandler ? { handler: access.person } : {}) })} timezone="Asia/Kolkata" refresh={refresh} readOnly={readOnly} /></MemoryRouter>);
  return refresh;
}
describe("explicitly release an expired technician assignment", () => {
  it("keeps End assignment available after access expiry and does not invite a replacement prematurely", async () => {
    const refresh = mount("expired");
    expect(screen.getByText("End this assignment before inviting someone else.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Invite technician" })).not.toBeInTheDocument();
    expect(endRepairExternalAccess).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "End assignment" }));
    const dialog = screen.getByRole("dialog", { name: "End technician assignment" });
    await userEvent.type(within(dialog).getByLabelText("Reason"), "A different technician will continue");
    vi.mocked(endRepairExternalAccess).mockResolvedValue(repairFixture({ revision: 2 }));
    await userEvent.click(within(dialog).getByRole("button", { name: "End assignment" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(endRepairExternalAccess).toHaveBeenCalledWith("school", "repair-1", "grant", expect.objectContaining({ expected_revision: 1, note: "A different technician will continue" }));
  });
  it("does not replace an active assignment just because an invitation capability is present", () => {
    mount("active"); expect(screen.getByRole("button", { name: "End access" })).toBeVisible(); expect(screen.queryByRole("button", { name: "Invite technician" })).not.toBeInTheDocument();
    expect(endRepairExternalAccess).not.toHaveBeenCalled();
  });
  it("offers the normal invitation only after the current assignment has explicitly ended", () => {
    mount("ended"); expect(screen.getByRole("button", { name: "Invite technician" })).toBeVisible(); expect(screen.queryByRole("button", { name: "End assignment" })).not.toBeInTheDocument();
  });
  it("does not expose an expiry recovery action in a read-only world", () => {
    mount("expired", true); expect(screen.queryByRole("button", { name: "End assignment" })).not.toBeInTheDocument(); expect(endRepairExternalAccess).not.toHaveBeenCalled();
  });
  it("guides a reopened job with a retained ended technician through the existing handler recovery", () => {
    mount("ended", false, true); expect(screen.getByText("Choose a current handler in Change responsibility, then invite a technician.")).toBeVisible(); expect(screen.queryByRole("button", { name: "Invite technician" })).not.toBeInTheDocument(); expect(endRepairExternalAccess).not.toHaveBeenCalled();
  });
});
