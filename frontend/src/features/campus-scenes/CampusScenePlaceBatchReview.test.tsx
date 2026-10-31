import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusScenePlaceBatchReview } from "./CampusScenePlaceBatchReview";
import { getInstitutionSetup, type CampusSpace, type InstitutionSetup } from "../office/api";
import type { CampusSceneCanvasProps } from "./CampusSceneCanvas";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import type { ReviewedScenePlacesReceipt, ReviewedScenePlacesRequest } from "./api";
import { ApiError } from "../../lib/api";
const state = vi.hoisted(() => ({ preview: null as CampusSceneCanvasProps | null }));
vi.mock("../office/api", async original => ({ ...await original<typeof import("../office/api")>(), getInstitutionSetup: vi.fn() }));
vi.mock("./CampusSceneCanvas", () => ({ CampusSceneCanvas: (props: CampusSceneCanvasProps) => { state.preview = props; return <div aria-label="Shared outline preview">{props.scene.elements.map(element => <button key={element.id} onClick={() => props.onSelectElement(element.id)}>Outline {element.id}</button>)}</div>; } }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const place: CampusSpace = { id: "existing", school_id: "school", campus_id: "campus", parent_space_id: null, name: "Existing block", code: "EXIST", kind: "building", capacity: null, status: "active", is_bookable: false, is_accessible: false, revision: 7 };
const setup: InstitutionSetup = { school: { id: "school", name: "Campus", code: "C", institution_kind: "college", timezone: "Asia/Kolkata" }, campuses: [{ id: "campus", school_id: "school", name: "Main campus", code: "MAIN", campus_type: "main", status: "active", is_primary: true, parent_campus_id: null, address_line: "", city: "", state: "", postal_code: "", timezone: "Asia/Kolkata", revision: 1 }], spaces: [place], resource_types: [], holdings: [], classes: [], staff: [], activity: [], signals: [], observation_sources: [], readiness: [], summary: { campuses: 1, spaces: 1, resources: 0, classes: 0, classes_with_home_space: 0, staff: 0, complete: false } };
const element = (id: string, label = id): CampusSceneElement => ({ id, label, kind: "building", space_id: null, floor_id: null, review_state: "needs_review", geometry: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] } });
const scene = (...elements: CampusSceneElement[]): CampusSceneDocument => ({ schema_version: 1, name: "Current unsaved campus", source: { kind: "manual", label: "Plan" }, bounds: { width: 100, height: 100, unit: "relative" }, elements });
function accepted(body: ReviewedScenePlacesRequest): ReviewedScenePlacesReceipt { return { id: "scene", revision: 5, current_revision: 5, draft: body.document, document: body.document, published_version: null, replayed: false, mappings: body.rows.map(row => ({ proposal_id: row.proposal_id, element_ids: row.element_ids, space_id: row.action === "reuse" ? row.space_id : `new-${row.proposal_id}`, space_revision: row.action === "reuse" ? row.expected_space_revision : 1, action: row.action === "reuse" ? "reused" : "created" })) }; }
function show(document = scene(element("a", "Library"), element("b", "Academic block")), onCommit = vi.fn<(body: ReviewedScenePlacesRequest) => Promise<ReviewedScenePlacesReceipt>>().mockImplementation(body => Promise.resolve(accepted(body)))) {
  const onAccepted = vi.fn(), onStale = vi.fn(), onClose = vi.fn(); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mounted = render(<MemoryRouter><QueryClientProvider client={client}><CampusScenePlaceBatchReview schoolId="school" campusId="campus" document={document} revision={4} onClose={onClose} onCommit={onCommit} onAccepted={onAccepted} onStale={onStale}/></QueryClientProvider></MemoryRouter>);
  return { onCommit, onAccepted, onStale, onClose, mounted, client };
}
beforeEach(() => { state.preview = null; vi.mocked(getInstitutionSetup).mockResolvedValue(structuredClone(setup)); });

