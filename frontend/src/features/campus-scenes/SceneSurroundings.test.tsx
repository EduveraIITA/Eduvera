import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneSurroundings, createSurroundingsLayout, sceneSurroundingsCoverage, surroundingsApproachCorridors, type SceneSurroundingsProps, type SceneSurroundingsApproach } from "./SceneSurroundings";
import { projectScenePoint, scenePointsAttribute, scenePresentationHeight } from "./sceneGeometry";
import { resolveSceneSunlight, sceneShadowOffset } from "./sceneSunlight";
import type { CampusScenePoint } from "./types";

const bounds = { width: 280, height: 225, unit: "metres" as const };
const props: SceneSurroundingsProps = { bounds, unit: 1, lighting: "day", mode: "2.5d", id: "example", visibleBounds: { x: -350, y: -200, width: 900, height: 700 } };
afterEach(cleanup);

// Separating-axis check for the convex clearance polygons returned by the layout.
function separated(a: readonly CampusScenePoint[], b: readonly CampusScenePoint[]) {
  return [a, b].some(polygon => polygon.some((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!, axis = { x: next.y - point.y, y: point.x - next.x };
    const first = a.map(p => p.x * axis.x + p.y * axis.y), second = b.map(p => p.x * axis.x + p.y * axis.y);
    return Math.max(...first) <= Math.min(...second) || Math.max(...second) <= Math.min(...first);
  }));
}

