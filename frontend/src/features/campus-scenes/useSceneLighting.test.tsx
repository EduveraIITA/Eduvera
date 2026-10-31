import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import * as clock from "../simulation/applicationTime";
import { resolveSceneLighting } from "./sceneLighting";
import { DEFAULT_SCENE_SUNLIGHT } from "./sceneSunlight";
import { useSceneLighting } from "./useSceneLighting";

const appearance = vi.hoisted((): { preference: "light" | "dark" | "system"; resolved: "light" | "dark" } => ({ preference: "system", resolved: "light" }));
vi.mock("../appearance", () => ({ useAppearance: () => appearance }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T23:00:00Z")); appearance.preference = "system"; appearance.resolved = "light"; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("campus lighting policy", () => {
  it.each([
    ["2026-10-25T00:29:59Z", "night"],
    ["2026-10-25T00:30:00Z", "day"],
    ["2026-10-25T12:29:59Z", "day"],
    ["2026-10-25T12:30:00Z", "night"],
  ])("uses campus local time at %s", (instant, expected) => {
    expect(resolveSceneLighting("system", "light", new Date(instant), "Asia/Kolkata").lighting).toBe(expected);
  });
  it("resolves the campus timezone rather than the browser timezone", () => {
    const instant = new Date("2026-10-25T12:30:00Z");
    expect(resolveSceneLighting("system", "light", instant, "UTC").lighting).toBe("day");
    expect(resolveSceneLighting("system", "light", instant, "Asia/Kolkata").lighting).toBe("night");
  });
  it("keeps local minutes for directional shadows, including fractional-hour timezones", () => {
    expect(resolveSceneLighting("system", "light", new Date("2026-10-25T01:15:00Z"), "Asia/Kolkata")).toEqual({ lighting: "day", localHour: 6.75 });
    expect(resolveSceneLighting("system", "light", new Date("invalid"), "UTC")).toEqual({ lighting: "day", localHour: null });
  });
  it("honours explicit Profile appearance before campus local time or system appearance", () => {
    const instant = new Date("2026-10-25T12:00:00Z");
    expect(resolveSceneLighting("system", "dark", instant, "UTC").lighting).toBe("night");
    expect(resolveSceneLighting("light", "dark", new Date("2026-10-25T23:00:00Z"), "UTC").lighting).toBe("day");
    expect(resolveSceneLighting("dark", "light", instant, "UTC").lighting).toBe("night");
  });
  it("falls back only to appearance when campus time is missing or invalid", () => {
    for (const zone of [undefined, "Not/AZone"]) {
      expect(resolveSceneLighting("system", "light", new Date("2026-10-25T23:00:00Z"), zone)).toMatchObject({ lighting: "day", localHour: null });
    }
    expect(resolveSceneLighting("system", "dark", null, "UTC").lighting).toBe("night");
  });
});

