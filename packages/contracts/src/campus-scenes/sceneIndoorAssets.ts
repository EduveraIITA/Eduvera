import type { CampusSceneElement } from './types';

/** Reusable presentation presets. Furniture never creates an inventory holding. */
export const SCENE_INDOOR_ASSETS = [
  { key:'desk', label:'Work desk', material:'wood', width:1.6, depth:.8, height:.76 },
  { key:'chair', label:'Office chair', material:'metal', width:.56, depth:.6, height:.9 },
  { key:'computer', label:'Computer workstation', material:'metal', width:.7, depth:.48, height:.48 },
  { key:'meeting_table', label:'Meeting table', material:'wood', width:3.6, depth:1.4, height:.76 },
  { key:'cabinet', label:'Storage cabinet', material:'wood', width:1.2, depth:.5, height:1.8 },
  { key:'server_rack', label:'Server rack', material:'metal', width:.8, depth:1.1, height:2 },
  { key:'printer', label:'Printer', material:'metal', width:.65, depth:.6, height:.5 },
  { key:'fire_extinguisher', label:'Fire extinguisher', material:'metal', width:.35, depth:.3, height:.65 },
  { key:'first_aid', label:'First aid cabinet', material:'metal', width:.5, depth:.3, height:.5 },
  { key:'toilet', label:'Toilet', material:'concrete', width:.55, depth:.8, height:.75 },
  { key:'washbasin', label:'Washbasin', material:'concrete', width:.6, depth:.48, height:.8 },
  { key:'door', label:'Door and swing', material:'wood', width:1.1, depth:1.1, height:2.1 },
  { key:'window', label:'Window', material:'glass', width:2, depth:.18, height:1.4 },
  { key:'projector', label:'Projector', material:'metal', width:.42, depth:.3, height:.15 },
  { key:'whiteboard', label:'Whiteboard', material:'metal', width:2.4, depth:.15, height:1.2 },
] as const;
export type SceneIndoorAssetKey = typeof SCENE_INDOOR_ASSETS[number]['key'];
export function isSceneIndoorAssetKey(key: string | undefined): key is SceneIndoorAssetKey {
  return SCENE_INDOOR_ASSETS.some(asset => asset.key === key);
}
export function sceneIndoorDimensions(element: CampusSceneElement, unit = 1) {
  const preset = SCENE_INDOOR_ASSETS.find(asset => asset.key === element.asset_key);
  const width = element.width ?? (preset?.width ?? 2.4) * unit;
  return { width, depth: element.depth ?? width * (preset ? preset.depth / preset.width : .56), rotation: element.rotation_deg ?? 0 };
}
export function sceneIndoorDepth(element: CampusSceneElement, unit = 1) { return sceneIndoorDimensions(element, unit).depth; }
/** Exact rotated footprint reused by camera and hit-target framing. */
export function sceneIndoorFootprint(element: CampusSceneElement, unit = 1) {
  const center = element.geometry.points[0];
  if (!center) return [];
  const { width:w, depth:d, rotation } = sceneIndoorDimensions(element, unit), angle = rotation * Math.PI / 180;
  return [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([x=0,y=0]) => ({
    x:center.x+x*Math.cos(angle)-y*Math.sin(angle), y:center.y+x*Math.sin(angle)+y*Math.cos(angle),
  }));
}
