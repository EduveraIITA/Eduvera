import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenePeopleLayer } from "./ScenePeopleLayer";
import { createScenePeopleRenderer, type ScenePeopleRendererModel } from "./scenePeopleRenderer";
import { sampleScenePeople } from "./scenePeopleTracks";
import { applicationNow } from "../simulation/applicationTime";
import { DEFAULT_SCENE_SUNLIGHT } from "./sceneSunlight";
import type { ScenePeopleCompiled, ScenePeoplePose } from "./scenePeopleTracks.types";
import type { CampusSceneDocument } from "./types";

vi.mock("./scenePeopleTracks", () => ({ sampleScenePeople: vi.fn() }));
vi.mock("../simulation/applicationTime", () => ({ applicationNow: vi.fn() }));

const scene: CampusSceneDocument = { schema_version: 1, name: "Campus", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed" }, elements: [] };
const data = (key = "world-one"): ScenePeopleCompiled => ({ contextKey: key, scope: { worldKey: key, publicationKey: "published", networkKey: "network" }, asOf: 1000, tracks: [], points: [], unmapped: 0, unavailableRoutes: 0, conflicting: 0, sourceLimited: false });
const pose = (key = "person", changes: Partial<ScenePeoplePose> = {}): ScenePeoplePose => ({ key, point: { x: 30, y: 50 }, floorId: null, heading: 0, moving: true, phase: 0, opacity: 1, tone: "expected", ...changes });
const model = (overrides: Partial<ScenePeopleRendererModel> = {}): ScenePeopleRendererModel => ({ data: data(), clock: { instant: 1000, live: true, running: true, epoch: "epoch" }, viewport: { x: 0, y: 0, scale: 4 }, size: { width: 390, height: 600 }, mode: "2.5d", floorId: null, unit: 1, lighting: "day", sunlight: DEFAULT_SCENE_SUNLIGHT, occluders: [], sourceSignature: "same-source", ...overrides });

let main: CanvasRenderingContext2D, time: number, nextId: number;
let mainDraw: ReturnType<typeof vi.fn>, mainTransform: ReturnType<typeof vi.fn>;
let callbacks: Map<number, FrameRequestCallback>, mediaListeners: Set<() => void>, reduced: boolean, hidden: boolean;
let trace: string[], media: MediaQueryList;
function context(record = false) {
  let operation = "source-over", alpha = 1;
  const stack: { operation: string; alpha: number }[] = [];
  const result = { clearRect: vi.fn(() => { if (record) trace.push("clear"); }), setTransform: vi.fn(), translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), ellipse: vi.fn(), arc: vi.fn(),
    fill: vi.fn(() => { if (record) trace.push(`fill:${operation}`); }), stroke: vi.fn(() => { if (record) trace.push(`stroke:${operation}`); }), drawImage: vi.fn(() => { if (record) trace.push("sprite"); }),
    save: vi.fn(() => stack.push({ operation, alpha })), restore: vi.fn(() => { const previous = stack.pop(); if (previous) { operation = previous.operation; alpha = previous.alpha; } }),
  };
  Object.defineProperties(result, { globalCompositeOperation: { get: () => operation, set: (value: string) => { operation = value; } }, globalAlpha: { get: () => alpha, set: (value: number) => { alpha = value; } } });
  if (record) { mainDraw = result.drawImage; mainTransform = result.setTransform; }
  return result as unknown as CanvasRenderingContext2D;
}
function step(next: number) { time = next; const pending = [...callbacks.values()]; callbacks.clear(); act(() => { for (const callback of pending) callback(next); }); }
function canvasEngine() { const canvas = document.createElement("canvas"); canvas.className = "scene-people-layer"; document.body.append(canvas); return { canvas, engine: createScenePeopleRenderer(canvas)! }; }

