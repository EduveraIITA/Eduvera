import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusSceneEditor } from "./CampusSceneEditor";
import type { CampusSceneDocument } from "./types";
import type { CampusSceneCanvasProps } from "./CampusSceneCanvas";
import type { ComponentProps } from "react";
import type { CampusScenePlaceBatchReview } from "./CampusScenePlaceBatchReview";

const state = vi.hoisted(() => ({ review: null as ComponentProps<typeof CampusScenePlaceBatchReview> | null, canvas: null as CampusSceneCanvasProps | null }));
vi.mock("./CampusScenePlaceBatchReview", () => ({ CampusScenePlaceBatchReview: (props: ComponentProps<typeof CampusScenePlaceBatchReview>) => { state.review = props; return <div>Planned floor review<button onClick={props.onClose}>Return to floor editor</button></div>; } }));
vi.mock("./CampusSceneCanvas", () => ({ CampusSceneCanvas: (props: CampusSceneCanvasProps) => { state.canvas = props; return <div aria-label="Campus canvas">{props.scene.elements.map(element => <button key={element.id} onClick={() => props.onSelectElement(element.id)}>Canvas {element.label}</button>)}</div>; } }));
vi.mock("./api", () => ({ getCampusSceneResources: vi.fn() }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => { state.review = null; state.canvas = null; vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:plan"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const campus: CampusSceneDocument = { schema_version: 1, name: "Learning campus", source: { kind: "open_map", label: "Original campus map", attribution: "OpenStreetMap" }, bounds: { width: 1000, height: 800, unit: "relative" }, elements: [{ id: "building", kind: "building", label: "Learning centre", space_id: "canonical-building", floor_id: null, geometry: { type: "polygon", points: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 250 }, { x: 100, y: 250 }] }, review_state: "reviewed" }] };
const proposal: CampusSceneDocument = { schema_version: 1, name: "Plan", source: { kind: "site_plan", label: "Teaching floor" }, bounds: { width: 1000, height: 500, unit: "relative" }, elements: [{ id: "room", kind: "room", label: "Seminar room", space_id: null, floor_id: null, geometry: { type: "polygon", points: [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 400 }, { x: 100, y: 400 }] }, review_state: "needs_review" }] };
function mount(document = proposal) {
  const onImportFloorPlan = vi.fn().mockResolvedValue(document), onSave = vi.fn();
  render(<CampusSceneEditor document={campus} revision={3} publishedVersion={1} initialElementId="building" spaces={[{ id: "canonical-building", campus_id: "campus", parent_space_id: null, kind: "library", name: "Learning centre", code: "LIB", revision: 2 }]} resourceScope={{ schoolId: "school", campusId: "campus" }} capabilities={{ image_analysis: { available: true }, map_search: { available: true }, max_image_bytes: 4194304 }} onImportFloorPlan={onImportFloorPlan} onSave={onSave} onPublish={vi.fn()} onSaveReviewedPlaces={vi.fn()} />);
  return { onImportFloorPlan, onSave };
}
async function upload() {
  await userEvent.click(screen.getByRole("button", { name: "Add floor plan", exact: true }));
  const file = new File(["png"], "teaching.png", { type: "image/png" });
  await userEvent.upload(screen.getByLabelText("Floor plan image"), file);
  await userEvent.click(screen.getByRole("checkbox", { name: /permission to use and adapt/ }));
  await userEvent.click(screen.getByRole("button", { name: "Find rooms in this plan" }));
  return file;
}
describe("floor plans stay in the existing editor", () => {
  it("keeps copied rooms on their accepted canonical floor after the provisional plan is committed", async () => {
    mount(); await upload(); await screen.findByText("Planned floor review");
    const reviewed = state.review!;
    const acceptedDocument = { ...reviewed.document, elements: reviewed.document.elements.map(element => element.kind === "room" ? { ...element, floor_id: "accepted-floor", space_id: "accepted-room" } : element) };
    act(() => reviewed.onAccepted({ id: "scene", revision: 4, current_revision: 4, document: acceptedDocument, draft: acceptedDocument, published_version: 1, replayed: false, mappings: [{ proposal_id: "floor_plan_target", element_ids: [], space_id: "accepted-floor", space_revision: 1, action: "created" }, { proposal_id: "place_1", element_ids: [acceptedDocument.elements[1]!.id], space_id: "accepted-room", space_revision: 1, action: "created" }] }));
    await userEvent.click(screen.getByRole("button", { name: "Canvas Seminar room", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Duplicate", exact: true }));
    expect(state.canvas?.floorId).toBe("accepted-floor");
    expect(state.canvas?.scene.elements.at(-1)).toMatchObject({ label: "Seminar room copy", kind: "room", floor_id: "accepted-floor", space_id: null, holding_id: null, parent_element_id: "building", review_state: "needs_review" });
    expect(state.canvas?.scene.elements[1]).toMatchObject({ label: "Seminar room", floor_id: "accepted-floor", space_id: "accepted-room" });
    expect(state.canvas?.scene.elements.at(-1)?.id).not.toBe(acceptedDocument.elements[1]!.id);
  });
  it("offers a scoped bulk review without replacing the original campus or saving an unassigned floor", async () => {
    const { onImportFloorPlan, onSave } = mount(); const file = await upload();
    await screen.findByText("Planned floor review");
    expect(onImportFloorPlan).toHaveBeenCalledExactlyOnceWith({ file, buildingId: "canonical-building", floorId: null, newFloor: { name: "Ground floor", code: "" }, instructions: "", rightsConfirmed: true });
    expect(state.review?.document.elements[0]).toEqual(campus.elements[0]); expect(state.review?.document.source).toEqual(campus.source);
    expect(state.review?.floorPlan).toMatchObject({ buildingId: "canonical-building", floorId: null, elementIds: [expect.any(String)] });
    expect(state.review?.document.elements[1]).toMatchObject({ floor_id: null, space_id: null, parent_element_id: "building", review_state: "needs_review" });
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Return to floor editor" }));
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Discard plan" }));
    await waitFor(() => expect(state.canvas?.scene).toEqual(campus));
  });
  it("keeps the image-only fallback in the same flat editor and filters the asset library to indoor features", async () => {
    mount({ ...proposal, elements: [] }); await upload();
    await screen.findByText(/Trace rooms over the floor plan/);
    expect(state.review).toBeNull(); expect(state.canvas?.sourceImageUrl).toBe("blob:plan"); expect(state.canvas?.interiorView).toBe(true);
    expect(state.canvas?.scene.source).toEqual(campus.source); expect(state.canvas?.scene.elements).toEqual([]);
    expect(screen.getByRole("button", { name: "Review floor plan", exact: true })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    expect(screen.queryByRole("option", { name: "Academic building" })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Feature" }), screen.getByRole("option", { name: "Room", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Place template" }));
    expect(state.canvas?.scene.elements[0]).toMatchObject({ kind: "room", floor_id: null, parent_element_id: "building", space_id: null });
    expect(screen.getByRole("button", { name: "Review floor plan", exact: true })).toBeEnabled();
  });
});
