import type { CampusSpace } from "../institution";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import type { ReviewedScenePlaceRow } from "./contracts";

export type ScenePlaceKind = CampusSpace["kind"];
export interface ScenePlaceProposal {
  id: string; elementIds: string[]; name: string; code: string; kind: ScenePlaceKind | "";
  action: "create" | "reuse" | "visual"; spaceId: string; parentSpaceId: string; mergedInto: string;
  category: "places" | "other";
}
export const SCENE_PLACE_KIND_LABELS: Partial<Record<ScenePlaceKind, string>> = { building: "Building", wing: "Wing", library: "Library", laboratory: "Laboratory", office: "Office", auditorium: "Auditorium", hostel: "Residence building", workshop: "Workshop", staff_room: "Staff room", other: "Other place", classroom: "Classroom", residential_room: "Residential room", gate: "Gate", outdoor_area: "Outdoor area", sports_area: "Sports area" };
export function scenePlaceKinds(element: CampusSceneElement): ScenePlaceKind[] {
  if (element.kind === "building") return ["building", "wing", "library", "laboratory", "office", "auditorium", "hostel", "workshop", "staff_room", "other"];
  if (element.kind === "room") return ["classroom", "laboratory", "library", "office", "staff_room", "workshop", "residential_room", "other"];
  if (element.kind === "fixture" && element.asset_key === "gate") return ["gate"];
  if (element.kind === "surface") return ["outdoor_area", "sports_area", "other"];
  return [];
}
export function sceneProposalElements(document: CampusSceneDocument, proposals: readonly ScenePlaceProposal[], root: ScenePlaceProposal): CampusSceneElement[] {
  const members = proposals.filter(item => item.id === root.id || item.mergedInto === root.id).flatMap(item => item.elementIds);
  return document.elements.filter(element => members.includes(element.id));
}
export function sceneProposalKinds(elements: readonly CampusSceneElement[]): ScenePlaceKind[] {
  return elements.length ? scenePlaceKinds(elements[0]!).filter(kind => elements.every(element => scenePlaceKinds(element).includes(kind))) : [];
}
export function scenePlaceCode(name: string, index: number, used: Set<string>): string {
  const prefix = name.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30).toUpperCase() || "PLACE";
  let suffix = index + 1, code = `${prefix}_${suffix}`;
  while (used.has(code.toUpperCase())) code = `${prefix}_${++suffix}`;
  used.add(code.toUpperCase()); return code;
}
/** Proposals are review inputs, never canonical identity inferred from a name. */
export function createScenePlaceProposals(document: CampusSceneDocument, spaces: readonly CampusSpace[]): ScenePlaceProposal[] {
  const groups = new Map<string, CampusSceneElement[]>();
  for (const element of document.elements) {
    if (element.space_id || !scenePlaceKinds(element).length) continue;
    const key = element.source_feature_id ? `source:${element.source_feature_id}` : `element:${element.id}`;
    const group = groups.get(key) ?? []; group.push(element); groups.set(key, group);
  }
  const used = new Set(spaces.map(space => space.code.toUpperCase()));
  return [...groups.values()].map((elements, index) => {
    const first = elements[0]!, kinds = sceneProposalKinds(elements);
    const principal = elements.every(element => element.kind === "building" || element.kind === "room" || element.asset_key === "gate" || element.asset_key === "sports" || element.asset_key === "parking");
    const kind: ScenePlaceKind | "" = kinds.includes("building") ? "building" : elements.every(element => element.kind === "room") ? "other" : kinds.includes("gate") ? "gate" : elements.every(element => element.asset_key === "sports") ? "sports_area" : elements.every(element => element.asset_key === "parking") ? "outdoor_area" : "";
    const parentId = first.floor_id;
    const parent = parentId ? spaces.find(space => space.id === parentId && space.status === "active") : undefined;
    return { id: `place_${index + 1}`, elementIds: elements.map(element => element.id), name: first.label, code: scenePlaceCode(first.label, index, used), kind, action: principal ? "create" : "visual", spaceId: "", parentSpaceId: parent?.id ?? "", mergedInto: "", category: principal ? "places" : "other" };
  });
}
export function reviewedScenePlaceRows(document: CampusSceneDocument, proposals: readonly ScenePlaceProposal[], spaces: readonly CampusSpace[]): { rows: ReviewedScenePlaceRow[]; errors: string[]; repeatedNames: string[] } {
  const errors: string[] = [], rows: ReviewedScenePlaceRow[] = [], codes = new Set<string>(), names = new Map<string, number>();
  for (const proposal of proposals.filter(item => !item.mergedInto && item.action !== "visual")) {
    const elements = sceneProposalElements(document, proposals, proposal), element_ids = elements.map(element => element.id);
    if (proposal.action === "reuse") {
      const place = spaces.find(space => space.id === proposal.spaceId && space.status === "active");
      if (!place || !elements.every(element => scenePlaceKinds(element).includes(place.kind))) { errors.push(`Choose a compatible existing place for ${proposal.name || "this feature"}.`); continue; }
      rows.push({ proposal_id: proposal.id, element_ids, action: "reuse", space_id: place.id, expected_space_revision: place.revision });
      continue;
    }
    const name = proposal.name.trim(), code = proposal.code.trim().toUpperCase();
    if (name.length < 2 || name.length > 160) errors.push("Give each new place a name of 2–160 characters.");
    if (!proposal.kind || !sceneProposalKinds(elements).includes(proposal.kind)) errors.push(`Choose a compatible place type for ${name || "this feature"}.`);
    if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) errors.push(`Use a short letter/number code for ${name || "this feature"}.`);
    if (codes.has(code) || spaces.some(space => space.code.toUpperCase() === code)) errors.push(`The code ${code || "(empty)"} is already used. Change it or reuse the existing place.`);
    codes.add(code); const normalizedName = name.toLocaleLowerCase(); names.set(normalizedName, (names.get(normalizedName) ?? 0) + 1);
    const parent = proposal.parentSpaceId ? spaces.find(space => space.id === proposal.parentSpaceId && space.status === "active") : undefined;
    if (proposal.parentSpaceId && !parent) errors.push(`Choose a current parent place for ${name}.`);
    if (proposal.kind) rows.push({ proposal_id: proposal.id, element_ids, action: "create", name, code, kind: proposal.kind, ...(parent ? { parent_space_id: parent.id, expected_parent_revision: parent.revision } : {}) });
  }
  if (rows.length > 500) errors.push("Choose up to 500 places in one save. Keep the remaining features visual for now.");
  return { rows, errors: [...new Set(errors)], repeatedNames: [...names].filter(([, count]) => count > 1).map(([name]) => name) };
}

