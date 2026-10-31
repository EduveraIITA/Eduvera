import type { CampusSceneElement } from "./types";
import { SCENE_INDOOR_ASSETS } from './sceneIndoorAssets';

export interface CampusSceneAsset {
  key: NonNullable<CampusSceneElement["asset_key"]>;
  label: string;
  kind: CampusSceneElement["kind"];
  material: NonNullable<CampusSceneElement["material"]>;
  roof?: NonNullable<CampusSceneElement["roof"]>;
  width?: number;
  height?: number;
  depth?: number;
  levels?: number;
}

/** Presentation presets only: selecting one never creates a domain place or resource. */
export const CAMPUS_SCENE_ASSETS: readonly CampusSceneAsset[] = [
  { key: "academic", label: "Learning building", kind: "building", material: "neutral", roof: "flat", levels: 3 },
  { key: "library", label: "Library building", kind: "building", material: "concrete", roof: "flat", levels: 2 },
  { key: "administration", label: "Office building", kind: "building", material: "brick", roof: "hip", levels: 2 },
  { key: "laboratory", label: "Laboratory building", kind: "building", material: "glass", roof: "flat", levels: 2 },
  { key: "auditorium", label: "Hall", kind: "building", material: "concrete", roof: "gable", levels: 2 },
  { key: "residence", label: "Residence building", kind: "building", material: "brick", roof: "flat", levels: 4 },
  { key: "dining", label: "Dining building", kind: "building", material: "neutral", roof: "hip", levels: 1 },
  { key: "generic", label: "Room", kind: "room", material: "neutral", roof: "flat", levels: 1 },
  { key: "generic", label: "Road", kind: "road", material: "asphalt", width: 10 },
  { key: "paving", label: "Walkway", kind: "path", material: "paving", width: 4 },
  { key: "boundary_wall", label: "Boundary wall", kind: "path", material: "concrete", width: .6, height: 2.2 },
  { key: "tree_broadleaf", label: "Broadleaf tree", kind: "tree", material: "grass", width: 10, height: 12 },
  { key: "tree_palm", label: "Palm tree", kind: "tree", material: "grass", width: 9, height: 16 },
  { key: "tree_conifer", label: "Conifer tree", kind: "tree", material: "grass", width: 8, height: 14 },
  { key: "tree_columnar", label: "Slender tree", kind: "tree", material: "grass", width: 6, height: 13 },
  { key: "shrub", label: "Shrub", kind: "tree", material: "grass", width: 4, height: 2.2 },
  { key: "flower_bed", label: "Planted flower bed", kind: "surface", material: "grass" },
  { key: "grass", label: "Lawn", kind: "surface", material: "grass" },
  { key: "sports", label: "Sports ground", kind: "surface", material: "grass" },
  { key: "parking", label: "Parking area", kind: "surface", material: "asphalt" },
  { key: "water", label: "Water feature", kind: "surface", material: "water" },
  { key: "paving", label: "Courtyard", kind: "surface", material: "paving" },
  { key: "gate", label: "Entrance gate", kind: "fixture", material: "metal", width: 12, height: 7 },
  { key: "bench", label: "Bench", kind: "fixture", material: "wood", width: 5, height: 2 },
  { key: "lamp", label: "Lamp post", kind: "fixture", material: "metal", width: 2, height: 9 },
  { key: "water_point", label: "Drinking water point", kind: "fixture", material: "metal", width: 2.2, height: 1.4 },
  { key: "equipment", label: "Equipment cabinet", kind: "fixture", material: "metal", width: 2.4, height: 2 },
  ...SCENE_INDOOR_ASSETS.map(asset => ({...asset,kind:'fixture' as const})),
];

export const SCENE_MATERIALS = [
  { key: "neutral", label: "Warm stone" }, { key: "brick", label: "Brick" },
  { key: "concrete", label: "Concrete" }, { key: "glass", label: "Glass" },
  { key: "wood", label: "Wood" }, { key: "metal", label: "Metal" },
  { key: "grass", label: "Grass" }, { key: "sand", label: "Sand" },
  { key: "water", label: "Water" }, { key: "asphalt", label: "Asphalt" },
  { key: "paving", label: "Paving" },
] as const;

export const SCENE_ROOFS = [
  { key: "flat", label: "Flat roof" }, { key: "gable", label: "Gable roof" },
  { key: "hip", label: "Hip roof" },
] as const;

export interface SceneMaterialColors {
  roof: string; light: string; shade: string; edge: string; glass: string; mullion: string;
}

/** Architectural illustration colours stay recognisable in both application appearances. */
export const SCENE_MATERIAL_COLORS: Record<string, SceneMaterialColors> = {
  neutral: { roof: "#bac4bd", light: "#dcc9a4", shade: "#a99474", edge: "#eee4ce", glass: "#345966", mullion: "#dfdac9" },
  concrete: { roof: "#aabbb8", light: "#d4d8cf", shade: "#8c9e98", edge: "#e9ece2", glass: "#345b6b", mullion: "#dce5de" },
  brick: { roof: "#7d8984", light: "#bd7254", shade: "#854c3c", edge: "#d9b291", glass: "#294e5d", mullion: "#e2d3bb" },
  glass: { roof: "#92b2b6", light: "#6e9da5", shade: "#3c727f", edge: "#c5dad7", glass: "#255466", mullion: "#a9c7c9" },
  wood: { roof: "#9a7959", light: "#b18350", shade: "#795536", edge: "#d3b183", glass: "#335d62", mullion: "#d7c2a0" },
  metal: { roof: "#8da7ac", light: "#8ba7ab", shade: "#536f79", edge: "#d5e0dc", glass: "#254d5d", mullion: "#acc4c8" },
};

export function sceneMaterial(element: CampusSceneElement): SceneMaterialColors {
  return SCENE_MATERIAL_COLORS[element.material ?? "neutral"] ?? SCENE_MATERIAL_COLORS.neutral!;
}
