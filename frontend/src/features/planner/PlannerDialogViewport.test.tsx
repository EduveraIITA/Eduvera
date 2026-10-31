import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PlannerDialog } from "./PlannerLessonSheet";

class Viewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;
}
const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 390, width: 390, x: 0, y: top, toJSON: () => ({}) });
let viewport: Viewport;
beforeEach(() => {
  vi.useFakeTimers();
  viewport = new Viewport();
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("keyboard-aware shared sheets", () => {
  it("fits the actual visible height and offset, then restores after the keyboard closes", () => {
    render(<PlannerDialog title="Add people" onClose={vi.fn()}><input aria-label="Name" /></PlannerDialog>);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.getPropertyValue("--planner-visible-height")).toBe("844px");
    act(() => { viewport.height = 360; viewport.offsetTop = 80; viewport.dispatchEvent(new Event("resize")); vi.runOnlyPendingTimers(); });
    expect(dialog.style.getPropertyValue("--planner-visible-height")).toBe("360px");
    expect(dialog.style.getPropertyValue("--planner-viewport-top")).toBe("80px");
    expect(dialog.style.getPropertyValue("--planner-viewport-bottom")).toBe("404px");
    expect(dialog).toHaveAttribute("data-keyboard-visible", "true");
    act(() => { viewport.height = 844; viewport.offsetTop = 0; viewport.dispatchEvent(new Event("scroll")); vi.runOnlyPendingTimers(); });
    expect(dialog.style.getPropertyValue("--planner-viewport-bottom")).toBe("0px");
    expect(dialog).toHaveAttribute("data-keyboard-visible", "false");
  });

  it("keeps the whole focused field region clear of sticky chrome without moving document focus", () => {
    render(<PlannerDialog title="Add people" onClose={vi.fn()}><div><div data-dialog-focus-region><button>Import file</button><input aria-label="Name" /></div><footer style={{ position: "sticky" }}>Add person</footer></div></PlannerDialog>);
    const dialog = screen.getByRole("dialog");
    const input = screen.getByRole("textbox");
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(rect(60, 380));
    vi.spyOn(dialog.querySelector("header")!, "getBoundingClientRect").mockReturnValue(rect(60, 68));
    vi.spyOn(dialog.querySelector("footer")!, "getBoundingClientRect").mockReturnValue(rect(370, 70));
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue(rect(410, 48));
    vi.spyOn(dialog.querySelector("[data-dialog-focus-region]")!, "getBoundingClientRect").mockReturnValue(rect(360, 110));
    act(() => { viewport.height = 360; viewport.offsetTop = 80; input.focus(); vi.runOnlyPendingTimers(); });
    expect(dialog.scrollTop).toBe(108);
    expect(input).toHaveFocus();
  });

  it("coalesces viewport events and detaches listeners on close without affecting another sheet", () => {
    const remove = vi.spyOn(viewport, "removeEventListener");
    const mounted = render(<PlannerDialog title="Add people" onClose={vi.fn()}><input aria-label="Name" /></PlannerDialog>);
    act(() => { viewport.dispatchEvent(new Event("resize")); viewport.dispatchEvent(new Event("scroll")); });
    expect(vi.getTimerCount()).toBe(1);
    mounted.unmount();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    act(() => { viewport.dispatchEvent(new Event("resize")); viewport.dispatchEvent(new Event("scroll")); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the active input visible when its surrounding region is taller than the available space", () => {
    render(<PlannerDialog title="Add people" onClose={vi.fn()}><div><div data-dialog-focus-region><input aria-label="Name" /></div><footer style={{ position: "sticky" }}>Add person</footer></div></PlannerDialog>);
    const dialog = screen.getByRole("dialog");
    const input = screen.getByRole("textbox");
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(rect(60, 380));
    vi.spyOn(dialog.querySelector("header")!, "getBoundingClientRect").mockReturnValue(rect(60, 68));
    vi.spyOn(dialog.querySelector("footer")!, "getBoundingClientRect").mockReturnValue(rect(370, 70));
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue(rect(410, 44));
    vi.spyOn(dialog.querySelector("[data-dialog-focus-region]")!, "getBoundingClientRect").mockReturnValue(rect(180, 400));
    act(() => { viewport.height = 360; viewport.offsetTop = 80; input.focus(); vi.runOnlyPendingTimers(); });
    expect(dialog.scrollTop).toBe(92);
    expect(input).toHaveFocus();
  });

  it("keeps CSS fallbacks when visualViewport is unavailable and never treats zoom as a keyboard", () => {
    vi.stubGlobal("visualViewport", undefined);
    const mounted = render(<PlannerDialog title="No viewport API" onClose={vi.fn()}><p>Content</p></PlannerDialog>);
    expect(screen.getByRole("dialog").style.getPropertyValue("--planner-visible-height")).toBe("");
    mounted.unmount();
    vi.stubGlobal("visualViewport", viewport);
    viewport.height = 420; viewport.scale = 2;
    render(<PlannerDialog title="Zoomed" onClose={vi.fn()}><p>Content</p></PlannerDialog>);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-keyboard-visible", "false");
    const styles = readFileSync(join(process.cwd(), "src/features/planner/principal-planner.css"), "utf8");
    expect(styles).toContain("inset:auto 0 var(--planner-viewport-bottom,0px)");
    expect(styles).toContain("max-height:min(92dvh,calc(var(--planner-visible-height,100dvh) - 12px))");
    expect(styles).toContain("overscroll-behavior:contain");
  });
});
