import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SceneAssetDrawing, SceneElementShadow } from "./SceneAssetDrawing";
import { projectScenePoint, sceneElementHeight, sceneElementWidth } from "./sceneGeometry";
import { resolveSceneSunlight } from "./sceneSunlight";
import type { CampusSceneElement } from "./types";

afterEach(cleanup);
const tree: CampusSceneElement = { id:"plant",label:"Plant",kind:"tree",geometry:{type:"point",points:[{x:20,y:30}]},space_id:null,floor_id:null,review_state:"reviewed" };
describe("editable campus asset variants", () => {
  it("does not recalculate unchanged asset geometry and shadows when only their camera parent changes", () => {
    const geometry = tree.geometry, readGeometry = vi.fn(() => geometry);
    const element: CampusSceneElement = { ...tree, asset_key: "tree_conifer", width: 5, height: 9 };
    Object.defineProperty(element, "geometry", { get: readGeometry });
    const view = (camera: string, item = element) => <svg><g transform={camera}><SceneAssetDrawing element={item} mode="2.5d" unit={1}/><SceneElementShadow element={item} unit={1}/></g></svg>;
    const { container, rerender } = render(view("translate(0 0)"));
    const initial = container.querySelector("g")!.innerHTML, calculations = readGeometry.mock.calls.length;
    expect(calculations).toBeGreaterThan(0);
    rerender(view("translate(40 80) scale(2)"));
    expect(readGeometry.mock.calls.length).toBe(calculations);
    expect(container.querySelector("g")!.innerHTML).toBe(initial);
    rerender(view("translate(40 80) scale(2)", { ...element, geometry: { ...geometry, points: [{ x: 80, y: 70 }] } }));
    expect(container.querySelector("g")!.innerHTML).not.toBe(initial);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
  it("renders distinct selectable plant silhouettes while preserving their base and explicit sizes", () => {
    for (const key of ["tree_broadleaf","tree_columnar","tree_conifer","shrub"] as const) {
      const element = {...tree,asset_key:key,width:5,height:9}, original = structuredClone(element);
      const {container,unmount}=render(<svg><SceneAssetDrawing element={element} mode="2.5d" unit={1}/></svg>);
      expect(container.querySelector("[data-tree-silhouette]")?.getAttribute("data-tree-silhouette")).toContain(key === "tree_broadleaf" ? "broadleaf" : key.replace("tree_",""));
      expect(sceneElementWidth(element)).toBe(5); expect(sceneElementHeight(element)).toBe(9);
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/); expect(element).toEqual(original); unmount();
    }
    expect(sceneElementHeight({...tree,asset_key:"shrub"})).toBeLessThan(sceneElementHeight({...tree,asset_key:"tree_columnar"}));
  });
  it("clips flower details to the chosen polygon instead of growing geometry outside it", () => {
    const element:CampusSceneElement={...tree,kind:"surface",asset_key:"flower_bed",geometry:{type:"polygon",points:[{x:0,y:0},{x:30,y:0},{x:15,y:12}]}};
    const {container}=render(<svg><SceneAssetDrawing element={element} mode="2.5d" unit={1}/></svg>);
    expect(container.querySelector("clipPath polygon")).toHaveAttribute("points","0,0 30,0 15,12");
    expect(container.querySelector("g[clip-path] circle")).not.toBeNull();
  });
  it("varies illustrative lit and dark windows deterministically without mutating the building", () => {
    const element:CampusSceneElement={...tree,kind:"building",levels:3,geometry:{type:"polygon",points:[{x:0,y:0},{x:40,y:0},{x:40,y:30},{x:0,y:30}]}};
    const {container}=render(<svg><SceneAssetDrawing element={element} mode="2.5d" lighting="night" unit={1}/></svg>);
    const fills=Array.from(container.querySelectorAll('[data-illustrative-window="night"]')).map(window=>window.getAttribute("fill"));
    expect(fills.some(fill=>fill?.startsWith("url("))).toBe(true); expect(fills.some(fill=>fill?.startsWith("#"))).toBe(true);
  });

  it("projects an explicit tree height through the same camera as a building height", () => {
    const element = {...tree,asset_key:"tree_conifer" as const,height:9,width:5};
    const {container}=render(<svg><SceneAssetDrawing element={element} mode="2.5d" unit={1}/></svg>);
    const top = projectScenePoint(element.geometry.points[0]!,element.height);
    const paths = Array.from(container.querySelectorAll('[data-tree-silhouette="conifer"] path')).map(path=>path.getAttribute("d")!);
    expect(paths.some(path=>path.startsWith(`M ${top.x} ${top.y} `))).toBe(true);
  });

  it("casts opposite morning and evening ground shadows, shorter at noon, with only contact shadows at night", () => {
    const element:CampusSceneElement={...tree,kind:"building",height:10,geometry:{type:"polygon",points:[{x:20,y:20},{x:50,y:20},{x:50,y:40},{x:20,y:40}]}};
    const original=structuredClone(element);
    const {container,rerender}=render(<svg><SceneElementShadow element={element} unit={1} sunlight={resolveSceneSunlight("day",8)}/></svg>);
    const castOffset = () => {
      const points = container.querySelector('[data-scene-shadow="sun"] polygon')!.getAttribute("points")!;
      const [x=0,y=0]=points.split(" ")[0]!.split(",").map(Number);
      return {x:x-20,y:y-20};
    };
    const morning=castOffset(); expect(morning.x).toBeLessThan(0);
    rerender(<svg><SceneElementShadow element={element} unit={1} sunlight={resolveSceneSunlight("day",16)}/></svg>);
    const evening=castOffset(); expect(evening.x).toBeGreaterThan(0);
    rerender(<svg><SceneElementShadow element={element} unit={1} sunlight={resolveSceneSunlight("day",12)}/></svg>);
    const noon=castOffset(); expect(Math.hypot(noon.x,noon.y)).toBeLessThan(Math.hypot(morning.x,morning.y));
    rerender(<svg><SceneElementShadow element={element} unit={1} sunlight={resolveSceneSunlight("night",23)}/></svg>);
    expect(container.querySelector('[data-scene-shadow="sun"]')).toBeNull();
    expect(container.querySelector('[data-scene-shadow="contact"]')).toHaveAttribute("points","20,20 50,20 50,40 20,40");
    expect(element).toEqual(original);
  });

  it("changes facade illumination with the incoming sun while leaving its geometry fixed", () => {
    const element:CampusSceneElement={...tree,kind:"building",height:10,geometry:{type:"polygon",points:[{x:20,y:20},{x:50,y:30},{x:40,y:50},{x:10,y:40}]}};
    const {container,rerender}=render(<svg><SceneAssetDrawing element={element} mode="2.5d" unit={1} sunlight={resolveSceneSunlight("day",8)}/></svg>);
    const faces=()=>Array.from(container.querySelectorAll("[data-building-facade]")).map(face=>({points:face.getAttribute("points"),fill:face.getAttribute("fill")}));
    const morning=faces();
    rerender(<svg><SceneAssetDrawing element={element} mode="2.5d" unit={1} sunlight={resolveSceneSunlight("day",16)}/></svg>);
    const evening=faces();
    expect(evening.map(face=>face.points)).toEqual(morning.map(face=>face.points));
    expect(evening.map(face=>face.fill)).not.toEqual(morning.map(face=>face.fill));
  });

  it("keeps a reported unavailable lamp unlit at night while other illustrative lamps glow",()=>{
    const element:CampusSceneElement={...tree,kind:"fixture",asset_key:"lamp",width:1.8,height:7};
    const {container,rerender}=render(<svg><SceneAssetDrawing element={element} mode="2.5d" lighting="night" unit={1}/></svg>);
    expect(container.querySelector("[data-illustrative-lamp-glow]")).not.toBeNull();
    rerender(<svg><SceneAssetDrawing element={element} mode="2.5d" lighting="night" unit={1} unavailable/></svg>);
    expect(container.querySelector("[data-illustrative-lamp-glow]")).toBeNull();
    expect(container.querySelector('[data-lamp-bulb="unavailable"]')).not.toBeNull();
  });

  it("gives a sports template two goals in perspective and a clear flat plan without changing its footprint",()=>{
    const element:CampusSceneElement={...tree,kind:"surface",asset_key:"sports",geometry:{type:"polygon",points:[{x:10,y:10},{x:65,y:10},{x:65,y:96},{x:10,y:96}]}};
    const original=structuredClone(element);
    const {container,rerender}=render(<svg><SceneAssetDrawing element={element} mode="2.5d" unit={1}/></svg>);
    expect(container.querySelectorAll("[data-sports-goal]")).toHaveLength(2);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    rerender(<svg><SceneAssetDrawing element={element} mode="2d" unit={1}/></svg>);
    expect(container.querySelector("[data-sports-goals]")).toBeNull();
    expect(element).toEqual(original);
  });
});
