import { describe, expect, it } from "vitest";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import { SCENE_HEIGHT_EXAGGERATION, SCENE_PLANE_TRANSFORM, SCENE_VERTICAL_SCALE, clampSceneViewport, constrainSceneTranslation, fitSceneViewport, projectScenePoint, sceneBuildingFaces, sceneElementHeight, scenePaintOrder, scenePresentationHeight, sceneProjectedHeight, sceneRenderBounds, sceneRoofFaces, sceneUnitScale, sceneVisibleElements, unprojectScenePoint, zoomSceneViewport } from "./sceneGeometry";

const rectangle = [{ x: 20, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 50 }, { x: 20, y: 50 }];
const building: CampusSceneElement = { id: "learning", kind: "building", label: "Learning building", geometry: { type: "polygon", points: rectangle }, space_id: null, floor_id: null, levels: 3, review_state: "needs_review" };
const scene: CampusSceneDocument = { schema_version: 1, name: "Test campus", bounds: { width: 160, height: 120, unit: "metres" }, source: { kind: "manual", label: "Reviewed plan" }, elements: [building] };

describe("programmable campus geometry", () => {
  it("round trips arbitrary plan coordinates through both projections", () => {
    for (const mode of ["2d", "2.5d"] as const) for (const point of [{ x: 0, y: 0 }, { x: 47.5, y: 19.25 }, { x: 160, y: 120 }]) {
      const result = unprojectScenePoint(projectScenePoint(point, 0, mode), mode);
      expect(result.x).toBeCloseTo(point.x); expect(result.y).toBeCloseTo(point.y);
    }
  });

  it("changes elevation without changing a place's planar position", () => {
    const ground = projectScenePoint({ x: 40, y: 32 }), roof = projectScenePoint({ x: 40, y: 32 }, 12);
    expect(roof.x).toBe(ground.x); expect(roof.y).toBeCloseTo(ground.y - sceneProjectedHeight(12));
    expect(projectScenePoint({ x: 40, y: 32 }, 12, "2d")).toEqual({ x: 40, y: 32 });
  });

  it("uses a straight-front elevated camera and one shared ground projection", () => {
    const left = projectScenePoint({x:0,y:120}), right = projectScenePoint({x:160,y:120});
    expect(right.y).toBe(left.y);
    expect(projectScenePoint({x:40,y:0}).x).toBe(projectScenePoint({x:40,y:120}).x);
    const matrix = SCENE_PLANE_TRANSFORM.match(/[-.\d]+/g)!.map(Number);
    const [a,b,c,d,e,f] = matrix as [number,number,number,number,number,number];
    const point = {x:47.5,y:82.25};
    expect(a*a+c*c).toBeCloseTo(1);
    expect(b*b+d*d+(SCENE_VERTICAL_SCALE/SCENE_HEIGHT_EXAGGERATION)**2).toBeCloseTo(1);
    expect(a*b+c*d).toBeCloseTo(0);
    const actual = projectScenePoint(point);
    expect(a*point.x+c*point.y+e).toBeCloseTo(actual.x);
    expect(b*point.x+d*point.y+f).toBeCloseTo(actual.y);
    const walls = sceneBuildingFaces(rectangle,12).map(face => face.edge);
    expect(walls).toContainEqual([rectangle[2],rectangle[3]]);
    expect(walls).toHaveLength(1);
  });

  it("shows the same visible walls for either polygon winding", () => {
    const forward = sceneBuildingFaces(rectangle, 12), reversed = sceneBuildingFaces([...rectangle].reverse(), 12);
    const walls = (faces: typeof forward) => faces.map((face) => face.edge.map((point) => `${point.x}:${point.y}`).sort().join("|")).sort();
    expect(forward).toHaveLength(1); expect(walls(reversed)).toEqual(walls(forward));
    for (const face of forward) expect(face.points[2]!.y).toBeCloseTo(face.points[1]!.y - sceneProjectedHeight(12));
  });

  it("retains concave courtyards instead of replacing their footprint with a box", () => {
    const courtyard = [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 60 }, { x: 50, y: 60 }, { x: 50, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 60 }, { x: 0, y: 60 }];
    const roof = sceneRoofFaces(courtyard, 12, "flat");
    expect(roof).toHaveLength(1); expect(roof[0]).toHaveLength(8);
    expect(roof[0]![4]).toEqual(projectScenePoint({ x: 50, y: 20 }, 12));
    expect(sceneBuildingFaces(courtyard, 12).length).toBe(3);
  });

  it("uses a gable or hip on a convex four-corner wing and a safe flat compound roof", () => {
    expect(sceneRoofFaces(rectangle, 12, "gable")).toHaveLength(4);
    expect(sceneRoofFaces(rectangle, 12, "hip")).toHaveLength(4);
    expect(sceneRoofFaces([...rectangle, { x: 30, y: 35 }], 12, "gable")).toHaveLength(1);
  });

  it("respects explicit height and scales derived floors only in relative scenes", () => {
    expect(sceneElementHeight({ ...building, height: 21 }, 4)).toBe(21);
    expect(sceneElementHeight(building, 1)).toBeCloseTo(10.8);
    expect(scenePresentationHeight(sceneElementHeight(building,1))).toBeCloseTo(17.28);
    expect(sceneUnitScale({ bounds: { width: 1000, height: 800, unit: "relative" } })).toBe(4);
    expect(sceneUnitScale(scene)).toBe(1);
  });

  it("includes high buildings in the fitted world rather than cutting roofs off", () => {
    const tall = { ...building, geometry: { type: "polygon" as const, points: [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 15 }, { x: 0, y: 15 }] }, height: 90 };
    const bounds = sceneRenderBounds({ ...scene, elements: [tall] }, "2.5d");
    expect(bounds.y).toBeLessThan(projectScenePoint({x:0,y:0},90).y);
    expect(bounds.y + bounds.height).toBeGreaterThan(projectScenePoint({x:scene.bounds.width,y:scene.bounds.height}).y);
  });

  it("keeps all translated vertices inside the configured site", () => {
    expect(constrainSceneTranslation(building, { x: -100, y: 200 }, scene.bounds)).toEqual({ x: -20, y: 70 });
    expect(constrainSceneTranslation(building, { x: 10, y: -5 }, scene.bounds)).toEqual({ x: 10, y: -5 });
  });

  it("draws surfaces, routes, then raised assets in deterministic near-to-far order", () => {
    const road: CampusSceneElement = { ...building, id: "road", kind: "road", geometry: { type: "polyline", points: rectangle.slice(0, 2) } };
    const grass = { ...building, id: "grass", kind: "surface" as const };
    const front = { ...building, id: "front", geometry: { type: "polygon" as const, points: rectangle.map((point) => ({ x: point.x + 50, y: point.y + 50 })) } };
    expect(scenePaintOrder([front, road, building, grass]).map((element) => element.id)).toEqual(["grass", "road", "learning", "front"]);
  });

  it("separates exact floor interiors from outdoor buildings and landscape", () => {
    const room = { ...building, id: "room", kind: "room" as const, floor_id: "floor-1" };
    const otherRoom = { ...room, id: "other-room", floor_id: "floor-2" };
    const tree = { ...building, id: "tree", kind: "tree" as const };
    const corridor = { ...building, id: "corridor", kind: "path" as const, floor_id: "floor-1" };
    const lift = { ...building, id: "lift", kind: "fixture" as const, floor_id: "floor-2" };
    const elements = [building, room, otherRoom, tree, corridor, lift];
    expect(sceneVisibleElements(elements).map((element) => element.id)).toEqual(["learning", "tree"]);
    expect(sceneVisibleElements(elements, "floor-1").map((element) => element.id)).toEqual(["room", "corridor"]);
    expect(sceneVisibleElements(elements, "floor-2").map((element) => element.id)).toEqual(["other-room", "lift"]);
    expect(sceneVisibleElements(elements, null, true)).toEqual(elements);
  });
});

