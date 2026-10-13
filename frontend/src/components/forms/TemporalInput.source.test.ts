import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");
const temporalStyles = readFileSync(join(sourceRoot, "components/forms/temporal-input.css"), "utf8");

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("temporal input adoption", () => {
  it("keeps native date and time controls behind the bounded shared component", () => {
    const rawTemporalInput = /<input\b(?=[^>]*\btype=["'](?:date|time|datetime-local|month|week)["'])/;
    const violations = tsxFiles(sourceRoot)
      .filter((path) => !path.endsWith("TemporalInput.source.test.ts"))
      .filter((path) => rawTemporalInput.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(violations).toEqual([]);
  });

  it("opts out of the iOS menu-list sizing override", () => {
    expect(temporalStyles).toMatch(/-webkit-appearance:\s*none/);
    expect(temporalStyles).toMatch(/appearance:\s*none/);
    expect(temporalStyles).toMatch(/box-sizing:\s*border-box/);
    expect(temporalStyles).toMatch(/min-width:\s*0/);
    expect(temporalStyles).toMatch(/max-width:\s*100%/);
  });
});
