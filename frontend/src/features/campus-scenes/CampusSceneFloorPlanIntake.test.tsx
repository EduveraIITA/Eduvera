import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusSceneFloorPlanIntake, floorBelongsToBuilding } from "./CampusSceneFloorPlanIntake";
import type { CampusSceneDocument, CampusSceneSpace } from "./types";

const spaces: CampusSceneSpace[] = [
  { id: "admin", campus_id: "campus", name: "Administration", code: "ADM", kind: "office", parent_space_id: null, revision: 2 },
  { id: "floor", campus_id: "campus", name: "First floor", code: "ADM1", kind: "floor", parent_space_id: "admin", revision: 4 },
  { id: "computing", campus_id: "campus", name: "Computing Centre", code: "CC", kind: "building", parent_space_id: null, revision: 1 },
  { id: "unmapped", campus_id: "campus", name: "Unmapped building", code: "UN", kind: "building", parent_space_id: null },
];
const document: CampusSceneDocument = { schema_version: 1, name: "Campus", source: { kind: "manual", label: "Manual" }, bounds: { width: 1000, height: 800, unit: "relative" }, elements: ["admin", "computing"].map(id => ({ id, kind: "building", label: id, space_id: id, floor_id: null, geometry: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, review_state: "reviewed" })) };
const capabilities = { image_analysis: { available: true }, map_search: { available: true }, max_image_bytes: 4194304 };
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => { vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:plan"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("indoor floor plan intake", () => {
  it("carries the exact mapped building and floor and waits for image rights", async () => {
    const onPrepare = vi.fn().mockResolvedValue(undefined);
    render(<CampusSceneFloorPlanIntake document={document} spaces={spaces} initialBuildingId="admin" capabilities={capabilities} onPrepare={onPrepare} onClose={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Building" })).toHaveValue("admin");
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveValue("floor");
    expect(screen.queryByRole("option", { name: "Unmapped building" })).not.toBeInTheDocument();
    const file = new File(["png"], "administration-first.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Floor plan image"), file);
    expect(screen.getByRole("button", { name: "Find rooms in this plan" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /permission to use and adapt/ }));
    await userEvent.click(screen.getByRole("button", { name: "Find rooms in this plan" }));
    await waitFor(() => expect(onPrepare).toHaveBeenCalledExactlyOnceWith({ file, buildingId: "admin", floorId: "floor", instructions: "", rightsConfirmed: true }));
  });

  it("offers one new floor with its room review, without sending a separate create command", async () => {
    const onPrepare = vi.fn().mockResolvedValue(undefined);
    render(<CampusSceneFloorPlanIntake document={document} spaces={spaces} initialBuildingId="computing" capabilities={capabilities} onPrepare={onPrepare} onClose={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveValue("");
    expect(screen.queryByRole("option", { name: "First floor" })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole("textbox", { name: "Floor name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Floor name" }), "Teaching floor");
    const file = new File(["png"], "computing.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Floor plan image"), file);
    await userEvent.click(screen.getByRole("checkbox", { name: /permission to use and adapt/ }));
    await userEvent.click(screen.getByRole("button", { name: "Find rooms in this plan" }));
    expect(onPrepare).toHaveBeenCalledExactlyOnceWith({ file, buildingId: "computing", floorId: null, newFloor: { name: "Teaching floor", code: "" }, instructions: "", rightsConfirmed: true });
  });

  it("retains the chosen file and scope when analysis fails and reuses them for tracing", async () => {
    const onPrepare = vi.fn().mockRejectedValueOnce(new Error("The plan could not be analysed.")).mockResolvedValueOnce(undefined);
    render(<CampusSceneFloorPlanIntake document={document} spaces={spaces} capabilities={capabilities} onPrepare={onPrepare} onClose={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Floor plan image"), new File(["png"], "plan.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /permission to use and adapt/ }));
    await userEvent.click(screen.getByRole("button", { name: "Find rooms in this plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be analysed");
    expect(screen.getByRole("checkbox", { name: /permission to use and adapt/ })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Trace plan instead" }));
    expect(onPrepare.mock.calls[1]![0]).toEqual({ ...onPrepare.mock.calls[0]![0], traceOnly: true });
  });

  it("clears permission for a different file and rejects oversize images before import", async () => {
    render(<CampusSceneFloorPlanIntake document={document} spaces={spaces} capabilities={{ ...capabilities, max_image_bytes: 4 }} onPrepare={vi.fn()} onClose={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Floor plan image"), new File(["png"], "one.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /permission to use and adapt/ }));
    await userEvent.upload(screen.getByLabelText("Floor plan image"), new File(["too large"], "two.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a PNG");
    expect(screen.getByRole("checkbox", { name: /permission to use and adapt/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Find rooms in this plan" })).toBeDisabled();
  });

  it("uses exact ancestry including wings, and stops on a corrupt cycle", () => {
    const wing = { ...spaces[0]!, id: "wing", kind: "wing", parent_space_id: "admin" };
    const nestedFloor = { ...spaces[1]!, parent_space_id: "wing" };
    expect(floorBelongsToBuilding(nestedFloor, "admin", [...spaces, wing])).toBe(true);
    expect(floorBelongsToBuilding(nestedFloor, "computing", [...spaces, wing])).toBe(false);
    expect(floorBelongsToBuilding(nestedFloor, "admin", [...spaces, { ...wing, parent_space_id: "floor" }])).toBe(false);
  });
});
