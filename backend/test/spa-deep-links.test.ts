import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SPA deep-link fallback", () => {
  it("serves every responsibility-composed workspace root through the React entry point", () => {
    const source = readFileSync(new URL("../src/spa.controller.ts", import.meta.url), "utf8");

    for (const route of ["today/*", "work/*", "areas/*", "more/*", "account/*"]) {
      expect(source).toContain(`"${route}"`);
    }
  });
});
