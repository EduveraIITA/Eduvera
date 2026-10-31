import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SceneRoomFloor } from "./SceneRoomFloor";
import type { CampusSceneElement } from "./types";

afterEach(cleanup);
const room: CampusSceneElement = { id: "seminar", kind: "room", label: "Seminar room", space_id: "room-place", floor_id: "first", parent_element_id: "building", review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 20, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 45 }, { x: 20, y: 45 }] } };

describe("authored room cutaway", () => {
  it("keeps floor, clipped tiles and perimeter in the exact recorded room polygon without inventing openings", () => {
    const original = structuredClone(room);
    const { container } = render(<svg><SceneRoomFloor element={room} unit={1} lighting="day" /></svg>);
    const polygons = container.querySelectorAll("polygon");
    expect(polygons).toHaveLength(3);
    for (const polygon of polygons) expect(polygon).toHaveAttribute("points", "20,30 40,30 40,45 20,45");
    expect(container.querySelector("[data-room-wall]")).toHaveAttribute("stroke-width", "0.25");
    expect(container.querySelector("[data-room-floor-tiles]")?.getAttribute("fill")).toMatch(/^url\(#room-tile-/);
    expect(container.querySelector("pattern")).toHaveAttribute("patternUnits", "userSpaceOnUse");
    expect(container.querySelector("[data-door], [data-window], image")).toBeNull();
    expect(room).toEqual(original);
  });
  it("changes floor and wall contrast at night while preserving authored geometry and unique tile references", () => {
    const { container, rerender } = render(<svg><SceneRoomFloor element={room} unit={2} lighting="day" /><SceneRoomFloor element={{ ...room, id: "second-room" }} unit={2} lighting="day" /></svg>);
    const day = container.querySelector("[data-room-floor] > polygon")?.getAttribute("fill");
    const ids = [...container.querySelectorAll("pattern")].map(pattern => pattern.id);
    expect(new Set(ids).size).toBe(2);
    rerender(<svg><SceneRoomFloor element={room} unit={2} lighting="night" /></svg>);
    expect(container.querySelector("[data-room-floor] > polygon")?.getAttribute("fill")).not.toBe(day);
    expect(container.querySelector("[data-room-wall]")).toHaveAttribute("stroke", "#b2bdc5");
    expect(container.querySelector("[data-room-wall]")).toHaveAttribute("stroke-width", "0.5");
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
  it("does not turn non-room or invalid geometry into a fabricated interior", () => {
    const { container, rerender } = render(<svg><SceneRoomFloor element={{ ...room, kind: "building" }} unit={1} lighting="day" /></svg>);
    expect(container.querySelector("[data-room-floor]")).toBeNull();
    rerender(<svg><SceneRoomFloor element={{ ...room, geometry: { type: "polygon", points: [{ x: Number.NaN, y: 0 }] } }} unit={1} lighting="day" /></svg>);
    expect(container.querySelector("[data-room-floor]")).toBeNull();
  });
});
