import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAppearance } from "../appearance";
import { ApiError } from "../../lib/api";
import { CampusSceneEditor, type CampusSceneEditorProps } from "./CampusSceneEditor";
import type { CampusSceneDocument } from "./types";
import { getCampusSceneResources } from "./api";

vi.mock("./api", () => ({ getCampusSceneResources: vi.fn() }));

vi.mock("./CampusSceneCanvas", () => ({ CampusSceneCanvas: (props: {
  scene: CampusSceneDocument; lighting?: "day" | "night"; onSelectElement: (id: string) => void;
  onMoveElement?: (id: string, dx: number, dy: number) => void;
  onCanvasPoint?: (point: { x: number; y: number }) => void;
}) => <div aria-label="Campus canvas" data-lighting={props.lighting}>{props.scene.elements.map(element => <button key={element.id} type="button" onClick={() => props.onSelectElement(element.id)}>Canvas {element.label}</button>)}{props.onCanvasPoint ? [
  { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 },
].map((point, index) => <button key={index} type="button" onClick={() => props.onCanvasPoint?.(point)}>Plot point {index + 1}</button>) : null}<button type="button" onClick={() => props.onMoveElement?.("library", 9999, 9999)}>Move library to edge</button></div> }));
afterEach(() => { cleanup(); setAppearance("system"); });
const initial: CampusSceneDocument = {
  schema_version: 1, name: "Green Valley campus", bounds: { width: 1000, height: 800, unit: "relative" },
  source: { kind: "manual", label: "Campus plan" }, elements: [{
    id: "library", kind: "building", label: "Library", asset_key: "library", material: "brick", roof: "flat", levels: 2,
    geometry: { type: "polygon", points: [{ x: 100, y: 100 }, { x: 250, y: 100 }, { x: 250, y: 200 }, { x: 100, y: 200 }] },
    space_id: "canonical-library", floor_id: null, review_state: "reviewed",
  }],
};
function mount(overrides: Partial<CampusSceneEditorProps> = {}) {
  const onSave = vi.fn((document: CampusSceneDocument, revision: number) => Promise.resolve({ document, revision: revision + 1 }));
  const onPublish = vi.fn(() => Promise.resolve({ version: 2 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><CampusSceneEditor document={initial} revision={7} spaces={[{ id: "canonical-library", campus_id: "main", parent_space_id: null, name: "Learning Resource Centre", code: "LIB", kind: "library" }]} publishedVersion={1} onSave={onSave} onPublish={onPublish} {...overrides} /></QueryClientProvider>);
  return { onSave, onPublish };
}
describe("campus scene editing", () => {
  it("focuses only an exact saved guide element and links a newly confirmed canonical place without changing its geometry", async () => {
    let confirmCreated: ((id: string) => void) | undefined;
    const onCreatePlace = vi.fn((_element, created: (id: string) => void) => { confirmCreated = created; });
    const { onSave } = mount({ initialElementId: "library", onCreatePlace });
    expect(screen.getByRole("region", { name: "Selected item details" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Edit campus place" }));
    expect(onCreatePlace).toHaveBeenCalledWith(initial.elements[0], expect.any(Function));
    act(() => { confirmCreated!("confirmed-place"); });
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave.mock.calls.at(-1)?.[0].elements[0]).toEqual({ ...initial.elements[0], space_id: "confirmed-place", review_state: "needs_review" });
  });
  it("ignores an unavailable saved element and does not auto-create or auto-publish from setup context", () => {
    const onCreatePlace = vi.fn(); const { onSave, onPublish } = mount({ initialElementId: "not-in-this-campus", initialPanel: "review", onCreatePlace });
    expect(screen.queryByRole("region", { name: "Selected item details" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Review campus before publishing" })).toBeVisible();
    expect(onCreatePlace).not.toHaveBeenCalled(); expect(onSave).not.toHaveBeenCalled(); expect(onPublish).not.toHaveBeenCalled();
  });
  it("shows the actual unspecified imported surface and lets the user explicitly choose its appearance", async () => {
    const { onSave } = mount({ document: { ...initial, elements: [{ ...initial.elements[0]!, id: "ground", label: "Sports ground", kind: "surface", asset_key: "generic", space_id: null }] } });
    await userEvent.click(screen.getByRole("button", { name: "Canvas Sports ground" })); expect(screen.getByRole("combobox", { name: "Appearance" })).toHaveDisplayValue("Unspecified surface");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Appearance" }), "sports"); await userEvent.click(screen.getByRole("button", { name: "Save draft" })); expect(onSave.mock.calls[0]?.[0].elements[0]).toMatchObject({ asset_key: "sports", space_id: null, review_state: "needs_review" });
  });
  it("clears source-feature grouping when an outline is manually duplicated", async () => {
    const { onSave } = mount({ document: { ...initial, elements: [{ ...initial.elements[0]!, source_feature_id: "source-feature-1" }] } }); await userEvent.click(screen.getByRole("button", { name: "Canvas Library" })); await userEvent.click(screen.getByRole("button", { name: "Duplicate" })); await userEvent.click(screen.getByRole("button", { name: "Save draft" })); expect(onSave.mock.calls[0]?.[0].elements[0]?.source_feature_id).toBe("source-feature-1"); expect(onSave.mock.calls[0]?.[0].elements[1]?.source_feature_id).toBeUndefined();
  });
  it("authors reviewed lift landings only with explicit mapped floors and clears the connection when duplicated", async () => {
    const { onSave } = mount({
      document: { ...initial, elements: [...initial.elements, { id: "lift", kind: "fixture", asset_key: "equipment", label: "East lift", geometry: { type: "point", points: [{ x: 180, y: 160 }] }, space_id: null, floor_id: null, review_state: "needs_review" }] },
      spaces: [{ id: "canonical-library", campus_id: "main", parent_space_id: null, name: "Learning Resource Centre", code: "LIB", kind: "library" }, { id: "ground", campus_id: "main", parent_space_id: "canonical-library", name: "Ground floor", code: "0", kind: "floor" }, { id: "first", campus_id: "main", parent_space_id: "canonical-library", name: "First floor", code: "1", kind: "floor" }],
    });
    await userEvent.click(screen.getByRole("button", { name: "Canvas East lift" }));
    await userEvent.click(screen.getByText("Entrance, stairs or lift", { exact: true }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Use as a floor connection" }));
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Connection building" }), "library");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Connection type" }), "lift");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "From floor" }), "ground");
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "To floor" }), "first");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Connection access" }), "closed");
    await userEvent.click(screen.getByRole("checkbox", { name: "Reviewed step-free connection" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    const saved = onSave.mock.calls.at(-1)?.[0].elements.find(element => element.id === "lift");
    expect(saved).toMatchObject({ parent_element_id: "library", floor_id: "ground", review_state: "reviewed", geometry: { type: "point", points: [{ x: 180, y: 160 }] }, navigation_connector: { kind: "lift", from_floor_id: "ground", to_floor_id: "first", status: "closed", accessible: true } });
    await screen.findByText("Draft saved. Your published campus view is unchanged.");
    await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave.mock.calls.at(-1)?.[0].elements.at(-1)?.navigation_connector).toBeUndefined();
  });
  it("edits reviewed walking access and exact endpoint links, then removes route identity from a duplicate", async () => {
    const { onSave } = mount({ document: { ...initial, elements: [{ id: "walk", kind: "path", label: "Library approach", geometry: { type: "polyline", points: [{ x: 100, y: 100 }, { x: 200, y: 100 }] }, space_id: null, floor_id: null, review_state: "reviewed" }] } });
    await userEvent.click(screen.getByRole("button", { name: "Canvas Library approach" }));
    await userEvent.click(screen.getByText("Walking routes", { exact: true }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Use for walking routes" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Path end place" }), "canonical-library");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Walking access" }), "closed");
    await userEvent.click(screen.getByRole("checkbox", { name: "Reviewed step-free path" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ elements: [expect.objectContaining({ review_state: "reviewed", navigation: { walkable: true, accessible: true, status: "closed", start_space_id: null, end_space_id: "canonical-library" } })] }), 7);
    await screen.findByText("Draft saved. Your published campus view is unchanged.");
    await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave.mock.calls.at(-1)?.[0].elements[1]?.navigation).toBeUndefined();
  });
  it("links a fixture through the campus resource catalogue, requires review, and clears identity when duplicated", async () => {
    vi.mocked(getCampusSceneResources).mockImplementation((_school, _campus, input) => Promise.resolve({ items: [{ id: "lamp-resource", name: "Entrance lamp", asset_tag: "L1", state: "unavailable", space_id: null }], selected: input.holding_id ? { id: "lamp-resource", name: "Entrance lamp", asset_tag: "L1", state: "unavailable", space_id: null } : null, page: 1, page_size: 20, total: 1 }));
    const { onSave } = mount({ resourceScope: { schoolId: "school", campusId: "main" }, document: { ...initial, elements: [{ id: "lamp", kind: "fixture", asset_key: "lamp", label: "Entrance light", geometry: { type: "point", points: [{ x: 100, y: 100 }] }, space_id: null, floor_id: null, review_state: "reviewed" }] } });
    await userEvent.click(screen.getByRole("button", { name: "Canvas Entrance light" }));
    await userEvent.click(screen.getByRole("button", { name: "Link resource" }));
    await userEvent.click(await screen.findByRole("button", { name: "Link Entrance lamp, L1" }));
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ elements: [expect.objectContaining({ holding_id: "lamp-resource", review_state: "needs_review" })] }), 7);
    await screen.findByText("Draft saved. Your published campus view is unchanged.");
    await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave.mock.calls.at(-1)?.[0].elements[1]).toMatchObject({ holding_id: null, space_id: null });
  });
  it("follows Profile appearance without changing the saved layout or adding a local lighting control", () => {
    const onDocumentChange = vi.fn();
    const { onSave, onPublish } = mount({ onDocumentChange, campusTimeZone: "Asia/Kolkata" });
    act(() => { setAppearance("dark"); });
    expect(screen.getByLabelText("Campus canvas")).toHaveAttribute("data-lighting", "night");
    act(() => { setAppearance("light"); });
    expect(screen.getByLabelText("Campus canvas")).toHaveAttribute("data-lighting", "day");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Campus lighting preview" })).not.toBeInTheDocument();
    expect(onDocumentChange).toHaveBeenCalledExactlyOnceWith(initial);
    expect(onSave).not.toHaveBeenCalled(); expect(onPublish).not.toHaveBeenCalled();
  });
  it("saves edits against the current revision and publishes only after a separate review action", async () => {
    const { onSave, onPublish } = mount();
    await userEvent.click(screen.getByRole("button", { name: "Canvas Library" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Name", exact: true }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name", exact: true }), "Campus Library");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Review", exact: true }));
    expect(screen.getByRole("button", { name: "Publish campus view" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ elements: [expect.objectContaining({ label: "Campus Library", review_state: "reviewed", space_id: "canonical-library" })] }), 7);
    expect(onPublish).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Publish campus view" }));
    await waitFor(() => expect(onPublish).toHaveBeenCalledExactlyOnceWith(8));
    expect(await screen.findByText("Campus view published · version 2.")).toBeVisible();
  });
  it("keeps failed saves editable and uses the accepted revision for the next save", async () => {
    const onSave = vi.fn<CampusSceneEditorProps["onSave"]>().mockRejectedValueOnce(new Error("Connection interrupted. Try again.")).mockImplementation((document: CampusSceneDocument) => Promise.resolve({ document, revision: 8 }));
    mount({ onSave });
    await userEvent.click(screen.getByRole("button", { name: "Canvas Library" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Surface" }), "glass");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(screen.getByRole("combobox", { name: "Surface" })).toHaveValue("glass");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Draft saved. Your published campus view is unchanged.");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Surface" }), "wood");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave.mock.calls.map(call => call[1])).toEqual([7, 7, 8]);
  });
  it("prevents additional edits during a pending save", async () => {
    let finish!: (value: { document: CampusSceneDocument; revision: number }) => void;
    const onSave = vi.fn(() => new Promise<{ document: CampusSceneDocument; revision: number }>(resolve => { finish = resolve; }));
    mount({ onSave });
    await userEvent.click(screen.getByRole("button", { name: "Canvas Library" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Surface" }), "glass");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(screen.getByRole("combobox", { name: "Surface" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    await act(async () => { finish({ document: initial, revision: 8 }); await Promise.resolve(); });
    expect(screen.getByRole("combobox", { name: "Surface" })).toBeEnabled();
  });
  it("keeps a stale draft recoverable and blocks an overwrite", async () => {
    const onReload = vi.fn();
    mount({ onSave: vi.fn().mockRejectedValue(new ApiError("Stale revision", 409)), onReload });
    await userEvent.click(screen.getByRole("button", { name: "Canvas Library" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Surface" }), "glass");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "Download my draft" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Reload latest draft" }));
    expect(onReload).toHaveBeenCalledOnce();
  });
  it("adds a drawn footprint with no invented place identity, then undoes it", async () => {
    const { onSave } = mount({ document: { ...initial, elements: [] }, revision: 0 });
    await userEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Draw on plan" }));
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
    for (let index = 1; index <= 3; index++) await userEvent.click(screen.getByRole("button", { name: `Plot point ${index}` }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ elements: [expect.objectContaining({ kind: "building", space_id: null, review_state: "needs_review", geometry: { type: "polygon", points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }] } })] }), 0);
    await userEvent.click(screen.getByLabelText("Editor options"));
    await userEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
    expect(screen.queryByRole("button", { name: "Canvas Learning building" })).not.toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeVisible();
  });
  it("duplicates artwork without reusing the canonical place link", async () => {
    const { onSave } = mount();
    await userEvent.click(screen.getByRole("button", { name: "Canvas Library" }));
    await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(screen.getByRole("combobox", { name: "Campus place" })).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    const saved = onSave.mock.calls[0]![0];
    expect(saved.elements[0]?.space_id).toBe("canonical-library");
    expect(saved.elements[1]).toMatchObject({ label: "Library copy", space_id: null, review_state: "needs_review" });
  });
  it("requires explicit layout checks for bulk review and reopens review when an item changes", async () => {
    const { onSave, onPublish } = mount({ document: { ...initial, elements: initial.elements.map(element => ({ ...element, review_state: "needs_review" })) } });
    await userEvent.click(screen.getByRole("button", { name: "Review", exact: true }));
    expect(screen.getByRole("button", { name: "Mark layout reviewed" })).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox")) await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole("button", { name: "Mark layout reviewed" }));
    expect(screen.getByText("All features reviewed.")).toBeVisible();
    expect(onSave).not.toHaveBeenCalled(); expect(onPublish).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Canvas Library" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Surface" }), "glass");
    expect(screen.getByRole("button", { name: "Mark layout reviewed" })).toBeDisabled();
    expect(screen.getAllByRole("checkbox").every(box => !(box as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("button", { name: "Publish campus view" })).toBeDisabled();
  });
});