describe("one reviewed campus-place save", () => {
  it("reviews only this imported floor, adjusts it together and commits its new floor and rooms in one action", async () => {
    const room = { ...element("floor-room", "Admissions office"), kind: "room" as const, parent_element_id: "mapped-building" };
    const door = { ...element("floor-door", "Office door"), kind: "fixture" as const, asset_key: "door" as const, geometry: { type: "point" as const, points: [{ x: 30, y: 30 }] }, width: 1, parent_element_id: room.id };
    const originalBuilding = { ...element("mapped-building", "Existing block"), space_id: place.id, review_state: "reviewed" as const };
    const document = scene(originalBuilding, element("unrelated", "Unrelated unlinked building"), { ...room, geometry: { type: "polygon", points: [{ x: 20, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 40 }, { x: 20, y: 40 }] } }, door);
    const onCommit = vi.fn<(body: ReviewedScenePlacesRequest) => Promise<ReviewedScenePlacesReceipt>>().mockImplementation(body => Promise.resolve(accepted(body))), onAdjusted = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={client}><CampusScenePlaceBatchReview schoolId="school" campusId="campus" document={document} revision={4} floorPlan={{ buildingId: place.id, buildingElementId: originalBuilding.id, floorId: null, newFloor: { name: "Teaching floor", code: "TEACH" }, elementIds: [room.id, door.id], imageBounds: { x: 12, y: 12, width: 76, height: 76 }, imageUrl: "blob:private-plan" }} onFloorPlanAdjusted={onAdjusted} onClose={vi.fn()} onCommit={onCommit} onAccepted={vi.fn()} onStale={vi.fn()} /></QueryClientProvider></MemoryRouter>);
    await screen.findByRole("textbox", { name: "Place name for place_1" });
    expect(screen.queryByRole("option", { name: "Use an existing place" })).not.toBeInTheDocument();
    expect(state.preview?.scene.elements.map(element => element.id)).toEqual([room.id, door.id]);
    expect(screen.queryByText("Unrelated unlinked building")).not.toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Adjust plan alignment", { exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Right 90°" }));
    expect(onAdjusted).toHaveBeenCalledOnce();
    expect(state.preview?.sourceImageRotationDeg).toBe(90);
    await userEvent.click(screen.getByRole("button", { name: "Create places and add floor plan" }));
    expect(onCommit).toHaveBeenCalledOnce(); const body = onCommit.mock.calls[0]![0];
    expect(body.rows[0]).toMatchObject({ proposal_id: "floor_plan_target", action: "create", kind: "floor", name: "Teaching floor", parent_space_id: place.id, expected_parent_revision: 7, element_ids: [], floor_element_ids: [room.id, door.id] });
    expect(body.rows[1]).toMatchObject({ action: "create", name: "Admissions office", parent_proposal_id: "floor_plan_target", element_ids: [room.id] });
    expect(body.document.elements[0]).toEqual(originalBuilding); expect(body.document.elements[1]).toEqual(document.elements[1]);
    expect(body.document.source).toEqual(document.source); expect(body.document.elements[2]?.review_state).toBe("needs_review");
  });
  it("reviews names and auto-codes then saves the full unsaved layout once without publishing or geometry review", async () => {
    const document = scene(element("a", "Library"), { ...element("tree"), kind: "tree" }); const before = structuredClone(document), { onCommit, onAccepted } = show(document);
    await screen.findByRole("textbox", { name: "Place name for place_1" }); expect(onCommit).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByRole("textbox", { name: "Place name for place_1" })); await userEvent.type(screen.getByRole("textbox", { name: "Place name for place_1" }), "Central Library");
    await userEvent.click(screen.getByRole("button", { name: "Create 1 and connect 1 feature" }));
    expect(onCommit).toHaveBeenCalledOnce(); const body = onCommit.mock.calls[0]![0]; expect(body.expected_revision).toBe(4); expect(body.document.elements[0]).toMatchObject({ label: "Central Library", review_state: "needs_review", space_id: null }); expect(body.rows[0]).toMatchObject({ action: "create", name: "Central Library", kind: "building", element_ids: ["a"] }); expect(body.rows[0]).toHaveProperty("code", "LIBRARY_1"); expect(onAccepted).toHaveBeenCalledOnce(); expect(document).toEqual(before);
  });
  it("keeps all choices when showing an outline in the same shared preview", async () => {
    show(); await screen.findByRole("textbox", { name: "Place name for place_1" });
    expect(state.preview?.className).toBe("scene-place-review__canvas");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("campus-scene-button");
    expect(screen.getByRole("button", { name: "Create 2 and connect 2 features" })).toHaveClass("campus-scene-button--primary");
    await userEvent.clear(screen.getByRole("textbox", { name: "Place name for place_1" })); await userEvent.type(screen.getByRole("textbox", { name: "Place name for place_1" }), "Learning commons"); await userEvent.click(screen.getByRole("button", { name: "Show Academic block on map" }));
    expect(state.preview?.selectedElementId).toBe("b"); expect(state.preview?.highlightedElementIds).toEqual(["b"]); expect(state.preview?.onMoveElement).toBeUndefined(); expect(screen.getByRole("textbox", { name: "Place name for place_1" })).toHaveValue("Learning commons");
  });
  it("offers existing-name matches explicitly, including one reviewed bulk reuse choice", async () => {
    vi.mocked(getInstitutionSetup).mockResolvedValue({ ...setup, spaces: [{ ...place, name: "Library" }] }); const { onCommit } = show(scene(element("a", "Library")));
    await screen.findByRole("button", { name: "Use 1 suggested existing place" }); expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use Library · EXIST · Building" })).toBeVisible(); await userEvent.click(screen.getByRole("button", { name: "Use 1 suggested existing place" })); await userEvent.click(screen.getByRole("button", { name: "Create 0 and connect 1 feature" }));
    expect(onCommit.mock.calls[0]?.[0].rows).toEqual([{ proposal_id: "place_1", element_ids: ["a"], action: "reuse", space_id: "existing", expected_space_revision: 7 }]); expect(onCommit.mock.calls[0]?.[0].rows[0]).not.toHaveProperty("name");
  });
  it("does not choose between ambiguous existing identities", async () => {
    vi.mocked(getInstitutionSetup).mockResolvedValue({ ...setup, spaces: [{ ...place, name: "Library" }, { ...place, id: "other", name: "Library", code: "LIB2" }] }); show(scene(element("a", "Library")));
    await screen.findByRole("textbox", { name: "Place name for place_1" }); expect(screen.queryByRole("button", { name: /suggested existing place/ })).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Use Library · EXIST · Building" })).toBeVisible(); expect(screen.getByRole("button", { name: "Use Library · LIB2 · Building" })).toBeVisible();
  });
  it("groups same-source multipart outlines and supports explicit same-place grouping without a checkbox per row", async () => {
    const { onCommit } = show(scene({ ...element("a", "Annex"), source_feature_id: "feature-1" }, { ...element("b", "Annex"), source_feature_id: "feature-1" }, element("c", "Annex")));
    await screen.findByRole("textbox", { name: "Place name for place_1" }); expect(screen.queryAllByRole("checkbox")).toHaveLength(0); await userEvent.selectOptions(screen.getAllByRole("combobox", { name: "Use Annex" })[1]!, "same"); await userEvent.click(screen.getAllByRole("button", { name: "Show Annex on map" })[0]!); expect(state.preview?.highlightedElementIds).toEqual(["a", "b", "c"]); await userEvent.click(screen.getByRole("button", { name: "Create 1 and connect 3 features" })); expect(onCommit.mock.calls[0]?.[0].rows).toHaveLength(1); expect(onCommit.mock.calls[0]?.[0].rows[0]?.element_ids).toEqual(["a", "b", "c"]);
  });
  it("lets a source multipart group split, keeping one outline visual without changing geometry review", async () => {
    const document = scene({ ...element("a", "Annex"), source_feature_id: "feature" }, { ...element("b", "Annex"), source_feature_id: "feature" }); const { onCommit } = show(document);
    await userEvent.click(await screen.findByRole("button", { name: "Review outlines separately" })); const choices = screen.getAllByRole("combobox", { name: "Use Annex" }); expect(choices).toHaveLength(2); await userEvent.selectOptions(choices[1]!, "visual"); await userEvent.click(screen.getByRole("button", { name: "Create 1 and connect 1 feature" }));
    expect(onCommit.mock.calls[0]?.[0].rows[0]?.element_ids).toEqual(["a"]); expect(onCommit.mock.calls[0]?.[0].document.elements.map(item => ({ id: item.id, review: item.review_state, source: item.source_feature_id }))).toEqual([{ id: "a", review: "needs_review", source: undefined }, { id: "b", review: "needs_review", source: undefined }]); expect(document.elements[1]!.source_feature_id).toBe("feature");
  });
  it("retains the exact full-document request and key after an uncertain outcome", async () => {
    const commit = vi.fn<(body: ReviewedScenePlacesRequest) => Promise<ReviewedScenePlacesReceipt>>().mockRejectedValueOnce(new Error("Response interrupted")).mockImplementationOnce(body => Promise.resolve(accepted(body))); const { onAccepted } = show(scene(element("a", "Library")), commit);
    await userEvent.click(await screen.findByRole("button", { name: "Create 1 and connect 1 feature" })); expect(await screen.findByRole("alert")).toHaveTextContent("Response interrupted"); expect(screen.getByRole("textbox", { name: "Place name for place_1" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled(); await userEvent.click(screen.getByRole("button", { name: "Retry same save" })); expect(commit.mock.calls[1]).toEqual(commit.mock.calls[0]); expect(onAccepted).toHaveBeenCalledOnce();
  });
  it("retains an unknown save and the identical retry after a background catalogue refresh fails", async () => {
    const commit = vi.fn<(body: ReviewedScenePlacesRequest) => Promise<ReviewedScenePlacesReceipt>>().mockRejectedValueOnce(new Error("Response interrupted")).mockImplementationOnce(body => Promise.resolve(accepted(body)));
    const { client, onAccepted } = show(scene(element("a", "Library")), commit); await userEvent.click(await screen.findByRole("button", { name: "Create 1 and connect 1 feature" })); await screen.findByRole("button", { name: "Retry same save" });
    vi.mocked(getInstitutionSetup).mockRejectedValueOnce(new Error("Refresh unavailable")); await act(async () => { await client.refetchQueries({ queryKey: ["execution-environment", "live", "institution-setup", "school"] }); });
    expect(await screen.findByText(/latest campus records could not refresh/)).toBeVisible(); expect(screen.getByRole("textbox", { name: "Place name for place_1" })).toBeDisabled(); await userEvent.click(screen.getByRole("button", { name: "Retry same save" })); expect(commit.mock.calls[1]).toEqual(commit.mock.calls[0]); expect(onAccepted).toHaveBeenCalledOnce();
  });
  it("retains an unknown set across authority loss and retries only after current access recovers", async () => {
    const commit = vi.fn<(body: ReviewedScenePlacesRequest) => Promise<ReviewedScenePlacesReceipt>>().mockRejectedValueOnce(new Error("Response interrupted")).mockImplementationOnce(body => Promise.resolve(accepted(body)));
    const { client } = show(scene(element("a", "Library")), commit); await userEvent.click(await screen.findByRole("button", { name: "Create 1 and connect 1 feature" })); await screen.findByRole("button", { name: "Retry same save" });
    vi.mocked(getInstitutionSetup).mockRejectedValueOnce(new ApiError("Access unavailable", 403)); await act(async () => { await client.refetchQueries({ queryKey: ["execution-environment", "live", "institution-setup", "school"] }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry same save" })).toBeDisabled()); expect(screen.getByText(/choices and any unconfirmed save are retained/)).toBeVisible();
    vi.mocked(getInstitutionSetup).mockResolvedValueOnce(setup); await userEvent.click(screen.getByRole("button", { name: "Refresh campus access" })); await waitFor(() => expect(screen.getByRole("button", { name: "Retry same save" })).toBeEnabled()); await userEvent.click(screen.getByRole("button", { name: "Retry same save" })); expect(commit.mock.calls[1]).toEqual(commit.mock.calls[0]);
  });
  it("treats a native pending command as an unchanged same-key retry, not a stale draft", async () => {
    const commit = vi.fn<(body: ReviewedScenePlacesRequest) => Promise<ReviewedScenePlacesReceipt>>().mockRejectedValueOnce(new ApiError("Retry with same save key", 409, { error: { code: "scene_command_pending" } })).mockImplementationOnce(body => Promise.resolve(accepted(body)));
    const { onStale } = show(scene(element("a", "Library")), commit); await userEvent.click(await screen.findByRole("button", { name: "Create 1 and connect 1 feature" }));
    const retry = await screen.findByRole("button", { name: "Retry same save" }); expect(retry).toBeEnabled(); expect(onStale).not.toHaveBeenCalled(); expect(screen.getByRole("textbox", { name: "Place name for place_1" })).toBeDisabled(); await userEvent.click(retry); expect(commit.mock.calls[1]).toEqual(commit.mock.calls[0]);
  });
  it("keeps a code collision editable without losing names or forcing a draft reload", async () => {
    const commit = vi.fn<(body: ReviewedScenePlacesRequest) => Promise<ReviewedScenePlacesReceipt>>().mockRejectedValueOnce(new ApiError("Code is used", 409, { error: { code: "campus_place_code_conflict" } })).mockImplementationOnce(body => Promise.resolve(accepted(body))); const { onStale } = show(scene(element("a", "Library")), commit);
    await userEvent.click(await screen.findByRole("button", { name: "Create 1 and connect 1 feature" })); await screen.findByRole("alert"); expect(onStale).not.toHaveBeenCalled(); await userEvent.click(screen.getByText("Code and parent (optional)")); await userEvent.clear(screen.getByLabelText("Code for place_1")); await userEvent.type(screen.getByLabelText("Code for place_1"), "LIB_NEW"); await userEvent.click(screen.getByRole("button", { name: "Create 1 and connect 1 feature" })); expect(commit.mock.calls[1]?.[0].idempotency_key).not.toBe(commit.mock.calls[0]?.[0].idempotency_key); expect(commit.mock.calls[1]?.[0].rows[0]).toMatchObject({ code: "LIB_NEW", name: "Library" });
  });
  it("does not replace a current draft with an old accepted replay", async () => {
    const commit = vi.fn<(body: ReviewedScenePlacesRequest) => Promise<ReviewedScenePlacesReceipt>>().mockImplementation(body => Promise.resolve({ ...accepted(body), replayed: true, current_revision: 9 })); const { onAccepted, onStale } = show(scene(element("a", "Library")), commit); await userEvent.click(await screen.findByRole("button", { name: "Create 1 and connect 1 feature" })); expect(await screen.findByRole("alert")).toHaveTextContent("has changed since then"); expect(onAccepted).not.toHaveBeenCalled(); expect(onStale).toHaveBeenCalledOnce();
  });
  it("ignores late accepted responses after a world or campus unmount", async () => {
    let finish!: (receipt: ReviewedScenePlacesReceipt) => void; const commit = vi.fn<(body: ReviewedScenePlacesRequest) => Promise<ReviewedScenePlacesReceipt>>().mockImplementation(() => new Promise(resolve => { finish = resolve; })); const { mounted, onAccepted } = show(scene(element("a", "Library")), commit); await userEvent.click(await screen.findByRole("button", { name: "Create 1 and connect 1 feature" })); mounted.unmount(); await act(async () => { finish(accepted(commit.mock.calls[0]![0])); await Promise.resolve(); }); expect(onAccepted).not.toHaveBeenCalled();
  });
  it("cancels without mutating the drawing or writing any places", async () => {
    const document = scene(element("a", "Library")), original = structuredClone(document); const { onCommit, onClose } = show(document); await screen.findByRole("textbox", { name: "Place name for place_1" }); await userEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(onCommit).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledOnce(); expect(document).toEqual(original);
  });
  it("keeps ambiguous grounds visual until an explicit type and action are chosen", async () => {
    const { onCommit } = show(scene({ ...element("ground", "Sports ground"), kind: "surface", asset_key: "generic" })); await screen.findByRole("button", { name: "Other grounds (1)" }); await userEvent.click(screen.getByRole("button", { name: "Other grounds (1)" })); await userEvent.selectOptions(screen.getByRole("combobox", { name: "Use Sports ground" }), "create"); expect(screen.getByRole("button", { name: "Create 0 and connect 0 features" })).toBeDisabled(); await userEvent.selectOptions(screen.getByRole("combobox", { name: "Place type for place_1" }), "sports_area"); await userEvent.click(screen.getByRole("button", { name: "Create 1 and connect 1 feature" })); expect(onCommit.mock.calls[0]?.[0].rows[0]).toMatchObject({ kind: "sports_area" }); expect(onCommit.mock.calls[0]?.[0].document.elements[0]).toMatchObject({ asset_key: "generic", review_state: "needs_review" });
  });
});