describe("finite scene navigation", () => {
  const size = { width: 390, height: 640 }, bounds = { x: -100, y: -40, width: 400, height: 300 };
  it("centres the full campus on a narrow phone", () => {
    const fit = fitSceneViewport(size, bounds);
    expect(fit.x + (bounds.x + bounds.width / 2) * fit.scale).toBeCloseTo(size.width / 2);
    expect(fit.y + (bounds.y + bounds.height / 2) * fit.scale).toBeCloseTo(size.height / 2);
  });
  it("prevents the campus being lost after an extreme pan or zoom", () => {
    const fit = fitSceneViewport(size, bounds), result = clampSceneViewport({ x: -99999, y: 99999, scale: fit.scale * 1000 }, size, bounds);
    expect(result.scale).toBeCloseTo(fit.scale * 8);
    expect(result.x + (bounds.x + bounds.width) * result.scale).toBeGreaterThanOrEqual(size.width - 24);
    expect(result.y + bounds.y * result.scale).toBeLessThanOrEqual(24);
    expect(clampSceneViewport({ x: 999, y: 999, scale: 0 }, size, bounds).scale).toBe(fit.scale);
  });
  it("keeps a zoom focal point fixed whenever pan bounds permit it", () => {
    const fit = fitSceneViewport(size, bounds), focal = { x: size.width / 2, y: size.height / 2 };
    const next = zoomSceneViewport(fit, focal, 3, size, bounds);
    expect((focal.x - next.x) / next.scale).toBeCloseTo((focal.x - fit.x) / fit.scale);
    expect((focal.y - next.y) / next.scale).toBeCloseTo((focal.y - fit.y) / fit.scale);
  });
  it("keeps a small site centred even after attempted dragging", () => {
    const fit = fitSceneViewport(size, bounds), result = clampSceneViewport({ ...fit, y: -10000 }, size, bounds);
    expect(result.y).toBeCloseTo(fit.y);
  });
});