beforeEach(() => {
  trace = []; time = 0; nextId = 0; callbacks = new Map(); reduced = false; hidden = false; mediaListeners = new Set(); main = context(true);
  vi.stubGlobal("Path2D", class { constructor(public path?: string) {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { callbacks.set(++nextId, callback); return nextId; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { callbacks.delete(id); }));
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) { return this.classList.contains("scene-people-layer") ? main : context(); });
  media = { get matches() { return reduced; }, media: "(prefers-reduced-motion: reduce)", addEventListener: vi.fn((_type: string, listener: () => void) => { mediaListeners.add(listener); }), removeEventListener: vi.fn((_type: string, listener: () => void) => { mediaListeners.delete(listener); }) } as unknown as MediaQueryList;
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.mocked(sampleScenePeople).mockImplementation(() => ({ people: [pose()], pulses: [] }));
  vi.mocked(applicationNow).mockImplementation(() => new Date(1000 + time));
});
afterEach(() => { cleanup(); document.querySelectorAll("canvas").forEach(canvas => canvas.remove()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("people canvas lifecycle", () => {
  it("uses one RAF, redraws with the committed camera and cancels work on cleanup", () => {
    const { engine } = canvasEngine(), first = model(); engine.update(first);
    expect(callbacks.size).toBe(1); expect(mainDraw).toHaveBeenCalledTimes(1);
    step(16); expect(callbacks.size).toBe(1);
    engine.update({ ...first, viewport: { x: 27, y: 41, scale: 5 } });
    expect(mainTransform).toHaveBeenLastCalledWith(5, 0, 0, 5, 27, 41);
    expect(callbacks.size).toBe(1);
    const stale = [...callbacks.values()][0]!; engine.dispose(); expect(callbacks.size).toBe(0);
    trace.length = 0; stale(32); expect(trace).toEqual([]); expect(mediaListeners.size).toBe(0);
  });
  it("caps DPR, culls other floors/off-screen people and enforces the phone draw budget", () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const visible = Array.from({ length: 300 }, (_, index) => pose(`person-${index}`, { point: { x: 20 + index % 10, y: 40 + index % 8 } }));
    vi.mocked(sampleScenePeople).mockReturnValue({ people: [...visible, pose("other-floor", { floorId: "upstairs" }), pose("offscreen", { point: { x: 10000, y: 10000 } })], pulses: [] });
    const { canvas, engine } = canvasEngine(); engine.update(model());
    expect(canvas.width).toBe(780); expect(canvas.height).toBe(1200); expect(mainDraw).toHaveBeenCalledTimes(128);
    expect(sampleScenePeople).toHaveBeenLastCalledWith(expect.anything(), expect.any(Number), { maxPeople: 128, floorId: null });
    engine.dispose();
  });
  it("erases people behind a building and paints foreground people after its mask", () => {
    vi.mocked(sampleScenePeople).mockReturnValue({ people: [pose("behind", { point: { x: 30, y: 25 } }), pose("front", { point: { x: 30, y: 75 } })], pulses: [] });
    const { engine } = canvasEngine(); engine.update(model({ occluders: [{ key: "building", depth: 50, bounds: { x: 10, y: 10, width: 60, height: 100 }, masks: [{ path: new Path2D("M 0 0 L 20 0 L 20 40 Z"), fill: true }] }] }));
    const paints = trace.filter(item => item === "sprite" || item === "fill:destination-out");
    expect(paints).toEqual(["sprite", "fill:destination-out", "sprite"]); engine.dispose();
  });
  it("retains a recent scan as a static event ring without a perpetual animation loop", () => {
    const timer = vi.spyOn(globalThis, "setTimeout");
    vi.mocked(sampleScenePeople).mockReturnValue({ people: [], pulses: [{ key: "scan", point: { x: 30, y: 50 }, floorId: null, ageMs: 30_000, dimension: "accepted" }] });
    const current = data(); current.points = [{ key: "scan", point: { x: 30, y: 50 }, floorId: null, observedAt: -29_000, dimension: "accepted" }];
    const { engine } = canvasEngine(); engine.update(model({ data: current }));
    expect(trace).toContain("stroke:source-over"); expect(callbacks.size).toBe(0);
    expect(timer).toHaveBeenLastCalledWith(expect.any(Function), 90_000); engine.dispose();
  });
  it("stops motion while hidden/reduced, then clears retained world pixels before drawing a new scope", () => {
    const { engine } = canvasEngine(); engine.update(model()); expect(callbacks.size).toBe(1);
    hidden = true; document.dispatchEvent(new Event("visibilitychange")); expect(callbacks.size).toBe(0);
    hidden = false; document.dispatchEvent(new Event("visibilitychange")); expect(callbacks.size).toBe(1);
    reduced = true; for (const listener of mediaListeners) listener(); expect(callbacks.size).toBe(0);
    vi.mocked(sampleScenePeople).mockImplementation(current => ({ people: current.contextKey === "world-two" ? [] : [pose()], pulses: [] }));
    trace.length = 0; engine.update(model({ data: data("world-two") }));
    expect(trace[0]).toBe("clear"); expect(trace).not.toContain("sprite"); engine.dispose();
  });
  it("eases only between confirmed Simulation instants, freezes on pause and never extrapolates", () => {
    const { engine } = canvasEngine(), first = model({ clock: { instant: 1000, live: false, running: true, epoch: "epoch" } });
    engine.update(first); expect(callbacks.size).toBe(0);
    engine.update({ ...first, clock: { ...first.clock, instant: 2000 } }); expect(callbacks.size).toBe(1);
    step(90); expect(vi.mocked(sampleScenePeople).mock.calls.at(-1)![1]).toBe(1500);
    step(180); expect(vi.mocked(sampleScenePeople).mock.calls.at(-1)![1]).toBe(2000); expect(callbacks.size).toBe(0);
    step(5000); expect(vi.mocked(sampleScenePeople).mock.calls.at(-1)![1]).toBe(2000);
    engine.update({ ...first, clock: { ...first.clock, instant: 2500, running: false } });
    expect(vi.mocked(sampleScenePeople).mock.calls.at(-1)![1]).toBe(2500); expect(callbacks.size).toBe(0);
    expect(applicationNow).not.toHaveBeenCalled(); engine.dispose();
  });
  it("withdraws expired people immediately during easing and draws backwards seeks exactly", () => {
    vi.mocked(sampleScenePeople).mockImplementation((_data, instant) => ({ people: instant !== null && instant < 2000 ? [pose()] : [], pulses: [] }));
    const { engine } = canvasEngine(), first = model({ clock: { instant: 1000, live: false, running: true, epoch: "epoch" } }); engine.update(first);
    trace.length = 0; engine.update({ ...first, clock: { ...first.clock, instant: 2000 } }); expect(trace).not.toContain("sprite");
    step(90); expect(trace).not.toContain("sprite");
    engine.update({ ...first, clock: { ...first.clock, instant: 500 } }); expect(vi.mocked(sampleScenePeople).mock.calls.at(-1)![1]).toBe(500); expect(callbacks.size).toBe(0); engine.dispose();
  });
  it("disposes the old scope engine when the layer is rebound, including an already delivered old callback", () => {
    const first = model(), { data: firstData, clock, ...visual } = first;
    const { rerender, unmount } = render(<ScenePeopleLayer {...visual} scene={scene} data={firstData} clock={clock} />);
    const old = [...callbacks.values()][0]!;
    vi.mocked(sampleScenePeople).mockReturnValue({ people: [], pulses: [] });
    rerender(<ScenePeopleLayer {...visual} scene={scene} data={data("new-world")} clock={{ ...clock, epoch: "new-world" }} />);
    trace.length = 0; old(20); expect(trace).toEqual([]); unmount(); expect(callbacks.size).toBe(0);
  });
});
