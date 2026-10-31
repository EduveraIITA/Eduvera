import { StrictMode, type ComponentProps } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { confirmFacilitiesCommand, getRepair, uploadRepairPhoto, type RepairDetail } from "./facilitiesApi";
import { repairFixture } from "./facilities.test-fixtures";
import { RepairPhotoDialog } from "./RepairPhotoDialog";

vi.mock("./facilitiesApi", async original => ({
  ...await original<typeof import("./facilitiesApi")>(),
  confirmFacilitiesCommand: vi.fn(), getRepair: vi.fn(), uploadRepairPhoto: vi.fn(),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => {
  vi.mocked(uploadRepairPhoto).mockResolvedValue(repairFixture({ revision: 2 }));
  vi.mocked(getRepair).mockResolvedValue(repairFixture({ revision: 2 }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const photo = () => new File(["fictional photo bytes"], "projector.png", { type: "image/png" });
function mount(overrides: Partial<ComponentProps<typeof RepairPhotoDialog>> = {}, strict = false) {
  const refresh = vi.fn().mockResolvedValue(undefined), onClose = vi.fn();
  const props = { schoolId: "school", repair: repairFixture(), refresh, onClose, ...overrides };
  const dialog = <MemoryRouter><RepairPhotoDialog {...props} /></MemoryRouter>;
  render(strict ? <StrictMode>{dialog}</StrictMode> : dialog);
  return { refresh, onClose };
}

describe("report photo handoff", () => {
  it("uploads the already chosen photo once, including StrictMode effect replay", async () => {
    const file = photo();
    let complete!: (repair: RepairDetail) => void;
    vi.mocked(uploadRepairPhoto).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const { refresh, onClose } = mount({ initialFile: file, reportSaved: true }, true);

    await waitFor(() => expect(uploadRepairPhoto).toHaveBeenCalledOnce());
    const [school, repairId, body, uploadedFile] = vi.mocked(uploadRepairPhoto).mock.calls[0]!;
    expect([school, repairId]).toEqual(["school", "repair-1"]);
    expect(typeof body.command_id).toBe("string"); expect(body.expected_revision).toBe(1); expect(uploadedFile).toBe(file);
    expect(screen.getByRole("status")).toHaveTextContent("Report saved. Uploading your photo");
    expect(screen.getByRole("button", { name: "Add later" })).toBeDisabled();
    complete(repairFixture({ revision: 2 }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(refresh).toHaveBeenCalledOnce(); expect(uploadRepairPhoto).toHaveBeenCalledOnce();
  });

  it("leaves a manual add-photo action explicit even when a file is preselected", async () => {
    const user = userEvent.setup(), file = photo(), { onClose } = mount({ initialFile: file });
    expect(uploadRepairPhoto).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Add photo" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(uploadRepairPhoto).toHaveBeenCalledOnce();
  });

  it("does not upload a newly chosen manual photo until the user sends it", async () => {
    const user = userEvent.setup(), file = photo(); mount();
    await user.upload(screen.getByLabelText("Photo"), file);
    expect(uploadRepairPhoto).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    await waitFor(() => expect(uploadRepairPhoto).toHaveBeenCalledOnce());
  });

  it("keeps the report saved after a refused photo, allowing retry or add later", async () => {
    vi.mocked(uploadRepairPhoto).mockRejectedValueOnce(new ApiError("Photo is not supported", 422));
    const user = userEvent.setup(), { onClose } = mount({ initialFile: photo(), reportSaved: true });
    await screen.findByText("Photo is not supported");
    expect(screen.getByRole("status")).toHaveTextContent("Report saved. Your photo wasn’t added");
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeEnabled();
    expect(uploadRepairPhoto).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Add later" }));
    expect(onClose).toHaveBeenCalledOnce(); expect(uploadRepairPhoto).toHaveBeenCalledOnce();
  });

  it("locks a lost response and only retries the same photo after explicit recovery", async () => {
    vi.mocked(uploadRepairPhoto).mockRejectedValueOnce(new TypeError("Connection lost"));
    vi.mocked(confirmFacilitiesCommand).mockResolvedValue({ state: "not_found" });
    const user = userEvent.setup(), file = photo(), { onClose } = mount({ initialFile: file, reportSaved: true });
    await screen.findByRole("button", { name: "Check result" });
    expect(screen.getByRole("status")).toHaveTextContent("Report saved. Check whether your photo was added");
    expect(screen.getByLabelText("Photo")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add later" })).toBeDisabled();
    expect(uploadRepairPhoto).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Check result" }));
    expect(uploadRepairPhoto).toHaveBeenCalledOnce();
    await user.click(await screen.findByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(vi.mocked(uploadRepairPhoto).mock.calls[1]).toEqual(vi.mocked(uploadRepairPhoto).mock.calls[0]);
  });

  it("refreshes an accepted photo without sending it again after the view failed", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("Read unavailable")).mockResolvedValueOnce(undefined);
    const user = userEvent.setup(), { onClose } = mount({ initialFile: photo(), reportSaved: true, refresh });
    await screen.findByRole("button", { name: "Refresh saved record" });
    expect(screen.getByRole("status")).toHaveTextContent("Report and photo saved");
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Refresh saved record" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(refresh).toHaveBeenCalledTimes(2); expect(uploadRepairPhoto).toHaveBeenCalledOnce();
  });

  it("requires an explicit new upload after reviewing a permanently obsolete attempt", async () => {
    vi.mocked(uploadRepairPhoto).mockImplementationOnce((_school, id, body) => Promise.reject(new ApiError("Repair changed", 409, {
      error: { code: "facilities_obsolete", fields: { facilities_obsolete: {
        confirmation: "permanently_inapplicable", receipt_state: "absent", reason: "stream_advanced",
        repair_id: id, command_id: body.command_id, expected_revision: body.expected_revision, current_revision: 2,
      } } },
    })));
    const user = userEvent.setup(), { onClose } = mount({ initialFile: photo(), reportSaved: true });
    await user.click(await screen.findByRole("button", { name: "Review current record" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload photo" })).toBeEnabled());
    expect(uploadRepairPhoto).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const [first, second] = vi.mocked(uploadRepairPhoto).mock.calls;
    expect(second![2].expected_revision).toBe(2);
    expect(second![2].command_id).not.toBe(first![2].command_id);
  });
});
