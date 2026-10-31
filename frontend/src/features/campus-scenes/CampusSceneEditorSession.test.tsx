import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusSceneEditorSession } from "./CampusSceneEditorSession";
import type { CampusSceneEditorProps } from "./CampusSceneEditor";
import { getCampusSceneImportCapabilities, publishCampusScene, requestCampusSceneImport, saveCampusSceneDraft, saveReviewedScenePlaces, uploadCampusSceneImage } from "./api";
import type { CampusSceneDocument, CampusSceneImportRequest, CampusSceneSpace } from "./types";
import { ApiError } from "../../lib/api";
const state = vi.hoisted(() => ({ editor: null as CampusSceneEditorProps | null }));
vi.mock("./CampusSceneEditor", () => ({ CampusSceneEditor: (props: CampusSceneEditorProps) => { state.editor = props; return <div>Campus editor</div>; } }));
vi.mock("./useSceneImageUrl", () => ({ useSceneImageUrl: () => ({ url: undefined, error: undefined, loading: false }) }));
vi.mock("./api", () => ({ getCampusSceneImportCapabilities: vi.fn(), lookupCampusSceneLocation: vi.fn(), publishCampusScene: vi.fn(), requestCampusSceneImport: vi.fn(), saveCampusSceneDraft: vi.fn(), saveReviewedScenePlaces: vi.fn(), uploadCampusSceneImage: vi.fn() }));
const document: CampusSceneDocument = { schema_version: 1, name: "Campus draft", bounds: { width: 1000, height: 800, unit: "relative" }, source: { kind: "manual", label: "Manual" }, elements: [] };
beforeEach(() => { vi.clearAllMocks(); state.editor = null; vi.mocked(getCampusSceneImportCapabilities).mockResolvedValue({ image_analysis: { available: true }, map_search: { available: true }, max_image_bytes: 4194304 }); });
afterEach(cleanup);
async function mount(spaces: CampusSceneSpace[] = []) {
  const onPublished = vi.fn(); const onDirtyChange = vi.fn(); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mounted = render(<QueryClientProvider client={client}><CampusSceneEditorSession schoolId="school" campusId="campus" worldKey="live:global" workspace={{ campus: { id: "campus", name: "Campus", code: "MAIN" }, spaces, scene: null }} onPublished={onPublished} onReload={vi.fn()} onDirtyChange={onDirtyChange} /></QueryClientProvider>);
  await waitFor(() => expect(state.editor?.capabilities?.image_analysis.available).toBe(true));
  return { onPublished, onDirtyChange, mounted };
}
describe("campus editor service session", () => {
  it("requests an indoor proposal with exact canonical revisions, preserves uncertain attempt identity and traces the same upload", async () => {
    vi.mocked(uploadCampusSceneImage).mockResolvedValue({ image: { id: "floor-image", mime_type: "image/png", width: 1000, height: 500, sha256: "hash", byte_size: 200 }, replayed: false });
    vi.mocked(requestCampusSceneImport).mockRejectedValueOnce(new Error("Response interrupted")).mockResolvedValueOnce({ document });
    await mount([{ id: "building", campus_id: "campus", kind: "library", parent_space_id: null, name: "Learning centre", code: "LIB", revision: 3 }, { id: "floor", campus_id: "campus", kind: "floor", parent_space_id: "building", name: "Teaching floor", code: "LIB1", revision: 6 }]);
    const request = { file: new File(["png"], "library-floor.png", { type: "image/png" }), buildingId: "building", floorId: "floor", instructions: "Reception at bottom", rightsConfirmed: true as const };
    await expect(state.editor!.onImportFloorPlan!(request)).rejects.toThrow("Response interrupted");
    await state.editor!.onImportFloorPlan!(request);
    expect(requestCampusSceneImport).toHaveBeenCalledTimes(2);
    const first = vi.mocked(requestCampusSceneImport).mock.calls[0]![2];
    expect(first).toMatchObject({ purpose: "floor_plan", source_kind: "site_plan", image_asset_id: "floor-image", target: { building_id: "building", expected_building_revision: 3, floor_id: "floor", expected_floor_revision: 6 } });
    expect(vi.mocked(requestCampusSceneImport).mock.calls[1]![2]).toEqual(first);
    const traced = await state.editor!.onImportFloorPlan!({ ...request, traceOnly: true });
    expect(traced.elements).toEqual([]); expect(traced.bounds).toEqual({ width: 1000, height: 500, unit: "relative" });
    expect(uploadCampusSceneImage).toHaveBeenCalledOnce(); expect(requestCampusSceneImport).toHaveBeenCalledTimes(2);
  });
  it("accepts an atomic reviewed place save through the same service and exposes the accepted canonical place", async () => {
    vi.mocked(saveReviewedScenePlaces).mockResolvedValue({ id: "scene", revision: 3, current_revision: 3, document, draft: document, published_version: null, replayed: false, mappings: [{ proposal_id: "place_1", element_ids: ["building"], space_id: "canonical", space_revision: 1, action: "created" }] });
    const { onDirtyChange } = await mount();
    const body = { idempotency_key: "key", expected_revision: 0, document, rows: [{ proposal_id: "place_1", element_ids: ["building"], action: "create" as const, name: "Library", code: "LIB", kind: "building" as const }] };
    await act(async () => { await state.editor!.onSaveReviewedPlaces!(body); });
    expect(saveReviewedScenePlaces).toHaveBeenCalledExactlyOnceWith("school", "campus", body); expect(state.editor!.spaces).toContainEqual(expect.objectContaining({ id: "canonical", campus_id: "campus", name: "Library" })); expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it("does not apply an old accepted batch replay over the current draft", async () => {
    vi.mocked(saveReviewedScenePlaces).mockResolvedValue({ id: "scene", revision: 3, current_revision: 4, document, draft: document, published_version: null, replayed: true, mappings: [] });
    const { onDirtyChange } = await mount(); await state.editor!.onSaveReviewedPlaces!({ idempotency_key: "key", expected_revision: 0, document, rows: [] }); expect(onDirtyChange).not.toHaveBeenCalled();
  });
  it("does not clear another campus dirty state after an unmounted batch session completes", async () => {
    let finish!: (result: Awaited<ReturnType<typeof saveReviewedScenePlaces>>) => void;
    vi.mocked(saveReviewedScenePlaces).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { onDirtyChange, mounted } = await mount(); const pending = state.editor!.onSaveReviewedPlaces!({ idempotency_key: "key", expected_revision: 0, document, rows: [] }); mounted.unmount();
    await act(async () => { finish({ id: "scene", revision: 3, current_revision: 3, document, draft: document, published_version: null, replayed: false, mappings: [] }); await pending; }); expect(onDirtyChange).not.toHaveBeenCalled();
  });
  it("reuses the exact save attempt key after an uncertain failure", async () => {
    vi.mocked(saveCampusSceneDraft).mockRejectedValueOnce(new Error("Response interrupted")).mockResolvedValueOnce({ id: "scene", revision: 1, document, draft: document, published_version: null, replayed: true });
    const { onDirtyChange } = await mount();
    await expect(state.editor!.onSave(document, 0)).rejects.toThrow("Response interrupted");
    await state.editor!.onSave(document, 0);
    const calls = vi.mocked(saveCampusSceneDraft).mock.calls;
    expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it("retains an uploaded image after analysis fails and traces it without a second upload", async () => {
    vi.mocked(uploadCampusSceneImage).mockResolvedValue({ image: { id: "private-image", mime_type: "image/png", width: 1200, height: 800, sha256: "hash", byte_size: 200 }, replayed: false });
    vi.mocked(requestCampusSceneImport).mockRejectedValue(new Error("Analysis unavailable; image saved."));
    await mount();
    const request: CampusSceneImportRequest = { kind: "image", file: new File(["png"], "campus.png", { type: "image/png" }), label: "Our aerial", sourceKind: "aerial_image", rightsConfirmed: true };
    await expect(state.editor!.onImport!(request)).rejects.toThrow("image saved");
    let traced!: CampusSceneDocument;
    await act(async () => { traced = await state.editor!.onImport!({ ...request, traceOnly: true }); });
    expect(uploadCampusSceneImage).toHaveBeenCalledTimes(1);
    expect(requestCampusSceneImport).toHaveBeenCalledTimes(1);
    expect(traced.source).toMatchObject({ kind: "aerial_image", image_asset_id: "private-image" });
    expect(traced.elements).toEqual([]);
    expect(traced.bounds).toEqual({ width: 1000, height: 667, unit: "relative" });
  });
  it("returns the accepted publication revision and exits to the published view", async () => {
    vi.mocked(publishCampusScene).mockResolvedValue({ id: "scene", revision: 8, version: 8, document, draft: null, published_version: 8, replayed: false });
    const { onPublished } = await mount();
    expect(await state.editor!.onPublish(7)).toEqual({ version: 8, revision: 8 });
    expect(onPublished).toHaveBeenCalledOnce();
    expect(publishCampusScene).toHaveBeenCalledWith("school", "campus", 7, expect.any(String));
  });
  it.each([
    { name: "raw receipt", details: { code: "campus_import_failed", retry_requires_new_key: true, attempt_id: "attempt-1" } },
    { name: "standard HTTP envelope", details: { error: { status: 422, code: "campus_import_failed", detail: "Analysis failed; image saved.", request_id: "request-1" } } },
  ])("retains an uncertain import key and starts a fresh attempt only after a definitive $name", async ({ details }) => {
    vi.mocked(uploadCampusSceneImage).mockResolvedValue({ image: { id: "private-image", mime_type: "image/png", width: 1200, height: 800, sha256: "hash", byte_size: 200 }, replayed: false });
    vi.mocked(requestCampusSceneImport)
      .mockRejectedValueOnce(new Error("Response interrupted"))
      .mockRejectedValueOnce(new ApiError("Analysis failed; image saved.", 422, details))
      .mockResolvedValueOnce({ document });
    await mount();
    const request: CampusSceneImportRequest = { kind: "image", file: new File(["png"], "campus.png", { type: "image/png" }), label: "Our aerial", sourceKind: "aerial_image", rightsConfirmed: true };
    await expect(state.editor!.onImport!(request)).rejects.toThrow("Response interrupted");
    expect(requestCampusSceneImport).toHaveBeenCalledTimes(1);
    await expect(state.editor!.onImport!(request)).rejects.toThrow("Analysis failed");
    expect(requestCampusSceneImport).toHaveBeenCalledTimes(2);
    const first = vi.mocked(requestCampusSceneImport).mock.calls[0]![2];
    expect(vi.mocked(requestCampusSceneImport).mock.calls[1]![2]).toEqual(first);
    await state.editor!.onImport!(request);
    const third = vi.mocked(requestCampusSceneImport).mock.calls[2]![2];
    expect(third.idempotency_key).not.toBe(first.idempotency_key);
    expect({ ...third, idempotency_key: first.idempotency_key }).toEqual(first);
    expect(uploadCampusSceneImage).toHaveBeenCalledOnce();
  });
});
