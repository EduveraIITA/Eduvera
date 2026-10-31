import type { CampusSceneDocument, CampusSceneElement } from "./campus-scenes/types";
import type { SceneEvidenceRecord } from "./campus-scenes/sceneEvidence.types";
import type { CampusMapActivity, CampusMapAsset } from "./campus-operation";

export function boundCampusAssets(scene: CampusSceneDocument | null, assets: readonly CampusMapAsset[]) {
  return scene ? assets.filter(asset => scene.elements.some(element => element.kind === "fixture" && element.id === asset.element_id && element.holding_id === asset.holding_id)) : [];
}
export function campusAssetUnavailable(asset: CampusMapAsset) {
  return asset.native_state === "unavailable" || asset.signal.impact === "not_working"
    && (asset.signal.state === "reported_fault" || asset.signal.state === "awaiting_verification");
}
export function campusAssetFaultIds(scene: CampusSceneDocument | null, assets: readonly CampusMapAsset[], kind: "lamp" | "lift") {
  return boundCampusAssets(scene, assets).filter(asset => campusAssetUnavailable(asset) && scene?.elements.some(element => element.id === asset.element_id
    && (kind === "lamp" ? element.asset_key === "lamp" : element.navigation_connector?.kind === "lift"))).map(asset => asset.element_id);
}
export function campusLinkedLiftIds(scene: CampusSceneDocument | null) {
  return scene?.elements.filter(element => element.kind === "fixture" && element.holding_id && element.navigation_connector?.kind === "lift").map(element => element.id) ?? [];
}
export function campusBlockedLiftIds(scene: CampusSceneDocument | null, assets: readonly CampusMapAsset[]) {
  const bound = new Map(boundCampusAssets(scene, assets).map(asset => [asset.element_id, asset]));
  return campusLinkedLiftIds(scene).filter(id => !bound.has(id) || campusAssetUnavailable(bound.get(id)!));
}
export function campusActivityState(item: CampusMapActivity) {
  if (item.dimension === "expected") return item.state === "in_progress" ? "Scheduled now" : item.state === "upcoming" ? "Upcoming" : "Scheduled";
  const labels: Record<string, string> = { reported: "Reported", accepted: "Accepted", in_progress: "Repair in progress", waiting: "Waiting", awaiting_verification: "Ready to check", closed: "Closed", assigned: "Assigned" };
  return labels[item.state] ?? "Recorded work";
}
export function campusActivityRecords(items: readonly CampusMapActivity[]): SceneEvidenceRecord[] {
  return items.map(item => ({ id: `campus-layer-record:${item.id}`, spaceId: item.space_id, dimension: item.dimension, title: item.title,
    detail: [campusActivityState(item), item.detail, item.dimension === "expected" ? "Scheduled place; not physical presence." : null].filter(Boolean).join(" · "),
    sourceLabel: item.source.label, targetPath: item.target_path, occurredAt: item.starts_at ?? undefined,
    temporal: item.dimension === "expected" ? item.state === "in_progress" ? "current" : item.state === "upcoming" ? "upcoming" : "unknown" : "current" }));
}
export function campusAssetLabel(asset: CampusMapAsset) {
  if (asset.signal.state === "reported_fault") return asset.signal.impact === "not_working" ? "Reported not working" : "Reported reduced service";
  if (asset.signal.state === "awaiting_verification") return asset.signal.impact === "not_working" ? "Reported not working · repair awaiting check" : "Repair awaiting check";
  if (asset.signal.state === "verified_resolution") return "Repair checked";
  return "No current shared asset status";
}
export function assetForSceneElement(assets: readonly CampusMapAsset[], element: CampusSceneElement) {
  return assets.find(asset => asset.element_id === element.id && asset.holding_id === element.holding_id);
}
