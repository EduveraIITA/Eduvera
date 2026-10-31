import type { ScenePeopleMask, ScenePeopleOccluder } from "../../../../packages/contracts/src/campus-scenes/scenePeopleOcclusionGeometry";
export * from "../../../../packages/contracts/src/campus-scenes/scenePeopleOcclusionGeometry";

export interface ScenePeoplePreparedOccluder extends Omit<ScenePeopleOccluder, "masks"> {
  masks: readonly (Omit<ScenePeopleMask, "path"> & { path: Path2D })[];
}

export function prepareScenePeopleOccluders(occluders: readonly ScenePeopleOccluder[]): ScenePeoplePreparedOccluder[] {
  return occluders.map(occluder => ({ ...occluder, masks: occluder.masks.map(mask => ({ ...mask, path: new Path2D(mask.path) })) }));
}

export function eraseScenePeopleOccluder(context: CanvasRenderingContext2D, occluder: ScenePeoplePreparedOccluder) {
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.globalAlpha = 1;
  context.fillStyle = "#000";
  context.strokeStyle = "#000";
  for (const mask of occluder.masks) {
    context.save();
    if (mask.transform) { context.translate(mask.transform.x, mask.transform.y); context.scale(mask.transform.scaleX, mask.transform.scaleY); }
    if (mask.fill) context.fill(mask.path);
    else { context.lineWidth = mask.strokeWidth ?? 1; context.stroke(mask.path); }
    context.restore();
  }
  context.restore();
}
