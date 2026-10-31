import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CampusSceneCanvas } from "./CampusSceneCanvas";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import { fitSceneViewport, sceneRenderBounds } from "./sceneGeometry";
import type {SceneEvidenceMarker} from "./sceneOperations.types";
import type { SceneWalkingRoute } from "./sceneWalking";
import type { ScenePeopleCompiled } from "./scenePeopleTracks.types";
import "./campus-scene-place-review.css";
import "./campus-scene-editor.css";

const scene: CampusSceneDocument = {
  schema_version: 1, name: "North campus", bounds: { width: 160, height: 120, unit: "metres" },
  source: { kind: "manual", label: "Reviewed campus drawing" },
  elements: [{ id: "learning", kind: "building", label: "Learning building", geometry: { type: "polygon", points: [{ x: 20, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 50 }, { x: 20, y: 50 }] }, space_id: null, floor_id: null, levels: 3, review_state: "reviewed" }],
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function preparePointerSurface(svg: SVGSVGElement) {
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
  Object.defineProperties(svg, { setPointerCapture: { value: vi.fn() }, hasPointerCapture: { value: () => true }, releasePointerCapture: { value: vi.fn() } });
}
function pointer(target: Element, type: string, x: number, y: number, pointerId = 1, pointerType = "mouse") {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: pointerType } });
  fireEvent(target, event);
}

