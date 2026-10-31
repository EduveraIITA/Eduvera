import { scenePointBounds } from "./sceneGeometry";
import { scenePlaceCode } from "./scenePlaceProposals";
import type { ReviewedScenePlaceRow } from "./contracts";
import type { CampusSceneDocument, CampusSceneElement, CampusSceneSpace } from "./types";

export interface SceneFloorPlanContext {
  buildingId: string;
  buildingElementId: string;
  floorId: string | null;
  newFloor?: { name: string; code: string };
  elementIds: string[];
  imageUrl?: string;
  imageBounds: { x: number; y: number; width: number; height: number };
  imageRotationDeg?: number;
}

export interface FloorPlanAdjustment { rotationDeg?: number; scale?: number; dx?: number; dy?: number }
export function floorPlanDisplayBounds(context: SceneFloorPlanContext): SceneFloorPlanContext["imageBounds"] {
  const box = context.imageBounds, angle = (context.imageRotationDeg ?? 0) * Math.PI / 180;
  const width = Math.abs(Math.cos(angle)) * box.width + Math.abs(Math.sin(angle)) * box.height;
  const height = Math.abs(Math.sin(angle)) * box.width + Math.abs(Math.cos(angle)) * box.height;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/** One group transform keeps every room/opening and its private reference aligned. */
export function adjustFloorPlan(document: CampusSceneDocument, context: SceneFloorPlanContext, adjustment: FloorPlanAdjustment): { document: CampusSceneDocument; context: SceneFloorPlanContext } {
  const scale = adjustment.scale ?? 1, degrees = adjustment.rotationDeg ?? 0, dx = adjustment.dx ?? 0, dy = adjustment.dy ?? 0;
  if (![scale, degrees, dx, dy].every(Number.isFinite) || scale <= 0) throw new Error("Choose a valid floor-plan adjustment.");
  const box = context.imageBounds, cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const angle = degrees * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle), ids = new Set(context.elementIds);
  const transformed = document.elements.map(element => !ids.has(element.id) ? element : { ...element,
    geometry: { ...element.geometry, points: element.geometry.points.map(point => ({ x: cx + ((point.x - cx) * cosine - (point.y - cy) * sine) * scale + dx, y: cy + ((point.x - cx) * sine + (point.y - cy) * cosine) * scale + dy })) },
    ...(element.width !== undefined ? { width: element.width * scale } : {}), ...(element.depth !== undefined ? { depth: element.depth * scale } : {}), ...(element.height !== undefined ? { height: element.height * scale } : {}),
    ...(element.kind === "fixture" ? { rotation_deg: ((element.rotation_deg ?? 0) + degrees + 360) % 360 } : {}), review_state: "needs_review" as const,
  });
  if (transformed.some(element => ids.has(element.id) && element.geometry.points.some(point => point.x < 0 || point.y < 0 || point.x > document.bounds.width || point.y > document.bounds.height))) throw new Error("Keep the floor plan within the campus drawing. Try a smaller adjustment.");
  return { document: { ...document, elements: transformed }, context: { ...context, imageBounds: { x: cx + dx - box.width * scale / 2, y: cy + dy - box.height * scale / 2, width: box.width * scale, height: box.height * scale }, imageRotationDeg: ((context.imageRotationDeg ?? 0) + degrees + 360) % 360 } };
}

