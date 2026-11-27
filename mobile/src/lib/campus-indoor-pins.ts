import type { CampusSceneAsset, CampusSceneDocument, CampusSceneElement, CampusScenePoint } from '../../../packages/contracts/src/campus-scenes/types';
import { scenePolygonClearance, scenePolygonContains } from '../../../packages/contracts/src/campus-scenes/sceneEvidencePlacement';

const EPSILON = 0.00001;
const cross = (a: CampusScenePoint, b: CampusScenePoint) => a.x * b.y - a.y * b.x;
const sub = (a: CampusScenePoint, b: CampusScenePoint) => ({ x: a.x-b.x, y: a.y-b.y });
const valid = (point: CampusScenePoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
export function indoorContains(point: CampusScenePoint, polygon: readonly CampusScenePoint[]) {
  return valid(point) && polygon.length >= 3 &&
    (scenePolygonContains(point, polygon) || scenePolygonClearance(point, polygon) < EPSILON);
}

/** Test the intervals between building-boundary intersections, including concave cutouts. */
export function indoorRoomCorners(a: CampusScenePoint, b: CampusScenePoint, building: CampusSceneElement): CampusScenePoint[] {
  if (building.kind !== 'building' || building.geometry.type !== 'polygon' || !valid(a) || !valid(b)
      || Math.abs(a.x-b.x) < EPSILON || Math.abs(a.y-b.y) < EPSILON) {
    throw new Error('Tap two opposite corners to mark a room.');
  }
  const points = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  const shell = building.geometry.points;
  if (points.some(point => !indoorContains(point, shell))) throw new Error('Keep the whole room inside the selected building.');
  points.forEach((first, index) => {
    const delta = sub(points[(index+1)%points.length]!, first);
    const cuts = [0, 1];
    shell.forEach((start, i) => {
      const edge = sub(shell[(i+1)%shell.length]!, start), origin = sub(start, first);
      const determinant = cross(delta, edge);
      if (Math.abs(determinant) < EPSILON) return;
      const fraction = cross(origin, edge)/determinant, side = cross(origin, delta)/determinant;
      if (fraction > 0 && fraction < 1 && side >= 0 && side <= 1) cuts.push(fraction);
    });
    cuts.sort((left, right) => left-right);
    for (let i = 1; i < cuts.length; i++) {
      const middle = (cuts[i-1]!+cuts[i]!)/2;
      if (!indoorContains({x:first.x+delta.x*middle,y:first.y+delta.y*middle},shell)) {
        throw new Error('The room crosses an edge of the selected building.');
      }
    }
  });
  return points;
}

const knownAssets: readonly [RegExp, CampusSceneAsset][] = [
  [/\b(?:light|bulb|lamp)s?\b/iu,'lamp'], [/\b(?:bookcases?|bookshelf|bookshelves|shelf|shelves|cabinets?)\b/iu,'cabinet'],
  [/\b(?:desk|table)s?\b/iu,'desk'], [/\bchairs?\b/iu,'chair'], [/\bcomputers?\b/iu,'computer'],
  [/\bprojectors?\b/iu,'projector'], [/\bdoors?\b/iu,'door'], [/\bwindows?\b/iu,'window'],
];

export function indoorResourcePin(document: CampusSceneDocument, building: CampusSceneElement,
  floorId: string | null, room: CampusSceneElement, point: CampusScenePoint, label: string, id: string): CampusSceneElement {
  if (room.kind !== 'room' || room.floor_id !== floorId ||
      (room.parent_element_id !== building.id && !floorId) ||
      !indoorContains(point, building.geometry.points) || !indoorContains(point, room.geometry.points)
      || point.x < 0 || point.y < 0 || point.x > document.bounds.width || point.y > document.bounds.height) {
    throw new Error('Pin this item inside the selected room.');
  }
  const asset = knownAssets.find(([pattern]) => pattern.test(label))?.[1] ?? 'equipment';
  const width = Math.max(0.2, Math.min(1.5, Math.max(document.bounds.width,document.bounds.height)*0.007));
  return {
    id, label: label.trim().slice(0,160), kind:'fixture', asset_key:asset, floor_id:floorId, space_id:null,
    parent_element_id:room.id, geometry:{type:'point',points:[point]}, width, review_state:'needs_review',
  };
}
