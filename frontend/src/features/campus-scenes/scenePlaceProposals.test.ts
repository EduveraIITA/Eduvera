import { describe, expect, it } from "vitest";
import { createScenePlaceProposals, reviewedScenePlaceRows, scenePlaceCode, scenePlaceMatches, reviewedScenePlaceDocument, splitScenePlaceProposal } from "./scenePlaceProposals";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import type { CampusSpace } from "../office/api";
const element = (id: string, kind: CampusSceneElement["kind"] = "building", asset?: CampusSceneElement["asset_key"]): CampusSceneElement => ({ id, kind, label: "Library", asset_key: asset, space_id: null, floor_id: null, review_state: "needs_review", geometry: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] } });
const scene = (...elements: CampusSceneElement[]): CampusSceneDocument => ({ schema_version: 1, name: "Campus", source: { kind: "manual", label: "Plan" }, bounds: { width: 100, height: 100, unit: "relative" }, elements });
const place: CampusSpace = { id: "canonical", school_id: "school", campus_id: "campus", parent_space_id: null, name: "Existing building", code: "LIBRARY_1", kind: "building", capacity: null, status: "active", is_bookable: false, is_accessible: false, revision: 7 };
describe("reviewed place proposals", () => {
  it("does not infer canonical function from names or require scenery records", () => {
    const document = scene(element("building"), element("room", "room"), element("tree", "tree", "tree_broadleaf"), element("lamp", "fixture", "lamp"), element("road", "road"), element("sports", "surface", "grass"), element("flower", "surface", "flower_bed"));
    const proposals = createScenePlaceProposals(document, []);
    expect(proposals.map(item => [item.elementIds[0], item.action, item.kind])).toEqual([["building", "create", "building"], ["room", "create", "other"], ["sports", "visual", ""], ["flower", "visual", ""]]);
  });
  it("groups only exact source-feature provenance, never matching labels", () => {
    const proposals = createScenePlaceProposals(scene({ ...element("a"), source_feature_id: "feature-1" }, { ...element("b"), source_feature_id: "feature-1" }, element("c")), []);
    expect(proposals.map(item => item.elementIds)).toEqual([["a", "b"], ["c"]]);
    expect(reviewedScenePlaceRows(scene(element("a"), element("b"), element("c")), proposals, []).repeatedNames).toEqual(["library"]);
  });
  it("leaves already-linked multipart outlines intact", () => {
    const document = scene({ ...element("linked"), source_feature_id: "feature", space_id: "canonical" }, { ...element("unlinked"), source_feature_id: "feature" });
    expect(createScenePlaceProposals(document, [place])[0]?.elementIds).toEqual(["unlinked"]);
  });
  it("auto-proposes valid unique codes without making the code a user prerequisite", () => {
    const used = new Set(["LIBRARY_1"]); expect(scenePlaceCode("Library", 0, used)).toBe("LIBRARY_2");
    const code = scenePlaceCode("आकांक्षा Campus @#$ name".repeat(5), 0, used); expect(code).toMatch(/^[A-Z0-9][A-Z0-9_-]{0,39}$/);
  });
  it("records explicit reuse with the exact current native revision without overwriting names", () => {
    const document = scene(element("a")); const proposals = createScenePlaceProposals(document, [place]); proposals[0] = { ...proposals[0]!, action: "reuse", spaceId: "canonical" };
    expect(reviewedScenePlaceRows(document, proposals, [place])).toMatchObject({ rows: [{ action: "reuse", element_ids: ["a"], space_id: "canonical", expected_space_revision: 7 }], errors: [] });
    expect(reviewedScenePlaceRows(document, proposals, [place]).rows[0]).not.toHaveProperty("name");
  });
  it("combines outlines only after an explicit same-place choice", () => {
    const document = scene(element("a"), element("b")); const proposals = createScenePlaceProposals(document, []); proposals[1] = { ...proposals[1]!, mergedInto: proposals[0]!.id };
    expect(reviewedScenePlaceRows(document, proposals, []).rows).toEqual([expect.objectContaining({ element_ids: ["a", "b"] })]);
  });
  it("requires an explicit compatible type for ambiguous grounds and keeps geometry review separate", () => {
    const document = scene(element("surface", "surface", "generic")); const proposals = createScenePlaceProposals(document, []); proposals[0] = { ...proposals[0]!, action: "create" };
    expect(reviewedScenePlaceRows(document, proposals, []).errors.join(" ")).toContain("compatible place type");
    proposals[0].kind = "sports_area"; expect(reviewedScenePlaceRows(document, proposals, []).errors).toEqual([]); expect(document.elements[0]?.review_state).toBe("needs_review"); expect(document.elements[0]?.asset_key).toBe("generic");
  });
  it("splits an exact-source group into independently reviewable outlines and preserves its first choices", () => {
    const document = scene({ ...element("a"), source_feature_id: "feature" }, { ...element("b"), source_feature_id: "feature" });
    const proposals = createScenePlaceProposals(document, []); proposals[0]!.name = "Reviewed Library";
    const split = splitScenePlaceProposal(proposals, proposals[0]!.id, []); split[1]!.action = "visual";
    expect(split[0]).toMatchObject({ id: proposals[0]!.id, name: "Reviewed Library", code: proposals[0]!.code, elementIds: ["a"] }); expect(split[1]!.code).not.toBe(split[0]!.code);
    expect(reviewedScenePlaceRows(document, split, []).rows).toHaveLength(1);
    const submitted = reviewedScenePlaceDocument(document, split, new Set(["a", "b"])); expect(submitted.elements[0]).toMatchObject({ label: "Reviewed Library", review_state: "needs_review", geometry: document.elements[0]!.geometry }); expect(submitted.elements.every(item => item.source_feature_id === undefined)).toBe(true); expect(document.elements[0]!.source_feature_id).toBe("feature");
  });
  it("only suggests exact compatible names and never changes them to reused identities automatically", () => {
    const document = scene(element("a")); const proposals = createScenePlaceProposals(document, [place]);
    expect(scenePlaceMatches(document, proposals, proposals[0]!, [place, { ...place, id: "match", name: "Library" }, { ...place, id: "wrongkind", name: "Library", kind: "gate" }]).map(item => item.id)).toEqual(["match"]); expect(proposals[0]!.action).toBe("create");
  });
  it("retains canonical parent revisions, and rejects duplicate or malformed codes before submitting", () => {
    const document = scene(element("a")); const proposals = createScenePlaceProposals(document, [place]); proposals[0] = { ...proposals[0]!, parentSpaceId: "canonical" };
    expect(reviewedScenePlaceRows(document, proposals, [place]).rows[0]).toMatchObject({ parent_space_id: "canonical", expected_parent_revision: 7 });
    proposals[0].code = place.code; expect(reviewedScenePlaceRows(document, proposals, [place]).errors.join(" ")).toContain("already used");
    proposals[0].code = "bad code"; expect(reviewedScenePlaceRows(document, proposals, [place]).errors.join(" ")).toContain("letter/number code");
  });
});
