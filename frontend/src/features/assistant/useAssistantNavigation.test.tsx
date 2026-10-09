import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAssistantNavigation } from "./useAssistantNavigation";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
const original = Object.getOwnPropertyDescriptor(document, "startViewTransition");
function nativeTransition() {
  let update: (() => Promise<void>) | undefined;
  const start = vi.fn((callback: () => Promise<void>) => { update = callback; return { finished: Promise.resolve() }; });
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
  return { start, update: () => update!() };
}
function mountSurface(className = "assistant-page") {
  const node = document.createElement("div"); node.className = className;
  document.body.append(node); return node;
}
afterEach(() => {
  cleanup(); document.querySelectorAll(".assistant-page, .assistant-dock").forEach(node => node.remove());
  if (original) Object.defineProperty(document, "startViewTransition", original); else Reflect.deleteProperty(document, "startViewTransition");
  vi.useRealTimers(); vi.restoreAllMocks(); navigate.mockReset();
});

describe("assistant view transitions", () => {
  it.each(["full", "compact"])("waits for the %s surface before taking the new snapshot", async target => {
    const transition = nativeTransition();
    const after = vi.fn();
    const { result } = renderHook(useAssistantNavigation);
    result.current.go(target === "full" ? "/teacher/assistant" : "/teacher", undefined, after);
    const committed = transition.update();
    expect(navigate).toHaveBeenCalledOnce();
    expect(after).not.toHaveBeenCalled();
    mountSurface(target === "full" ? "assistant-page" : "assistant-dock");
    await committed;
    expect(after).toHaveBeenCalledOnce();
  });
  it("does not trap navigation if the destination redirects", async () => {
    vi.useFakeTimers(); const transition = nativeTransition();
    const { result } = renderHook(useAssistantNavigation);
    result.current.go("/student/assistant");
    const committed = transition.update();
    vi.advanceTimersByTime(1000);
    await committed;
    expect(navigate).toHaveBeenCalledWith("/student/assistant", undefined);
  });
  it("bypasses motion when reduced motion is requested", () => {
    const transition = nativeTransition();
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    mountSurface();
    const { result } = renderHook(useAssistantNavigation);
    result.current.go("/parent/assistant");
    expect(transition.start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledOnce();
  });
});
