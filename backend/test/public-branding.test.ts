import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "..");
const legacyBrand = /\b(?:OmniSchool|Eduvera|Eduera|Edura|Edera|Educera)\b/g;
const sourceExtensions = new Set([".html", ".json", ".py", ".ts", ".tsx", ".webmanifest"]);

const publicSurfaceRoots = [
  "frontend/index.html",
  "frontend/public/manifest.webmanifest",
  "frontend/src",
  "frontend-desktop/index.html",
  "frontend-desktop/src",
  "backend/src",
  "services/photo-attendance/app",
];

// These values are deployed compatibility contracts, not customer-visible copy.
// Renaming them would break existing inference calls or URLs in already-sent email.
const compatibilityAllowlist = new Map<string, RegExp[]>([
  ["backend/src/photo-attendance/vision-client.ts", [/X-Edura-Inference-Token/g]],
  ["backend/src/common/invitation-logo.ts", [/Legacy Eduvera asset/g]],
]);

function filesAt(path: string): string[] {
  const absolute = resolve(repositoryRoot, path);
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (["dist", "node_modules"].includes(entry.name) || entry.name.includes(".test.")) return [];
    return filesAt(relative(repositoryRoot, resolve(absolute, entry.name)));
  });
}

describe("public ThatCampus branding", () => {
  it("does not reintroduce a retired customer-facing brand", () => {
    const findings: string[] = [];
    for (const file of publicSurfaceRoots.flatMap(filesAt)) {
      if (!sourceExtensions.has(extname(file)) && !file.endsWith(".webmanifest")) continue;
      const repositoryPath = relative(repositoryRoot, file);
      let source = readFileSync(file, "utf8");
      for (const allowed of compatibilityAllowlist.get(repositoryPath) ?? []) source = source.replace(allowed, "");
      for (const match of source.matchAll(legacyBrand)) {
        const line = source.slice(0, match.index).split("\n").length;
        findings.push(`${repositoryPath}:${line}:${match[0]}`);
      }
    }
    expect(findings).toEqual([]);
  });

  it("keeps the approved name and tagline on primary identity surfaces", () => {
    const auth = readFileSync(resolve(repositoryRoot, "frontend/src/features/auth/AuthPages.tsx"), "utf8");
    const manifest = readFileSync(resolve(repositoryRoot, "frontend/public/manifest.webmanifest"), "utf8");
    const invitations = readFileSync(resolve(repositoryRoot, "backend/src/common/invitation-template.ts"), "utf8");
    for (const source of [auth, manifest, invitations]) {
      expect(source).toContain("ThatCampus");
      expect(source).toContain("Not just any campus. That campus.");
    }
  });

  it("uses the supplied ThatCampus mark on app and install surfaces", () => {
    const brand = readFileSync(resolve(repositoryRoot, "frontend/src/features/school/SchoolBrand.tsx"), "utf8");
    const mobileDocument = readFileSync(resolve(repositoryRoot, "frontend/index.html"), "utf8");
    const desktopDocument = readFileSync(resolve(repositoryRoot, "frontend-desktop/index.html"), "utf8");
    const manifest = readFileSync(resolve(repositoryRoot, "frontend/public/manifest.webmanifest"), "utf8");
    expect(brand).toContain("/assets/thatcampus-logo-light.png");
    expect(mobileDocument).toContain("/favicon.png");
    expect(desktopDocument).toContain("/staff/thatcampus-logo-light.png");
    expect(desktopDocument).toContain("/staff/thatcampus-logo-dark.png");
    expect(manifest).toContain("/icon-192.png");
    expect(manifest).toContain("/icon-512.png");
    for (const path of [
      "frontend/public/assets/thatcampus-logo.png",
      "frontend/public/assets/thatcampus-logo-light.png",
      "frontend/public/assets/thatcampus-logo-dark.png",
      "frontend/public/favicon.png",
      "frontend/public/favicon-dark.png",
      "frontend/public/apple-touch-icon.png",
      "frontend/public/icon-192.png",
      "frontend/public/icon-512.png",
      "frontend-desktop/public/thatcampus-logo-light.png",
      "frontend-desktop/public/thatcampus-logo-dark.png",
      "backend/assets/receipt/thatcampus-logo.png",
    ]) expect(readFileSync(resolve(repositoryRoot, path)).byteLength).toBeGreaterThan(100);
  });
});