describe("illustrative campus surroundings", () => {
  it("reuses procedural scenery through small camera movements and expands coverage before a viewport edge can escape", () => {
    const seededMath = vi.spyOn(Math, "sin");
    const view = { x: -340, y: -195, width: 880, height: 680 };
    const { container, rerender } = render(<svg><SceneSurroundings {...props} visibleBounds={view} /></svg>);
    const forest = container.querySelector("[data-surroundings-forest]")!, initial = forest.innerHTML;
    const generationCalls = seededMath.mock.calls.length;
    expect(generationCalls).toBeGreaterThan(100);
    for (const delta of [.01, .1, .5, 1, 2]) {
      rerender(<svg><SceneSurroundings {...props} visibleBounds={{ ...view, x: view.x + delta, y: view.y + delta }} /></svg>);
      expect(seededMath.mock.calls.length).toBe(generationCalls);
      expect(forest.innerHTML).toBe(initial);
    }
    const moved = { ...view, x: -250, y: -110 };
    rerender(<svg><SceneSurroundings {...props} visibleBounds={moved} /></svg>);
    expect(seededMath.mock.calls.length).toBeGreaterThan(generationCalls);
    const mask = container.querySelector("mask")!;
    expect(Number(mask.getAttribute("x"))).toBeLessThanOrEqual(moved.x);
    expect(Number(mask.getAttribute("y"))).toBeLessThanOrEqual(moved.y);
    expect(Number(mask.getAttribute("x")) + Number(mask.getAttribute("width"))).toBeGreaterThanOrEqual(moved.x + moved.width);
    expect(Number(mask.getAttribute("y")) + Number(mask.getAttribute("height"))).toBeGreaterThanOrEqual(moved.y + moved.height);
  });
  it("covers the entire visible view at negative coordinates and after large pans, zooms or resizes", () => {
    for (const visible of [props.visibleBounds, { x: -71, y: -141, width: 22, height: 31 }, { x: 1234.5, y: -987.6, width: 7654, height: 4321 }, { x: -1e5, y: -2e5, width: 3e5, height: 4e5 }]) {
      const coverage = sceneSurroundingsCoverage(bounds, visible);
      expect(coverage.x).toBeLessThanOrEqual(visible.x);
      expect(coverage.y).toBeLessThanOrEqual(visible.y);
      expect(coverage.x + coverage.width).toBeGreaterThanOrEqual(visible.x + visible.width);
      expect(coverage.y + coverage.height).toBeGreaterThanOrEqual(visible.y + visible.height);
      expect(coverage.width - visible.width).toBeLessThanOrEqual(140);
      expect(coverage.height - visible.height).toBeLessThanOrEqual(140);
    }
  });
  it("keeps every visible canopy stable when a pan crosses a buffered tile boundary", () => {
    for (const view of [{ x: -350.01, y: -200, width: 900, height: 700 }, { x: -70.01, y: -100, width: 500, height: 600 }, { x: -140.01, y: -100, width: 600, height: 600 }]) {
      const moved = { ...view, x: view.x + .02 };
      const firstCoverage = sceneSurroundingsCoverage(bounds, view), nextCoverage = sceneSurroundingsCoverage(bounds, moved);
      expect(nextCoverage.x).not.toBe(firstCoverage.x);
      expect(nextCoverage.width).toBe(firstCoverage.width);
      expect(nextCoverage.height).toBe(firstCoverage.height);
      const first = createSurroundingsLayout(bounds, 1, firstCoverage), next = createSurroundingsLayout(bounds, 1, nextCoverage);
      const shared = [{ x: moved.x, y: view.y }, { x: view.x + view.width, y: view.y }, { x: view.x + view.width, y: view.y + view.height }, { x: moved.x, y: view.y + view.height }];
      const visibleTrees = (layout: typeof first) => new Map(layout.trees.filter(tree => !separated(tree.footprint, shared)).map(tree => [tree.id, `${tree.x}:${tree.y}:${tree.variant}:${tree.scale}`]));
      expect(visibleTrees(first).size).toBeGreaterThan(100);
      expect(visibleTrees(next)).toEqual(visibleTrees(first));
      expect(first.trees.length).toBeLessThanOrEqual(800);
      expect(next.trees.length).toBeLessThanOrEqual(800);
    }
  });
  it("strictly excludes the configured campus and never creates interactive or named places", () => {
    const { container } = render(<svg><SceneSurroundings {...props} /></svg>);
    expect(container.querySelector("[data-scene-surroundings]")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-scene-surroundings]")).toHaveAttribute("pointer-events", "none");
    expect(container.querySelector("[data-surroundings-campus-exclusion]")).toHaveAttribute("points", scenePointsAttribute([
      { x: 0, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 225 }, { x: 0, y: 225 },
    ].map(point => projectScenePoint(point))));
    expect(container.querySelector("[data-surroundings-campus-exclusion]")).toHaveAttribute("fill", "black");
    expect(container.querySelector("[data-scene-element], [role], [tabindex], title, text")).toBeNull();
    expect(container.querySelector("[data-surroundings-river]")).not.toBeNull();
    expect(container.querySelector("[data-surroundings-forest]")).not.toBeNull();
  });
  it("keeps forest variants stable across viewport changes and bounds SVG cost", () => {
    const { container, rerender } = render(<svg><SceneSurroundings {...props} /></svg>);
    const treeTransforms = () => new Map([...container.querySelectorAll("use")].map(node => [node.getAttribute("data-surroundings-tree") ?? "", `${node.getAttribute("transform")}/${node.getAttribute("data-tree-variant")}`]));
    const initial = treeTransforms();
    expect(container.querySelectorAll("use").length).toBeGreaterThan(100);
    expect(container.querySelectorAll("use").length).toBeLessThanOrEqual(800);
    expect(new Set([...container.querySelectorAll("use")].map(node => node.getAttribute("data-tree-variant"))).size).toBe(6);
    expect(container.querySelector("pattern, filter")).toBeNull();
    rerender(<svg><SceneSurroundings {...props} visibleBounds={{ ...props.visibleBounds, x: -310 }} /></svg>);
    const shifted = treeTransforms(), shared = [...initial.keys()].filter(id => shifted.has(id));
    expect(shared.length).toBeGreaterThan(100);
    shared.forEach(id => expect(shifted.get(id)).toBe(initial.get(id)));
    rerender(<svg><SceneSurroundings {...props} visibleBounds={{ x: -3000, y: -3000, width: 9000, height: 9000 }} /></svg>);
    expect(container.querySelectorAll("use").length).toBeLessThanOrEqual(800);
    expect(container.querySelectorAll("*").length).toBeLessThan(950);
    rerender(<svg><SceneSurroundings {...props} lighting="night" /></svg>);
    expect(treeTransforms()).toEqual(initial);
  });
  it("clears genuine exits without cutting the continuous river or clipping tree crowns", () => {
    const approaches: SceneSurroundingsApproach[] = [{ point: { x: 135, y: 220 }, width: 10, kind: "road" }, { point: { x: 264, y: 5 }, width: 6, kind: "gate" }, { point: { x: 12, y: 195 }, width: 9, kind: "road" }, { point: { x: 140, y: 110 }, width: 20, kind: "gate" }];
    const corridors = surroundingsApproachCorridors(bounds, 1, approaches);
    expect(corridors).toHaveLength(2);
    expect(corridors[0]?.every(point => point.y >= bounds.height)).toBe(true);
    expect(corridors[1]?.every(point => point.y <= 0)).toBe(true);
    const { container } = render(<svg><SceneSurroundings {...props} approaches={approaches} /></svg>);
    expect(container.querySelectorAll("mask polygon")).toHaveLength(1);
    expect(container.querySelector("[data-surroundings-river] mask")).toBeNull();
    const layout = createSurroundingsLayout(bounds, 1, props.visibleBounds, approaches);
    expect(layout.riverPoints).toHaveLength(161);
    expect(layout.riverPoints.every(point => point.x + layout.riverWidth * .84 < 0)).toBe(true);
    expect([...container.querySelectorAll("[data-surroundings-river] polyline")].every(node => node.getAttribute("points") === scenePointsAttribute(layout.riverPoints))).toBe(true);
    expect(layout.trees.length).toBeGreaterThan(100);
    layout.trees.forEach(tree => {
      expect(separated(tree.footprint, layout.site)).toBe(true);
      layout.corridors.forEach(corridor => expect(separated(tree.footprint, corridor)).toBe(true));
    });
    expect(surroundingsApproachCorridors(bounds, 1, Array.from({ length: 100 }, () => approaches[0]!))).toHaveLength(32);
  });
  it("moves ground shadows with sunlight while preserving forest placement and uses contact shade at night", () => {
    const morning = resolveSceneSunlight("day", 8), evening = resolveSceneSunlight("day", 16);
    const { container, rerender } = render(<svg><SceneSurroundings {...props} sunlight={morning} /></svg>);
    const placements = [...container.querySelectorAll("use")].map(node => node.getAttribute("transform"));
    const morningOffset = sceneShadowOffset(scenePresentationHeight(23), morning), eveningOffset = sceneShadowOffset(scenePresentationHeight(23), evening);
    expect(container.querySelector("[data-surroundings-cast-shadow]")).toHaveAttribute("transform", `translate(${morningOffset.x} ${morningOffset.y})`);
    rerender(<svg><SceneSurroundings {...props} sunlight={evening} /></svg>);
    expect(container.querySelector("[data-surroundings-cast-shadow]")).toHaveAttribute("transform", `translate(${eveningOffset.x} ${eveningOffset.y})`);
    expect(eveningOffset.x).toBeGreaterThan(0);
    expect(morningOffset.x).toBeLessThan(0);
    expect([...container.querySelectorAll("use")].map(node => node.getAttribute("transform"))).toEqual(placements);
    rerender(<svg><SceneSurroundings {...props} lighting="night" sunlight={resolveSceneSunlight("night", 21)} /></svg>);
    expect(container.querySelector("[data-surroundings-cast-shadow]")).toBeNull();
    expect(container.querySelector("defs ellipse")).not.toBeNull();
  });
  it("omits scenery in the flat plan so drawing and tracing remain precise", () => {
    const { container } = render(<svg><SceneSurroundings {...props} mode="2d" /></svg>);
    expect(container.querySelector("[data-scene-surroundings]")).toBeNull();
  });
  it("uses distinct definition IDs when two scenes appear together", () => {
    const { container } = render(<svg><SceneSurroundings {...props} id="first" /><SceneSurroundings {...props} id="second" /></svg>);
    const ids = [...container.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
