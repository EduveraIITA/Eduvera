import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CampusScenePlaceCreator } from "./CampusScenePlaceCreator";
import { createSpace, getInstitutionSetup, updateSpace, type CampusSpace, type InstitutionSetup } from "../office/api";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
vi.mock("../office/api", async original => ({ ...await original<typeof import("../office/api")>(), getInstitutionSetup: vi.fn(), createSpace: vi.fn(), updateSpace: vi.fn() }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const building: CampusSpace = { id: "building", campus_id: "main", school_id: "school", parent_space_id: null, name: "Learning building", code: "LEARN", kind: "building", capacity: null, is_accessible: false, is_bookable: false, status: "active", revision: 1 };
const floor = { ...building, id: "floor", name: "First floor", code: "F1", kind: "floor" as const, parent_space_id: "building" };
const room = { ...building, id: "room", name: "Seminar room", code: "S201", kind: "classroom" as const, parent_space_id: "floor", revision: 4 };
const setup: InstitutionSetup = { school: { id: "school", name: "Campus", code: "C", institution_kind: "college", timezone: "Asia/Kolkata" }, campuses: [{ id: "main", school_id: "school", name: "Main campus", code: "MAIN", campus_type: "main", status: "active", is_primary: true, parent_campus_id: null, address_line: "", city: "", state: "", postal_code: "", timezone: "Asia/Kolkata", revision: 1 }], spaces: [building, floor, room], resource_types: [], holdings: [], classes: [], staff: [], activity: [], signals: [], observation_sources: [], readiness: [], summary: { campuses: 1, spaces: 3, resources: 0, classes: 0, classes_with_home_space: 0, staff: 0, complete: false } };
const element: CampusSceneElement = { id: "drawing-room", kind: "room", label: "Seminar room", floor_id: "floor", parent_element_id: "drawing-building", space_id: null, geometry: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }, review_state: "needs_review" };
const scene: CampusSceneDocument = { schema_version: 1, name: "Campus", source: { kind: "manual", label: "Plan" }, bounds: { width: 100, height: 100, unit: "metres" }, elements: [{ ...element, id: "drawing-building", kind: "building", floor_id: null, space_id: "building" }, element] };
function show(selected = element) { const created = vi.fn(), close = vi.fn(); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); render(<MemoryRouter><QueryClientProvider client={client}><CampusScenePlaceCreator schoolId="school" campusId="main" worldKey="live:global" element={selected} scene={scene} onCreated={created} onClose={close}/></QueryClientProvider></MemoryRouter>); return { created, close }; }

describe("scene handoff to the canonical campus place form", () => {
  it("prefills only the selected name, type and exact canonical parent, creating on explicit Save", async () => {
    vi.mocked(getInstitutionSetup).mockResolvedValue(setup); vi.mocked(createSpace).mockResolvedValue(room); const { created } = show();
    await screen.findByRole("dialog", { name: "Add space" }); expect(screen.getByLabelText("Space name")).toHaveValue("Seminar room"); expect(screen.getByLabelText("Type")).toHaveValue("classroom"); expect(screen.getByLabelText("Inside (optional)")).toHaveValue("floor"); expect(createSpace).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/^Code/), "S201"); await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(createSpace).toHaveBeenCalledWith("school", expect.objectContaining({ campus_id: "main", parent_space_id: "floor", name: "Seminar room", code: "S201" })); expect(created).toHaveBeenCalledWith(room);
  });
  it("edits the same native place revision when the drawing is already linked", async () => {
    vi.mocked(getInstitutionSetup).mockResolvedValue(setup); vi.mocked(updateSpace).mockResolvedValue(room); show({ ...element, space_id: "room" });
    await screen.findByRole("dialog", { name: "Edit space" }); await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateSpace).toHaveBeenCalledWith("school", "room", expect.objectContaining({ expected_revision: 4 })); expect(createSpace).not.toHaveBeenCalled();
  });
  it("does not silently create a replacement for an unavailable linked place", async () => {
    vi.mocked(getInstitutionSetup).mockResolvedValue(setup); const { close } = show({ ...element, space_id: "missing" });
    await screen.findByRole("dialog", { name: "Place unavailable" }); expect(createSpace).not.toHaveBeenCalled(); await userEvent.click(screen.getByRole("button", { name: "Return to drawing" })); expect(close).toHaveBeenCalledOnce();
  });
  it("leaves the drawing unchanged when the current canonical source fails", async () => {
    vi.mocked(getInstitutionSetup).mockRejectedValue(new Error("Unavailable")); const { created, close } = show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your drawing is unchanged"); await userEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(created).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce(); expect(createSpace).not.toHaveBeenCalled();
  });
});