describe("selected-world lighting clock", () => {
  it("does not advance paused Simulation lighting with wall time and accepts confirmed clock changes", () => {
    let environment: ExecutionEnvironment = { mode: "simulation", namespaceId: "run-space", runId: "run-one", runStatus: "paused", virtualClock: { now: "2026-10-25T11:00:00Z", timeZone: "UTC" } };
    const now = vi.spyOn(clock, "applicationNow");
    const wrapper = ({ children }: { children: ReactNode }) => <ExecutionEnvironmentProvider environment={environment}>{children}</ExecutionEnvironmentProvider>;
    const hook = renderHook(() => useSceneLighting("UTC"), { wrapper });
    expect(hook.result.current.lighting).toBe("day");
    const morning = hook.result.current.sunlight;
    expect(morning.direction.x).toBeLessThan(0);
    act(() => { vi.advanceTimersByTime(12 * 60 * 60 * 1000); window.dispatchEvent(new Event("focus")); });
    expect(hook.result.current.lighting).toBe("day");
    expect(hook.result.current.sunlight).toEqual(morning);
    expect(now).not.toHaveBeenCalled();
    environment = { ...environment, virtualClock: { now: "2026-10-25T16:30:00Z", timeZone: "UTC" } };
    hook.rerender();
    expect(hook.result.current.localHour).toBe(16.5);
    expect(hook.result.current.sunlight.direction.x).toBeGreaterThan(0);
    environment = { ...environment, virtualClock: { now: "2026-10-25T18:00:00Z", timeZone: "UTC" } };
    hook.rerender();
    expect(hook.result.current.lighting).toBe("night");
    expect(hook.result.current.sunlight.strength).toBe(0);
    appearance.preference = "light"; hook.rerender();
    expect(hook.result.current.lighting).toBe("day");
    expect(hook.result.current.sunlight).toEqual(DEFAULT_SCENE_SUNLIGHT);
  });
  it("does not interpolate a running Simulation clock or use its speed to advance sunlight", () => {
    const now = vi.spyOn(clock, "applicationNow");
    const environment: ExecutionEnvironment = { mode: "simulation", namespaceId: "run-space", runId: "run-one", runStatus: "running", speed: 100, virtualClock: { now: "2026-10-25T02:45:00Z", timeZone: "Asia/Kolkata" } };
    const wrapper = ({ children }: { children: ReactNode }) => <ExecutionEnvironmentProvider environment={environment}>{children}</ExecutionEnvironmentProvider>;
    const hook = renderHook(() => useSceneLighting(), { wrapper });
    expect(hook.result.current.localHour).toBe(8.25);
    const sunlight = hook.result.current.sunlight;
    act(() => { vi.advanceTimersByTime(6 * 60 * 60 * 1000); window.dispatchEvent(new Event("focus")); });
    hook.rerender();
    expect(hook.result.current.sunlight).toEqual(sunlight);
    expect(now).not.toHaveBeenCalled();
  });
  it("does not borrow wall time when Simulation is unavailable", () => {
    const now = vi.spyOn(clock, "applicationNow");
    const environment: ExecutionEnvironment = { mode: "simulation", namespaceId: "run-space", runId: "run-one", unavailable: true, unavailableReason: "runtime_unavailable" };
    const wrapper = ({ children }: { children: ReactNode }) => <ExecutionEnvironmentProvider environment={environment}>{children}</ExecutionEnvironmentProvider>;
    const hook = renderHook(() => useSceneLighting("UTC"), { wrapper });
    expect(hook.result.current).toMatchObject({ lighting: "day", localHour: null });
    expect(hook.result.current.sunlight).toEqual(DEFAULT_SCENE_SUNLIGHT);
    expect(now).not.toHaveBeenCalled();
  });
  it("uses neutral sunlight for an invalid campus timezone rather than substituting the browser zone", () => {
    const wrapper = ({ children }: { children: ReactNode }) => <ExecutionEnvironmentProvider environment={{ mode: "live" }}>{children}</ExecutionEnvironmentProvider>;
    const hook = renderHook(() => useSceneLighting("Unknown/Campus"), { wrapper });
    expect(hook.result.current).toEqual({ lighting: "day", localHour: null, sunlight: DEFAULT_SCENE_SUNLIGHT });
  });
  it("updates Live shadow direction at the next local minute", () => {
    vi.setSystemTime(new Date("2026-10-25T08:29:40Z"));
    const wrapper = ({ children }: { children: ReactNode }) => <ExecutionEnvironmentProvider environment={{ mode: "live" }}>{children}</ExecutionEnvironmentProvider>;
    const hook = renderHook(() => useSceneLighting("UTC"), { wrapper });
    const before = hook.result.current.sunlight;
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(hook.result.current.localHour).toBe(8.5);
    expect(hook.result.current.sunlight.direction.x).toBeGreaterThan(before.direction.x);
    expect(hook.result.current.lighting).toBe("day");
  });
  it("updates Live lighting at the local boundary and when appearance changes", () => {
    vi.setSystemTime(new Date("2026-10-25T17:59:40Z"));
    const wrapper = ({ children }: { children: ReactNode }) => <ExecutionEnvironmentProvider environment={{ mode: "live" }}>{children}</ExecutionEnvironmentProvider>;
    const hook = renderHook(() => useSceneLighting("UTC"), { wrapper });
    expect(hook.result.current.lighting).toBe("day");
    appearance.resolved = "dark"; hook.rerender();
    expect(hook.result.current.lighting).toBe("night");
    appearance.resolved = "light"; hook.rerender();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(hook.result.current.lighting).toBe("night");
    expect(hook.result.current.localHour).toBe(18);
  });
});
