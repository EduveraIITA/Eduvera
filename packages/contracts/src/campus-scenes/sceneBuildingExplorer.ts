import type { CampusMapAsset } from "../campus-operation";
import type { CampusSceneDocument, CampusSceneElement, CampusSceneSpace } from "./types";

export type BuildingExplorerPlace = Omit<CampusSceneSpace, "campus_id">;
export interface BuildingExplorerPlaceNode {
  id: string;
  kind: "place";
  place: BuildingExplorerPlace;
  elementId: string | null;
  parentId: string | null;
  children: BuildingExplorerNode[];
}
export interface BuildingExplorerResourceNode {
  id: string;
  kind: "resource";
  asset: CampusMapAsset;
  elementId: string;
  parentId: string | null;
  children: [];
}
export type BuildingExplorerNode = BuildingExplorerPlaceNode | BuildingExplorerResourceNode;
export interface BuildingExplorerModel {
  children: BuildingExplorerNode[];
  nodes: ReadonlyMap<string, BuildingExplorerNode>;
  floors: number;
  places: number;
  resources: number;
}
export const buildingExplorerPlaceKey = (id: string) => `place:${id}`;
export const buildingExplorerResourceKey = (id: string) => `resource:${id}`;

/** Descriptive hierarchy only: exact campus identities, never geometry/name-based ownership. */
export function sceneBuildingExplorer({ building, scene, places, assets = [] }: {
  building: CampusSceneElement;
  scene: CampusSceneDocument;
  places: readonly BuildingExplorerPlace[];
  assets?: readonly CampusMapAsset[];
}): BuildingExplorerModel {
  const children: BuildingExplorerNode[] = [], nodes = new Map<string, BuildingExplorerNode>();
  if (!building.space_id) return { children, nodes, floors: 0, places: 0, resources: 0 };
  const uniquePlaces = new Map(places.map(place => [place.id, place]));
  const childrenByParent = new Map<string, BuildingExplorerPlace[]>();
  for (const place of uniquePlaces.values()) {
    if (!place.parent_space_id || place.id === building.space_id) continue;
    const siblings = childrenByParent.get(place.parent_space_id) ?? [];
    siblings.push(place); childrenByParent.set(place.parent_space_id, siblings);
  }
  const order = (left: BuildingExplorerPlace, right: BuildingExplorerPlace) =>
    Number(right.kind === "floor") - Number(left.kind === "floor")
    || (left.kind === "floor" && right.kind === "floor" ? left.code.localeCompare(right.code, undefined, { numeric: true }) : 0)
    || left.name.localeCompare(right.name, undefined, { numeric: true });
  const pending: Array<{ spaceId: string; parentId: string | null; destination: BuildingExplorerNode[] }> = [
    { spaceId: building.space_id, parentId: null, destination: children },
  ];
  const visited = new Set([building.space_id]);
  const mappedPlaces = new Map<string, string>();
  for (const element of scene.elements) {
    if (!element.space_id || element.review_state !== "reviewed") continue;
    if (element.parent_element_id === building.id && element.kind === "room") mappedPlaces.set(element.space_id, element.id);
  }
  let floorCount = 0;
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const current = pending[cursor]!;
    for (const place of (childrenByParent.get(current.spaceId) ?? []).sort(order)) {
      if (visited.has(place.id)) continue;
      visited.add(place.id);
      const node: BuildingExplorerPlaceNode = { id: buildingExplorerPlaceKey(place.id), kind: "place", place,
        elementId: mappedPlaces.get(place.id) ?? null, parentId: current.parentId, children: [] };
      current.destination.push(node); nodes.set(node.id, node);
      if (place.kind === "floor") floorCount += 1;
      pending.push({ spaceId: place.id, parentId: node.id, destination: node.children });
    }
  }
  const knownAssets = new Set<string>(), publishedElements = new Map(scene.elements.map(element => [element.id, element]));
  for (const asset of assets) {
    if (!asset.space_id || knownAssets.has(asset.element_id)) continue;
    const parent = asset.space_id === building.space_id ? null : nodes.get(buildingExplorerPlaceKey(asset.space_id));
    if (asset.space_id !== building.space_id && parent?.kind !== "place") continue;
    const element = publishedElements.get(asset.element_id);
    if (!element || element.kind !== "fixture" || element.review_state !== "reviewed" || element.holding_id !== asset.holding_id) continue;
    knownAssets.add(asset.element_id);
    const node: BuildingExplorerResourceNode = { id: buildingExplorerResourceKey(asset.element_id), kind: "resource", asset,
      elementId: asset.element_id, parentId: parent?.id ?? null, children: [] };
    (parent?.children ?? children).push(node); nodes.set(node.id, node);
  }
  return { children, nodes, floors: floorCount, places: visited.size - 1, resources: knownAssets.size };
}

export function buildingExplorerAncestors(model: BuildingExplorerModel, id: string | null): Set<string> {
  const path = new Set<string>();
  let node = id ? model.nodes.get(id) : undefined;
  while (node?.parentId && !path.has(node.parentId)) {
    path.add(node.parentId); node = model.nodes.get(node.parentId);
  }
  return path;
}

/** Match descendants while retaining their actual ancestor path in the result. */
export function buildingExplorerMatches(model: BuildingExplorerModel, search: string): Set<string> | null {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return null;
  const result = new Set<string>();
  for (const node of model.nodes.values()) {
    const label = node.kind === "place" ? node.place.name : `${node.asset.name} ${node.asset.asset_tag ?? ""}`;
    if (!label.toLocaleLowerCase().includes(query)) continue;
    result.add(node.id); for (const id of buildingExplorerAncestors(model, node.id)) result.add(id);
  }
  return result;
}

export function buildingExplorerResourceStatus(asset: CampusMapAsset): string {
  if (asset.native_state === "retired") return "Retired";
  if (asset.native_state === "unavailable") return "Unavailable";
  if (asset.signal.state === "reported_fault") return asset.signal.impact === "not_working" ? "Reported not working" : "Reported problem";
  if (asset.signal.state === "awaiting_verification") return asset.signal.impact === "not_working" ? "Reported not working · awaiting check" : "Awaiting check";
  return asset.native_state === "available" ? "Available" : "Availability unknown";
}