/** A relative proposal is fitted without rotating, distorting or rewriting existing campus geometry. */
export function mergeFloorPlanProposal(document: CampusSceneDocument, proposal: CampusSceneDocument, building: CampusSceneElement, floorId: string | null, makeId: () => string = () => crypto.randomUUID()): { document: CampusSceneDocument; elementIds: string[]; imageBounds: SceneFloorPlanContext["imageBounds"] } {
  if (building.kind !== "building" || !building.space_id || building.geometry.type !== "polygon") throw new Error("Choose a mapped building before adding its floor plan.");
  if (document.elements.length + proposal.elements.length > 2000) throw new Error("This plan exceeds the layout limit. Use a smaller section of the floor plan.");
  const box = scenePointBounds(building.geometry.points);
  if (box.width <= 0 || box.height <= 0 || proposal.bounds.width <= 0 || proposal.bounds.height <= 0) throw new Error("The building or floor plan has no usable outline.");
  if (proposal.elements.some(element => !["room", "path", "fixture"].includes(element.kind) || element.space_id || element.holding_id || element.navigation || element.navigation_connector)) throw new Error("This proposal contains unsupported or already linked features. Prepare a new floor plan.");
  const scale = Math.min(box.width / proposal.bounds.width, box.height / proposal.bounds.height) * .96;
  const imageBounds = { x: box.x + (box.width - proposal.bounds.width * scale) / 2, y: box.y + (box.height - proposal.bounds.height * scale) / 2, width: proposal.bounds.width * scale, height: proposal.bounds.height * scale };
  const identities = new Map(proposal.elements.map(element => [element.id, makeId()]));
  const elements = proposal.elements.map(element => ({ ...element, id: identities.get(element.id)!, source_feature_id: undefined,
    geometry: { ...element.geometry, points: element.geometry.points.map(point => ({ x: imageBounds.x + point.x * scale, y: imageBounds.y + point.y * scale })) },
    space_id: null, floor_id: floorId, parent_element_id: element.parent_element_id && identities.has(element.parent_element_id) ? identities.get(element.parent_element_id)! : building.id,
    ...(element.width !== undefined ? { width: element.width * scale } : {}), ...(element.depth !== undefined ? { depth: element.depth * scale } : {}), ...(element.height !== undefined ? { height: element.height * scale } : {}), review_state: "needs_review" as const,
  }));
  return { document: { ...document, elements: [...document.elements, ...elements] }, elementIds: elements.map(element => element.id), imageBounds };
}

/** Only this reviewed floor and its proposed rooms join the existing atomic place writer. */
export function floorPlanReviewedRows(context: SceneFloorPlanContext, rows: readonly ReviewedScenePlaceRow[], spaces: readonly CampusSceneSpace[]): { rows: ReviewedScenePlaceRow[]; errors: string[] } {
  const building = spaces.find(space => space.id === context.buildingId);
  const errors: string[] = [];
  if (!context.elementIds.length) errors.push("Draw at least one room or opening before reviewing this floor plan.");
  if (!building || building.revision === undefined) errors.push("Refresh the building before creating its floor plan.");
  const proposalId = "floor_plan_target";
  let floor: ReviewedScenePlaceRow | undefined;
  if (context.floorId) {
    const selected = spaces.find(space => space.id === context.floorId && space.kind === "floor");
    if (!selected || selected.revision === undefined) errors.push("Refresh the selected floor before continuing.");
    else floor = { proposal_id: proposalId, action: "reuse", space_id: selected.id, expected_space_revision: selected.revision, element_ids: [], floor_element_ids: context.elementIds };
  } else if (building?.revision !== undefined && context.newFloor) {
    const name = context.newFloor.name.trim(), code = context.newFloor.code.trim().toUpperCase() || scenePlaceCode(`${building.code}_${name}`, 0, new Set(spaces.map(space => space.code.toUpperCase())));
    if (name.length < 2 || name.length > 160) errors.push("Give the new floor a name of 2–160 characters.");
    if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code) || spaces.some(space => space.code.toUpperCase() === code)) errors.push("Choose an unused floor code made from letters and numbers.");
    floor = { proposal_id: proposalId, action: "create", kind: "floor", name, code, parent_space_id: building.id, expected_parent_revision: building.revision, element_ids: [], floor_element_ids: context.elementIds };
  }
  if (!floor) errors.push("Choose the floor that will contain this plan.");
  return { rows: [...(floor ? [floor] : []), ...rows.map(row => row.action === "create" ? { ...row, parent_space_id: undefined, expected_parent_revision: undefined, parent_proposal_id: proposalId } : row)], errors };
}
