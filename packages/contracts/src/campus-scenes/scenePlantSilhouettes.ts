import type { CampusSceneElement } from "./types";
import { projectScenePoint, sceneElementHeight, sceneElementWidth, sceneProjectedHeight, type SceneViewMode } from "./sceneGeometry";

const organicCanopies = [
  "M -.51 .1 C -.56 -.06 -.44 -.25 -.28 -.29 C -.23 -.5 .04 -.53 .16 -.38 C .37 -.41 .52 -.22 .46 -.06 C .6 .13 .4 .36 .16 .35 C -.05 .49 -.36 .37 -.36 .27 C -.48 .28 -.56 .19 -.51 .1 Z",
  "M -.53 .09 C -.58 -.1 -.37 -.31 -.2 -.29 C -.1 -.46 .17 -.42 .23 -.28 C .45 -.29 .55 -.09 .49 .06 C .57 .24 .28 .4 .09 .34 C -.12 .42 -.36 .34 -.39 .22 C -.49 .24 -.57 .17 -.53 .09 Z",
  "M -.47 .13 C -.56 -.03 -.38 -.25 -.25 -.28 C -.31 -.47 -.02 -.54 .12 -.42 C .3 -.46 .48 -.3 .43 -.12 C .6 -.01 .49 .23 .33 .27 C .15 .43 -.12 .42 -.25 .31 C -.39 .36 -.53 .27 -.47 .13 Z",
] as const;

/** Shared drawing geometry; the editable plant remains one original scene object. */
export function scenePlantSilhouette(element: CampusSceneElement, mode: SceneViewMode, unit: number) {
  const location = element.geometry.points[0];
  if (!location) return null;
  const width = sceneElementWidth(element, unit), height = sceneElementHeight(element, unit), projectedHeight = sceneProjectedHeight(height);
  const ground = projectScenePoint(location, 0, mode), crown = projectScenePoint(location, mode === "2d" ? 0 : height * .72, mode);
  const seed = element.id.split("").reduce((value, char) => value * 31 + char.charCodeAt(0) >>> 0, 7);
  const frondRise = mode === "2d" ? width * .5 : Math.min(width * .5, projectedHeight * .23);
  const palmFronds = element.asset_key === "tree_palm" ? Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4, endX = crown.x + Math.cos(angle) * width * .6, endY = crown.y + Math.sin(angle) * frondRise * .72;
    return `M ${crown.x} ${crown.y} Q ${crown.x + Math.cos(angle + .25) * width * .3} ${crown.y + Math.sin(angle + .25) * frondRise - frondRise * .16} ${endX} ${endY} Q ${crown.x + Math.cos(angle - .25) * width * .25} ${crown.y + Math.sin(angle - .25) * frondRise * .4} ${crown.x} ${crown.y}`;
  }) : [];
  const coniferPlan = element.asset_key === "tree_conifer" && mode === "2d" ? Array.from({ length: 16 }, (_, index) => {
    const angle = index * Math.PI / 8, radius = width * (index % 2 ? .35 : .5);
    return { x: ground.x + Math.cos(angle) * radius, y: ground.y + Math.sin(angle) * radius };
  }) : [];
  const coniferTiers = element.asset_key === "tree_conifer" && mode === "2.5d" ? [.52, .37, .23].map((radius, index) => {
    const top = ground.y - projectedHeight * (index === 0 ? .78 : index === 1 ? .91 : 1), bottom = ground.y - projectedHeight * (.12 + index * .21), x = ground.x;
    return `M ${x} ${top} Q ${x - width * radius * .24} ${bottom - projectedHeight * .1} ${x - width * radius} ${bottom} Q ${x} ${bottom + projectedHeight * .07} ${x + width * radius} ${bottom} Q ${x + width * radius * .24} ${bottom - projectedHeight * .1} ${x} ${top}`;
  }) : [];
  const columnar = element.asset_key === "tree_columnar", shrub = element.asset_key === "shrub";
  const cx = ground.x, cy = mode === "2d" ? ground.y : ground.y - projectedHeight * (shrub ? .5 : columnar ? .53 : .55);
  const scaleX = width * (columnar ? .65 : 1), scaleY = mode === "2d" ? width * (columnar ? .75 : .85) : shrub ? Math.min(width * .65, projectedHeight * .94) : columnar ? projectedHeight * .88 : Math.min(width, projectedHeight * .84);
  return { width, height, projectedHeight, ground, crown, seed, palmFronds, coniferPlan, coniferTiers, columnar, shrub, cx, cy, scaleX, scaleY, organicPath: organicCanopies[seed % organicCanopies.length]! };
}