/** Name matches are suggestions only; callers require an explicit reuse choice. */
export function scenePlaceMatches(document: CampusSceneDocument, proposals: readonly ScenePlaceProposal[], proposal: ScenePlaceProposal, spaces: readonly CampusSpace[]): CampusSpace[] {
  const name = proposal.name.trim().normalize("NFKC").toLocaleLowerCase(), kinds = sceneProposalKinds(sceneProposalElements(document, proposals, proposal));
  return name ? spaces.filter(space => space.status === "active" && space.name.trim().normalize("NFKC").toLocaleLowerCase() === name && kinds.includes(space.kind)) : [];
}
/** Names approved in this review change the drawing through its existing full-document writer. */
export function reviewedScenePlaceDocument(document: CampusSceneDocument, proposals: readonly ScenePlaceProposal[], splitElementIds: ReadonlySet<string> = new Set()): CampusSceneDocument {
  const names = new Map<string, string>();
  for (const proposal of proposals.filter(item => !item.mergedInto && item.action !== "visual")) for (const element of sceneProposalElements(document, proposals, proposal)) names.set(element.id, proposal.name.trim());
  return { ...document, elements: document.elements.map(element => { const name = names.get(element.id); const updated = name && name !== element.label ? { ...element, label: name, review_state: "needs_review" as const } : element; return splitElementIds.has(element.id) ? { ...updated, source_feature_id: undefined } : updated; }) };
}

/** Splitting is an explicit review decision; it does not change canonical records. */
export function splitScenePlaceProposal(proposals: readonly ScenePlaceProposal[], id: string, spaces: readonly CampusSpace[]): ScenePlaceProposal[] {
  const selected = proposals.find(item => item.id === id);
  if (!selected || selected.elementIds.length < 2) return [...proposals];
  const used = new Set([...spaces.map(space => space.code.toUpperCase()), ...proposals.map(item => item.code.toUpperCase())]);
  const ids = new Set(proposals.map(item => item.id));
  return proposals.flatMap(item => item.id !== id ? [item] : item.elementIds.map((elementId, index) => {
    if (index === 0) return { ...item, elementIds: [elementId] };
    let suffix = index + 1, nextId = `${id}_part_${suffix}`;
    while (ids.has(nextId)) nextId = `${id}_part_${++suffix}`;
    ids.add(nextId);
    return { ...item, id: nextId, elementIds: [elementId], code: scenePlaceCode(item.name, proposals.length + index, used), mergedInto: "" };
  }));
}
