import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");
const allowedPlatformAdapters = new Set([
  "campus-view/campus-view.repository.ts",
  "campus-view/campus-view-kpi.repository.ts",
  "campus-scenarios/campus-scenario.repository.ts",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("Campus Model Core persistence boundary", () => {
  it("keeps business domains behind Core ports", () => {
    const violations = sourceFiles(sourceRoot).flatMap((path) => {
      const local = relative(sourceRoot, path);
      if (local.startsWith("campus-model-core/")
        || local.startsWith("database/")
        || allowedPlatformAdapters.has(local)) return [];
      const source = readFileSync(path, "utf8");
      const directSql = /(?:\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?campus_model_[a-z_]+|\b(?:selectFrom|insertInto|updateTable|deleteFrom)\(\s*["'`]campus_model_[a-z_]+["'`]\s*\))/giu;
      return [...source.matchAll(directSql)].map((match) => `${local}: ${match[0]}`);
    });
    expect(violations).toEqual([]);
  });

  it("keeps the remaining cross-domain reads isolated to named projection adapters", () => {
    for (const local of allowedPlatformAdapters) {
      const source = readFileSync(join(sourceRoot, local), "utf8");
      expect(source).toContain("campus_model_");
    }
  });
});
