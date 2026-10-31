import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CampusSceneEditor, type CampusSceneEditorProps } from "./CampusSceneEditor";
import { getInstitutionSetup, type InstitutionSetup } from "../office/api";
import type { CampusSceneCanvasProps } from "./CampusSceneCanvas";
import type { CampusSceneDocument } from "./types";
vi.mock("../office/api", async original => ({ ...await original<typeof import("../office/api")>(), getInstitutionSetup: vi.fn() }));
vi.mock("./CampusSceneCanvas", () => ({ CampusSceneCanvas: ({ scene, onSelectElement }: CampusSceneCanvasProps) => <div>{scene.elements.map(element => <button key={element.id} onClick={() => onSelectElement(element.id)}>Canvas {element.label}</button>)}</div> }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const document: CampusSceneDocument = { schema_version: 1, name: "Campus", source: { kind: "manual", label: "Plan" }, bounds: { width: 100, height: 100, unit: "relative" }, elements: [{ id: "building", label: "Library", kind: "building", asset_key: "generic", space_id: null, floor_id: null, review_state: "needs_review", geometry: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] } }] };
const setup: InstitutionSetup = { school: { id: "school", name: "Campus", code: "C", institution_kind: "college", timezone: "Asia/Kolkata" }, campuses: [{ id: "campus", school_id: "school", name: "Main campus", code: "MAIN", campus_type: "main", status: "active", is_primary: true, parent_campus_id: null, address_line: "", city: "", state: "", postal_code: "", timezone: "Asia/Kolkata", revision: 1 }], spaces: [], resource_types: [], holdings: [], classes: [], staff: [], activity: [], signals: [], observation_sources: [], readiness: [], summary: { campuses: 1, spaces: 0, resources: 0, classes: 0, classes_with_home_space: 0, staff: 0, complete: false } };
describe("batch review in the existing scene editor", () => {
  it("accepts one atomic saved revision, keeps Publish separate, and lets Undo change drawing links without deleting native places", async () => {
    vi.mocked(getInstitutionSetup).mockResolvedValue(setup);
    const savePlaces = vi.fn<NonNullable<CampusSceneEditorProps["onSaveReviewedPlaces"]>>().mockImplementation(body => { const saved = { ...body.document, elements: body.document.elements.map(element => ({ ...element, space_id: "canonical" })) }; return Promise.resolve({ id: "scene", revision: 8, current_revision: 8, document: saved, draft: saved, published_version: null, replayed: false, mappings: [{ proposal_id: "place_1", element_ids: ["building"], space_id: "canonical", space_revision: 1, action: "created" }] }); });
    const saveDraft = vi.fn<CampusSceneEditorProps["onSave"]>().mockImplementation((value, revision) => Promise.resolve({ document: value, revision: revision + 1 })), publish = vi.fn<CampusSceneEditorProps["onPublish"]>();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={client}><CampusSceneEditor document={document} revision={7} spaces={[]} publishedVersion={null} resourceScope={{ schoolId: "school", campusId: "campus" }} onSave={saveDraft} onPublish={publish} onSaveReviewedPlaces={savePlaces}/></QueryClientProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Review campus places" })); await userEvent.click(await screen.findByRole("button", { name: "Create 1 and connect 1 feature" }));
    expect(await screen.findByText(/1 campus places created/)).toBeVisible(); expect(savePlaces).toHaveBeenCalledOnce(); expect(publish).not.toHaveBeenCalled(); expect(saveDraft).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Editor options")); await userEvent.click(screen.getByRole("button", { name: "Undo", exact: true })); await userEvent.click(screen.getByRole("button", { name: "Save draft" })); expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ elements: [expect.objectContaining({ space_id: null })] }), 8); expect(savePlaces).toHaveBeenCalledOnce();
  });
});