describe("CampusSceneCanvas", () => {
  it("composes one non-interactive people canvas outside the editable world and withdraws it with its source", () => {
    const people: ScenePeopleCompiled = { contextKey: "school:campus:live:v1", scope: { worldKey: "school:campus:live", publicationKey: "v1", networkKey: "paths" }, asOf: 1000, tracks: [], points: [], unmapped: 0, unavailableRoutes: 0, conflicting: 0, sourceLimited: false };
    const clock = { instant: 1000, live: true, running: true, epoch: "live" };
    const { container, rerender } = render(<CampusSceneCanvas scene={scene} mode="2.5d" people={people} peopleClock={clock} onSelectElement={vi.fn()} />);
    expect(screen.getByText("Planned activity")).toBeVisible();
    const layer = container.querySelector("[data-people-layer]")!, host = layer.parentElement!;
    expect(host.tagName.toLowerCase()).toBe("foreignobject"); expect(host).toHaveAttribute("pointer-events", "none");
    expect(host.parentElement).toBe(container.querySelector("svg.campus-scene-svg"));
    const building = screen.getByRole("button", { name: "Learning building, building, 3 floors" });
    rerender(<CampusSceneCanvas scene={scene} mode="2.5d" people={{ ...people, asOf: 2000 }} peopleClock={{ ...clock, instant: 2000 }} onSelectElement={vi.fn()} />);
    expect(container.querySelector("[data-people-layer]")).toBe(layer); expect(screen.getByRole("button", { name: "Learning building, building, 3 floors" })).toBe(building);
    rerender(<CampusSceneCanvas scene={scene} mode="2.5d" onSelectElement={vi.fn()} />);
    expect(container.querySelector("[data-people-layer]")).toBeNull(); expect(building).toBeInTheDocument();
  });
  it("selects a published building only after a tap and never while panning across it", () => {
    const select = vi.fn();
    const { container } = render(<CampusSceneCanvas scene={scene} mode="2.5d" onSelectElement={select}/>);
    const svg = container.querySelector<SVGSVGElement>("svg.campus-scene-svg")!; preparePointerSurface(svg);
    const building = screen.getByRole("button", { name: "Learning building, building, 3 floors" });
    pointer(building, "pointerdown", 400, 300); expect(select).not.toHaveBeenCalled();
    pointer(svg, "pointermove", 450, 350); pointer(svg, "pointerup", 450, 350); expect(select).not.toHaveBeenCalled();
    pointer(building, "pointerdown", 400, 300); pointer(svg, "pointermove", 402, 301); pointer(svg, "pointerup", 402, 301);
    expect(select).toHaveBeenCalledExactlyOnceWith("learning");
    pointer(building, "pointerdown", 400, 300); pointer(svg, "pointercancel", 400, 300);
    expect(select).toHaveBeenCalledTimes(1);
    pointer(building, "pointerdown", 400, 300); pointer(svg, "pointerup", 450, 350);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("coalesces wheel input to one frame, retains every delta and cancels pending work on unmount", () => {
    const callbacks = new Map<number, FrameRequestCallback>(); let sequence = 0;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { callbacks.set(++sequence, callback); return sequence; }));
    const cancel = vi.fn((id: number) => callbacks.delete(id)); vi.stubGlobal("cancelAnimationFrame", cancel);
    const { container, unmount } = render(<CampusSceneCanvas scene={scene} mode="2.5d" onSelectElement={vi.fn()}/>);
    const svg = container.querySelector<SVGSVGElement>("svg.campus-scene-svg")!; preparePointerSurface(svg);
    const camera = () => container.querySelector('svg.campus-scene-svg > g[transform]')!.getAttribute("transform"); const initial = camera();
    for (let i = 0; i < 3; i++) fireEvent(svg, new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -10, clientX: 400, clientY: 300 }));
    expect(callbacks.size).toBe(1); expect(camera()).toBe(initial);
    act(() => { const [id, callback] = [...callbacks.entries()][0]!; callbacks.delete(id); callback(16); });
    const initialScale = Number(initial!.match(/scale\(([^)]+)\)/u)![1]);
    expect(Number(camera()!.match(/scale\(([^)]+)\)/u)![1])).toBeCloseTo(initialScale * Math.exp(.24));
    expect(callbacks.size).toBe(0);
    fireEvent(svg, new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -10, clientX: 400, clientY: 300 }));
    unmount(); expect(callbacks.size).toBe(0); expect(cancel).toHaveBeenCalled();
  });

  it("starts pinch zoom from the second touch and continues panning with the remaining finger", () => {
    const select = vi.fn();
    const { container } = render(<CampusSceneCanvas scene={scene} mode="2.5d" onSelectElement={select}/>);
    const svg = container.querySelector<SVGSVGElement>("svg.campus-scene-svg")!; preparePointerSurface(svg);
    const camera = () => container.querySelector('svg.campus-scene-svg > g[transform]')!.getAttribute("transform"); const initial = camera();
    const building = screen.getByRole("button", { name: "Learning building, building, 3 floors" });
    pointer(building, "pointerdown", 300, 300, 1, "touch"); pointer(svg, "pointerdown", 500, 300, 2, "touch");
    pointer(svg, "pointermove", 600, 300, 2, "touch"); pointer(svg, "pointerup", 600, 300, 2, "touch");
    const pinched = camera(); expect(pinched).not.toBe(initial);
    pointer(svg, "pointermove", 340, 330, 1, "touch"); pointer(svg, "pointerup", 340, 330, 1, "touch");
    expect(camera()).not.toBe(pinched); expect(select).not.toHaveBeenCalled();
  });
  it("keeps the real review preview compact inside the taller editor without constraining the main canvas", () => {
    render(<div className="campus-scene-editor"><div className="campus-scene-stage"><CampusSceneCanvas scene={scene} mode="2d" onSelectElement={vi.fn()}/></div><figure className="scene-place-review__preview"><CampusSceneCanvas className="scene-place-review__canvas" scene={scene} mode="2d" onSelectElement={vi.fn()}/></figure></div>);
    const [main, preview] = screen.getAllByTestId("campus-scene-canvas");
    expect(getComputedStyle(preview!).height).toBe("240px");
    expect(getComputedStyle(preview!).minHeight).toBe("0");
    expect(getComputedStyle(preview!).maxHeight).toBe("240px");
    expect(getComputedStyle(preview!.querySelector(".campus-scene-svg")!).minHeight).toBe("0");
    expect(getComputedStyle(main!).height).not.toBe("240px");
    expect(screen.getAllByRole("button", { name: "Zoom in" })).toHaveLength(2);
  });
  it("highlights every reviewed proposal outline without adding evidence or movement", () => {
    const document = { ...scene, elements: [scene.elements[0]!, { ...scene.elements[0]!, id: "annex", label: "Annex" }] };
    const { container } = render(<CampusSceneCanvas scene={document} mode="2d" selectedElementId="learning" highlightedElementIds={["learning", "annex"]} onSelectElement={vi.fn()}/>);
    expect(screen.getByRole("button", { name: "Learning building, building, 3 floors" })).toHaveAttribute("aria-pressed", "true"); expect(screen.getByRole("button", { name: "Annex, building, 3 floors" })).toHaveAttribute("aria-pressed", "true"); expect(container.querySelector('[data-scene-group-highlight="annex"]')).not.toBeNull(); expect(container.querySelector("[data-scene-vertex]")).toBeNull();
  });
  it("automatically frames a read-only outdoor route once and offers a keyboard-accessible Fit route control", () => {
    const document = { ...scene, bounds: { ...scene.bounds, width: 1000, height: 800 }, elements: [{ ...scene.elements[0]!, space_id: "building", geometry: { ...scene.elements[0]!.geometry, points: [{ x: 400, y: 300 }, { x: 480, y: 300 }, { x: 480, y: 360 }, { x: 400, y: 360 }] } }] };
    const route: SceneWalkingRoute = { status: "available", fromSpaceId: "gate", toSpaceId: "building", length: 100, unit: "metres", points: [{ x: 420, y: 420 }, { x: 440, y: 360 }], segments: [{ elementId: "walk", floorId: null, points: [{ x: 420, y: 420 }, { x: 440, y: 360 }] }] };
    const { container, rerender } = render(<CampusSceneCanvas scene={document} mode="2.5d" walkingRoute={route} onSelectElement={vi.fn()} />);
    const camera = () => container.querySelector('svg.campus-scene-svg > g[transform]')!.getAttribute("transform");
    const focused = camera();
    expect(screen.getByRole("button", { name: "Fit route" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" })); const manual = camera(); expect(manual).not.toBe(focused);
    rerender(<CampusSceneCanvas scene={structuredClone(document)} mode="2.5d" lighting="night" walkingRoute={structuredClone(route)} onSelectElement={vi.fn()} />);
    expect(camera()).toBe(manual);
    fireEvent.click(screen.getByRole("button", { name: "Fit route" })); expect(camera()).toBe(focused);
    fireEvent.click(screen.getByRole("button", { name: "Fit campus" })); const whole = camera(); expect(whole).not.toBe(focused);
    rerender(<CampusSceneCanvas scene={document} mode="2.5d" walkingRoute={structuredClone(route)} onSelectElement={vi.fn()} />); expect(camera()).toBe(whole);
    rerender(<CampusSceneCanvas scene={document} mode="2d" walkingRoute={route} onSelectElement={vi.fn()} />); expect(camera()).not.toBe(whole);
    rerender(<CampusSceneCanvas scene={document} mode="2d" walkingRoute={route} onSelectElement={vi.fn()} onMoveElement={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Fit route" })).not.toBeInTheDocument();
    rerender(<CampusSceneCanvas scene={document} mode="2d" floorId="upper" walkingRoute={route} onSelectElement={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Fit route" })).not.toBeInTheDocument();
  });
  it("offers keyboard place selection and named viewport controls without asserting live presence", () => {
    const select = vi.fn();
    const { container } = render(<CampusSceneCanvas scene={scene} mode="2.5d" onSelectElement={select} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Learning building, building, 3 floors" }), { key: "Enter" });
    expect(select).toHaveBeenCalledWith("learning");
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Fit campus" })).toBeVisible();
    expect(container.textContent).not.toMatch(/present now|live location|occupied/iu);
  });

  it("keeps names accessible without covering the scene and floats only the selected name", () => {
    const select = vi.fn();
    const { container, rerender } = render(<CampusSceneCanvas scene={scene} mode="2.5d" onSelectElement={select} />);
    expect(container.querySelector("[data-scene-label]")).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Learning building, building, 3 floors" }), { key: "Enter" });
    expect(select).toHaveBeenLastCalledWith("learning");
    rerender(<CampusSceneCanvas scene={scene} mode="2.5d" selectedElementId="learning" onSelectElement={select} />);
    expect(container.querySelectorAll('[data-scene-label="learning"]')).toHaveLength(1);
    expect(container.querySelector('[data-scene-label="learning"]')).toHaveTextContent("Learning building");
    expect(screen.getAllByRole("button", { name: "Learning building, building, 3 floors" })).toHaveLength(1);
  });

  it("moves a focused editable object by a bounded keyboard step", () => {
    const move = vi.fn();
    render(<CampusSceneCanvas scene={scene} mode="2d" onSelectElement={vi.fn()} onMoveElement={move} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Learning building, building, 3 floors" }), { key: "ArrowRight", shiftKey: true });
    expect(move).toHaveBeenCalledWith("learning", 5, 0);
  });

  it("does not expose source-image tracing or movement in perspective mode", () => {
    const move = vi.fn();
    const { container } = render(<CampusSceneCanvas scene={scene} mode="2.5d" sourceImageUrl="blob:private-reference" onSelectElement={vi.fn()} onMoveElement={move} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Learning building, building, 3 floors" }), { key: "ArrowRight" });
    expect(move).not.toHaveBeenCalled(); expect(container.querySelector("image")).toBeNull();
  });

  it("preserves the actual footprint and renders drag handles only in plan editing", () => {
    const { container, rerender } = render(<CampusSceneCanvas scene={scene} mode="2d" selectedElementId="learning" onSelectElement={vi.fn()} onChangeVertex={vi.fn()} sourceImageUrl="blob:private-reference" />);
    expect(container.querySelectorAll("[data-scene-vertex]")).toHaveLength(4);
    expect(container.querySelector("image")?.getAttribute("href")).toBe("blob:private-reference");
    rerender(<CampusSceneCanvas scene={scene} mode="2.5d" selectedElementId="learning" onSelectElement={vi.fn()} onChangeVertex={vi.fn()} />);
    expect(container.querySelectorAll("[data-scene-vertex]")).toHaveLength(0);
  });

  it("commits one translated polygon after pointer release and cancels interrupted movement", () => {
    const move = vi.fn();
    const { container } = render(<CampusSceneCanvas scene={scene} mode="2d" onSelectElement={vi.fn()} onMoveElement={move} />);
    const svg = container.querySelector<SVGSVGElement>("svg.campus-scene-svg")!;
    preparePointerSurface(svg);
    const fit = fitSceneViewport({ width: 800, height: 600 }, sceneRenderBounds(scene, "2d"));
    const x = fit.x + 30 * fit.scale, y = fit.y + 30 * fit.scale;
    const building = screen.getByRole("button", { name: "Learning building, building, 3 floors" });
    pointer(building, "pointerdown", x, y);
    pointer(svg, "pointermove", x + 10 * fit.scale, y);
    expect(move).not.toHaveBeenCalled();
    pointer(svg, "pointerup", x + 10 * fit.scale, y);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move.mock.calls[0]![0]).toBe("learning"); expect(move.mock.calls[0]![1]).toBeCloseTo(10); expect(move.mock.calls[0]![2]).toBeCloseTo(0);
    pointer(building, "pointerdown", x, y);
    pointer(svg, "pointermove", x + 20 * fit.scale, y);
    pointer(svg, "pointercancel", x + 20 * fit.scale, y);
    expect(move).toHaveBeenCalledTimes(1);
  });

  it("consumes wheel zoom instead of scrolling the containing page", () => {
    const { container } = render(<CampusSceneCanvas scene={scene} mode="2.5d" onSelectElement={vi.fn()} />);
    const svg = container.querySelector<SVGSVGElement>("svg.campus-scene-svg")!;
    preparePointerSurface(svg);
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -50, clientX: 400, clientY: 300 });
    fireEvent(svg, event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("uses continuous illustrative day and night terrain, with light only on recorded lamp assets", () => {
    const lamp = { id: "lamp", kind: "fixture" as const, label: "Path lamp", asset_key: "lamp" as const, geometry: { type: "point" as const, points: [{ x: 80, y: 70 }] }, space_id: null, floor_id: null, review_state: "reviewed" as const };
    const litScene = { ...scene, elements: [...scene.elements, lamp] };
    const original = structuredClone(litScene);
    const { container, rerender } = render(<CampusSceneCanvas scene={litScene} mode="2.5d" onSelectElement={vi.fn()} />);
    expect(container.querySelector("[data-illustrative-lamp-glow]")).toBeNull();
    for (const lighting of ["day", "night"] as const) {
      rerender(<CampusSceneCanvas scene={litScene} mode="2.5d" lighting={lighting} onSelectElement={vi.fn()} />);
      expect(screen.getByTestId("campus-scene-canvas")).toHaveAttribute("data-lighting", lighting);
      const ground = container.querySelector("[data-scene-base]")!;
      expect(ground).toHaveAttribute("fill", container.querySelector("[data-scene-surround]")!.getAttribute("fill"));
      expect(ground).toHaveAttribute("stroke", "none");
    }
    expect(container.querySelectorAll("[data-scene-element]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-illustrative-lamp-glow]")).toHaveLength(1);
    expect(container.querySelector('[data-illustrative-window="night"]')).not.toBeNull();
    expect(litScene).toEqual(original);
  });

  it("renders only explicit boundary segments, preserving an open entrance gap and elevated paint order", () => {
    const wall = { id: "west-wall", kind: "path" as const, label: "Perimeter", asset_key: "boundary_wall" as const, geometry: { type: "polyline" as const, points: [{ x: 5, y: 100 }, { x: 60, y: 100 }] }, width: .8, height: 3, space_id: null, floor_id: null, review_state: "reviewed" as const };
    const east = { ...wall, id: "east-wall", geometry: { ...wall.geometry, points: [{ x: 80, y: 100 }, { x: 150, y: 100 }] } };
    const { container, rerender } = render(<CampusSceneCanvas scene={scene} mode="2.5d" onSelectElement={vi.fn()} />);
    expect(container.querySelector("[data-boundary-wall]")).toBeNull();
    rerender(<CampusSceneCanvas scene={{ ...scene, elements: [...scene.elements, wall, east] }} mode="2.5d" onSelectElement={vi.fn()} />);
    expect(container.querySelectorAll("[data-boundary-wall]").length).toBeGreaterThan(2);
    expect(new Set(Array.from(container.querySelectorAll("[data-scene-element]")).map(item => item.getAttribute("data-scene-element")))).toEqual(new Set(["learning", "west-wall", "east-wall"]));
    expect(screen.getAllByRole("button", { name: "Perimeter, path" })).toHaveLength(2);
    expect(container.querySelector('[data-scene-label="west-wall"]')).toBeNull();
    rerender(<CampusSceneCanvas scene={{ ...scene, elements: [wall, east] }} mode="2d" onSelectElement={vi.fn()} />);
    expect(Array.from(container.querySelectorAll("[data-boundary-wall]")).map(item => item.getAttribute("points")).sort()).toEqual(["5,100 60,100", "80,100 150,100"]);
  });

  it("keeps illustrative surroundings outside the editable scene and omits them from plan and floor views", () => {
    const select = vi.fn();
    const {container,rerender} = render(<CampusSceneCanvas scene={scene} mode="2.5d" onSelectElement={select} />);
    const surroundings = container.querySelector('[data-scene-surroundings="illustrative"]');
    expect(surroundings).toHaveAttribute("aria-hidden","true");
    expect(surroundings).toHaveAttribute("pointer-events","none");
    expect(surroundings!.querySelector("[data-scene-element]")).toBeNull();
    expect(container.querySelectorAll("[data-scene-element]")).toHaveLength(1);
    rerender(<CampusSceneCanvas scene={scene} mode="2d" onSelectElement={select} />);
    expect(container.querySelector("[data-scene-surroundings]")).toBeNull();
    rerender(<CampusSceneCanvas scene={scene} mode="2.5d" floorId="known-floor" onSelectElement={select} />);
    expect(container.querySelector("[data-scene-surroundings]")).toBeNull();
  });

  it("shows an exact floor on a neutral base without outdoor terrain or invented boundaries", () => {
    const room = { ...scene.elements[0]!, id: "room", kind: "room" as const, label: "Reading room", floor_id: "floor-one" };
    const tree = { ...scene.elements[0]!, id: "tree", kind: "tree" as const, label: "Outdoor tree", geometry: { type: "point" as const, points: [{ x: 90, y: 80 }] } };
    const floorScene = { ...scene, elements: [...scene.elements, room, tree] };
    const { container, rerender } = render(<CampusSceneCanvas scene={floorScene} mode="2d" floorId="floor-one" interiorOutline={scene.elements[0]!.geometry.points} onSelectElement={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Reading room, room, 3 floors" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Outdoor tree/ })).not.toBeInTheDocument();
    expect(container.querySelector('[data-scene-surroundings]')).toBeNull();
    expect(container.querySelector('[data-room-floor]')).not.toBeNull();
    expect(container.querySelector("[data-scene-base]")).toHaveAttribute("fill", "var(--thatcampus-surface-soft)");
    expect(container.querySelector("[data-interior-outline]")).toHaveAttribute("points", "20,20 60,20 60,50 20,50");
    rerender(<CampusSceneCanvas scene={floorScene} mode="2d" floorId="floor-one" onSelectElement={vi.fn()} />);
    expect(container.querySelector("[data-interior-outline]")).toBeNull();
    rerender(<CampusSceneCanvas scene={floorScene} mode="2.5d" onSelectElement={vi.fn()} />);
    expect(container.querySelector("pattern")).not.toBeNull();
    expect(container.querySelector("[data-scene-base]")).toHaveAttribute("fill", "#aec48d");
  });

  it("keeps dense unlinked furnishings decorative while a room and exact resource remain selectable", () => {
    const room: CampusSceneElement = { ...scene.elements[0]!, id: "seminar", label: "Seminar room", kind: "room", levels: undefined, floor_id: "first", space_id: "seminar-place" };
    const chair: CampusSceneElement = { id: "chair", kind: "fixture", label: "Seminar chair", asset_key: "chair", floor_id: "first", space_id: null, parent_element_id: room.id, geometry: { type: "point", points: [{ x: 30, y: 30 }] }, review_state: "reviewed" };
    const desk: CampusSceneElement = { ...chair, id: "desk", label: "Seminar desk", asset_key: "desk", space_id: room.space_id };
    const projector: CampusSceneElement = { ...chair, id: "projector", label: "Seminar projector", asset_key: "projector", holding_id: "projector-holding", width: .42 };
    const entrance: CampusSceneElement = { ...chair, id: "entrance", label: "East entrance", asset_key: "door", navigation_connector: { kind: "entrance", status: "open", accessible: true, from_floor_id: null, to_floor_id: "first" } };
    const document = { ...scene, elements: [room, chair, desk, projector, entrance] }, original = structuredClone(document), select = vi.fn();
    const { container, rerender } = render(<CampusSceneCanvas scene={document} mode="2d" floorId="first" onSelectElement={select} />);
    for (const id of ["chair", "desk"]) {
      const furnishing = container.querySelector(`[data-scene-element="${id}"]`)!;
      expect(furnishing).toHaveAttribute("pointer-events", "none");
      expect(furnishing).toHaveAttribute("aria-hidden", "true");
      expect(furnishing).not.toHaveAttribute("role"); expect(furnishing).not.toHaveAttribute("tabindex");
      expect(furnishing.querySelector(":scope > circle[fill=transparent]")).toBeNull();
    }
    const roomButton = screen.getByRole("button", { name: "Seminar room, room" });
    fireEvent.keyDown(roomButton, { key: "Enter" }); expect(select).toHaveBeenLastCalledWith("seminar");
    const svg = container.querySelector<SVGSVGElement>("svg.campus-scene-svg")!; preparePointerSurface(svg);
    pointer(roomButton, "pointerdown", 300, 300); pointer(svg, "pointerup", 300, 300);
    expect(select).toHaveBeenLastCalledWith("seminar");
    fireEvent.keyDown(screen.getByRole("button", { name: "Seminar projector, fixture" }), { key: "Enter" });
    expect(select).toHaveBeenLastCalledWith("projector");
    const scale = Number(container.querySelector("svg.campus-scene-svg > g[transform]")!.getAttribute("transform")!.match(/scale\(([^)]+)\)/u)![1]);
    expect(Number(container.querySelector('[data-scene-element="projector"] > circle[fill=transparent]')!.getAttribute("r")) * scale).toBeCloseTo(6);
    expect(Number(container.querySelector('[data-scene-element="entrance"] > circle[fill=transparent]')!.getAttribute("r")) * scale).toBeCloseTo(12);
    expect(screen.getByRole("button", { name: "East entrance, fixture" })).toBeVisible();
    const move = vi.fn();
    rerender(<CampusSceneCanvas scene={document} mode="2d" floorId="first" onSelectElement={select} onMoveElement={move} />);
    for (const name of ["Seminar chair, fixture", "Seminar desk, fixture"]) expect(screen.getByRole("button", { name })).not.toHaveAttribute("pointer-events", "none");
    fireEvent.keyDown(screen.getByRole("button", { name: "Seminar chair, fixture" }), { key: "ArrowRight" });
    expect(move).toHaveBeenCalledWith("chair", 1, 0);
    expect(document).toEqual(original);
  });

  it("opens source records from a keyboard or touch marker without changing the selected geometry",()=>{
    const marker:SceneEvidenceMarker={id:"expected:learning",elementId:"learning",dimension:"expected",count:2,label:"Expected · Learning building",summary:"2 expected records, 2 current.",expectedCount:40};
    const selectPlace=vi.fn(),selectMarker=vi.fn();
    const {container}=render(<CampusSceneCanvas scene={scene} mode="2.5d" markers={[marker]} onSelectElement={selectPlace} onSelectMarker={selectMarker}/>);
    const button=screen.getByRole("button",{name:"Expected · Learning building. 2 expected records, 2 current."});
    expect(button).toHaveTextContent("2");
    fireEvent.keyDown(button,{key:"Enter"});fireEvent.click(button);
    expect(selectMarker).toHaveBeenCalledTimes(2);expect(selectMarker).toHaveBeenLastCalledWith(marker.id);expect(selectPlace).not.toHaveBeenCalled();
    expect(container.querySelectorAll("[data-expected-figure]")).toHaveLength(0);
    const width=button.querySelector("rect")!.getAttribute("width");
    fireEvent.click(screen.getByRole("button",{name:"Zoom in"}));
    expect(button.querySelector("rect")).toHaveAttribute("width",width);
  });

  it("does not turn aggregate record markers into individual people or revive the removed drift renderer",()=>{
    const room={...scene.elements[0]!,id:"room",kind:"room" as const,space_id:"room-place",floor_id:"known-floor"};
    const marker:SceneEvidenceMarker={id:"expected:room",elementId:"room",dimension:"expected",count:1,label:"Expected room",summary:"1 current expected record",expectedCount:25};
    const {container}=render(<CampusSceneCanvas scene={{...scene,elements:[room]}} mode="2d" floorId="known-floor" markers={[marker]} onSelectElement={vi.fn()}/>);
    expect(container.querySelectorAll("[data-expected-figure]")).toHaveLength(0);
    expect(container.querySelector("[data-people-layer]")).toBeNull();
    expect(screen.getByRole("button",{name:"Expected room. 1 current expected record"})).toBeVisible();
  });

  it("suppresses only an explicitly unavailable linked lamp's illustrative night glow",()=>{
    const lamp={id:"lamp-a",kind:"fixture" as const,label:"Lamp",asset_key:"lamp" as const,geometry:{type:"point" as const,points:[{x:80,y:80}]},space_id:null,floor_id:null,review_state:"reviewed" as const};
    const source={...scene,elements:[lamp,{...lamp,id:"lamp-b",geometry:{...lamp.geometry,points:[{x:90,y:80}]}}]},original=structuredClone(source);
    const {container,rerender}=render(<CampusSceneCanvas scene={source} mode="2.5d" lighting="night" unavailableFixtureIds={["lamp-a"]} onSelectElement={vi.fn()}/>);
    expect(container.querySelector('[data-scene-element="lamp-a"] [data-illustrative-lamp-glow]')).toBeNull();
    expect(container.querySelector('[data-scene-element="lamp-a"] [data-lamp-bulb]')).toHaveAttribute("data-lamp-bulb","unavailable");
    expect(container.querySelector('[data-scene-element="lamp-b"] [data-illustrative-lamp-glow]')).not.toBeNull();
    rerender(<CampusSceneCanvas scene={source} mode="2.5d" lighting="night" onSelectElement={vi.fn()}/>);
    expect(container.querySelectorAll("[data-illustrative-lamp-glow]")).toHaveLength(2);expect(source).toEqual(original);
  });
});
