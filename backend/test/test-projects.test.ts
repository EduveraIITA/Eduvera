import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverTestFiles, partitionTestFiles } from "./test-projects.js";

describe("complete and opt-in fast test inventory", () => {
  it("assigns every discovered test exactly once without hiding unknown files", () => {
    const all = discoverTestFiles(fileURLToPath(new URL("..", import.meta.url)));
    const { fast, remaining } = partitionTestFiles(all);
    expect(fast.length).toBeGreaterThan(0);
    expect(remaining.length).toBeGreaterThan(0);
    expect([...fast, ...remaining].sort()).toEqual(all);
    expect(new Set([...fast, ...remaining]).size).toBe(all.length);
    expect(partitionTestFiles(["new.test.ts"], []).remaining).toEqual(["new.test.ts"]);
  });

  it("fails on duplicate and stale fast entries", () => {
    expect(() => partitionTestFiles(["a"], ["a", "a"])).toThrow("Duplicate");
    expect(() => partitionTestFiles(["a"], ["missing"])).toThrow("Stale");
  });
});
