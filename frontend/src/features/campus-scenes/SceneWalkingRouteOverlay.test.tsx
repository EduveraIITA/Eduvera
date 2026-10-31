import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SceneWalkingRouteOverlay } from "./SceneWalkingRouteOverlay";
import { projectScenePoint } from "./sceneGeometry";
import type { SceneWalkingRoute } from "./sceneWalking";
afterEach(cleanup);
const route: SceneWalkingRoute = { status: "available", fromSpaceId: "gate", toSpaceId: "room", length: 10, unit: "metres", points: [{ x: 10, y: 20 }, { x: 10, y: 30 }], segments: [{ elementId: "outside", floorId: null, points: [{ x: 10, y: 20 }, { x: 10, y: 30 }] }] };
describe("walking route overlay", () => {
  it("shares the ground projection, labels the source and ignores pointer events", () => {
    const { container } = render(<svg><SceneWalkingRouteOverlay route={route} mode="2.5d" scale={2} /></svg>);
    const projected = projectScenePoint({ x: 10, y: 20 }, 0, "2.5d");
    const first = container.querySelector("polyline")!.getAttribute("points")!.split(" ")[0]!.split(",").map(Number);
    expect(first[0]).toBeCloseTo(projected.x, 2); expect(first[1]).toBeCloseTo(projected.y, 2);
    expect(screen.getByRole("img", { name: "Reviewed walking route" })).toHaveAttribute("pointer-events", "none");
    expect(container.textContent).toContain("not a tracked location");
  });
  it("never projects an outdoor route or destination onto an indoor floor", () => {
    const { container } = render(<svg><SceneWalkingRouteOverlay route={route} mode="2d" floorId="upper-floor" scale={1} /><SceneWalkingRouteOverlay route={route} mode="2d" floorId="upper-floor" scale={1} endpointsOnly /></svg>);
    expect(container.querySelector("[data-walking-route]")).toBeNull();
    expect(container.querySelector("[data-walking-route-destination]")).toBeNull();
  });
  it("marks chosen origin and exact arrival without adding a tracked position", () => {
    const { container } = render(<svg><SceneWalkingRouteOverlay route={route} mode="2d" scale={1} endpointsOnly /></svg>);
    expect(container.querySelector("[data-walking-route-start]")).toHaveAttribute("cx", "10");
    expect(container.querySelector("[data-walking-route-destination] circle")).toHaveAttribute("cy", "30");
    expect(container.textContent).toContain("not your tracked position");
  });
  it("shows only the matching indoor path and exact landing, with the arrival pin on its destination floor", () => {
    if (route.status !== "available") throw new Error("Expected available route");
    const upper = { elementId: "upper", floorId: "first", points: [{ x: 10, y: 30 }, { x: 20, y: 30 }] };
    const connected: SceneWalkingRoute = { ...route, segments: [...route.segments, upper], legs: [{ ...route.segments[0]!, kind: "walk" }, { kind: "lift", elementId: "lift", label: "East lift", fromFloorId: null, toFloorId: "first", point: { x: 10, y: 30 } }, { ...upper, kind: "walk" }] };
    const { container } = render(<svg><SceneWalkingRouteOverlay route={connected} mode="2d" floorId="first" scale={2} /><SceneWalkingRouteOverlay route={connected} mode="2d" floorId="first" scale={2} endpointsOnly /></svg>);
    expect(container.querySelector("[data-walking-route-segment='outside']")).toBeNull();
    expect(container.querySelector("[data-walking-route-segment='upper'] polyline")).toHaveAttribute("points", "10,30 20,30");
    expect(container.querySelector("[data-walking-route-connector='lift'] circle")).toHaveAttribute("cx", "10");
    expect(container.querySelector("[data-walking-route-destination] circle")).toHaveAttribute("cx", "20");
    expect(container.querySelector("[data-walking-route-start]")).toBeNull();
  });
});
