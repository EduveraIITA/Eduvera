import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSceneViewport } from "./useSceneViewport";
import { fitFocusedSceneViewport, type SceneViewportFocus } from "./sceneViewportFocus";
import { fitSceneViewport, sceneViewportInsets, type SceneViewMode, type SceneViewport } from "./sceneGeometry";
const campus = { x: 0, y: 0, width: 1000, height: 1000 };
const focus: SceneViewportFocus = { key: "gate-to-library", bounds: { x: 420, y: 420, width: 160, height: 160 } };
let dimensions = { width: 350, height: 440 }, resized: ResizeObserverCallback;
function Harness({ context = focus, mode = "2.5d", bottomInset = 0, overview = false }: { context?: SceneViewportFocus | null; mode?: SceneViewMode; bottomInset?: number; overview?: boolean }) {
  const { hostRef, viewport, setViewport, fit, fitFocus } = useSceneViewport({ ...campus }, mode, "publication-1", 64, context, bottomInset, overview);
  return <div ref={hostRef} data-testid="viewport-host"><output aria-label="Camera">{JSON.stringify(viewport)}</output><button onClick={() => setViewport(current => ({ ...current, x: current.x + 30 }))}>Pan map</button><button onClick={fit}>Fit campus</button><button onClick={fitFocus}>Fit route</button></div>;
}
const camera = () => JSON.parse(screen.getByLabelText("Camera").textContent) as SceneViewport;
beforeEach(() => {
  dimensions = { width: 350, height: 440 };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, dimensions.width, dimensions.height));
  vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resized = callback; } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("focused campus viewport lifecycle", () => {
  it("opens the phone at a readable overview, keeps manual framing through refresh and offers the full campus extent", () => {
    const { rerender } = render(<Harness context={null} overview/>);
    const fitted = fitSceneViewport({ ...dimensions, topInset: 64 }, campus);
    expect(camera().scale).toBeCloseTo(fitted.scale * 2.85);
    fireEvent.click(screen.getByRole("button", { name: "Pan map" })); const manual = camera();
    rerender(<Harness context={null} overview/>); expect(camera()).toEqual(manual);
    fireEvent.click(screen.getByRole("button", { name: "Fit campus" })); expect(camera()).toEqual(fitted);
    dimensions = { width: 390, height: 500 }; act(() => resized([], {} as ResizeObserver));
    expect(camera()).toEqual(fitSceneViewport({ ...dimensions, topInset: 64 }, campus));
  });
  it("focuses once, retains manual movement through equivalent refreshes, and lets both fit controls restore their scope", () => {
    const { rerender } = render(<Harness />);
    const initial = camera();
    expect(initial).toEqual(fitFocusedSceneViewport({ ...dimensions, topInset: 64 }, focus.bounds, campus));
    fireEvent.click(screen.getByRole("button", { name: "Pan map" }));
    const manual = camera(); expect(manual.x).not.toBe(initial.x);
    rerender(<Harness context={structuredClone(focus)} />);
    expect(camera()).toEqual(manual);
    fireEvent.click(screen.getByRole("button", { name: "Fit route" })); expect(camera()).toEqual(initial);
    fireEvent.click(screen.getByRole("button", { name: "Fit campus" })); const whole = camera();
    expect(whole.scale).toBeLessThan(initial.scale);
    rerender(<Harness context={structuredClone(focus)} />); expect(camera()).toEqual(whole);
  });
  it("establishes a new automatic focus when route context or projection changes", () => {
    const { rerender } = render(<Harness />); const initial = camera();
    fireEvent.click(screen.getByRole("button", { name: "Pan map" }));
    rerender(<Harness mode="2d" />); expect(camera()).toEqual(initial);
    fireEvent.click(screen.getByRole("button", { name: "Pan map" }));
    rerender(<Harness context={{ key: "gate-to-new-building", bounds: { x: 580, y: 580, width: 160, height: 160 } }} />);
    expect(camera().x).not.toBe(initial.x); expect(camera().y).not.toBe(initial.y);
  });
  it("refits an automatic route after resize but preserves a manually chosen world centre", () => {
    render(<Harness />);
    dimensions = { width: 390, height: 500 };
    act(() => resized([], {} as ResizeObserver));
    expect(camera()).toEqual(fitFocusedSceneViewport({ ...dimensions, topInset: 64 }, focus.bounds, campus));
    fireEvent.click(screen.getByRole("button", { name: "Pan map" }));
    const manual = camera();
    const worldX = (dimensions.width / 2 - manual.x) / manual.scale, worldY = (64 + (dimensions.height - 64) / 2 - manual.y) / manual.scale;
    dimensions = { width: 320, height: 440 };
    act(() => resized([], {} as ResizeObserver));
    const next = camera();
    expect((dimensions.width / 2 - next.x) / next.scale).toBeCloseTo(worldX);
    expect((64 + (dimensions.height - 64) / 2 - next.y) / next.scale).toBeCloseTo(worldY);
  });
  it("uses the measured control inset, refits automatic focus and preserves manual centre as controls change", () => {
    render(<Harness bottomInset={132} />);
    expect(camera()).toEqual(fitFocusedSceneViewport({ ...dimensions, topInset: 64, bottomInset: 132 }, focus.bounds, campus));
    screen.getByTestId("viewport-host").style.setProperty("--campus-map-bottom-inset", "76px");
    act(() => resized([], {} as ResizeObserver));
    expect(camera()).toEqual(fitFocusedSceneViewport({ ...dimensions, topInset: 64, bottomInset: 76 }, focus.bounds, campus));
    fireEvent.click(screen.getByRole("button", { name: "Pan map" }));
    const before = camera(), oldInsets = sceneViewportInsets({ ...dimensions, topInset: 64, bottomInset: 76 });
    const worldY = (oldInsets.top + oldInsets.height / 2 - before.y) / before.scale;
    screen.getByTestId("viewport-host").style.setProperty("--campus-map-bottom-inset", "132px");
    act(() => resized([], {} as ResizeObserver));
    const after = camera(), newInsets = sceneViewportInsets({ ...dimensions, topInset: 64, bottomInset: 132 });
    expect((newInsets.top + newInsets.height / 2 - after.y) / after.scale).toBeCloseTo(worldY);
  });

});
