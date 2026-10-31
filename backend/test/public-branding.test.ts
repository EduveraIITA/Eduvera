import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { FastifyReply } from "fastify";
import { SpaController } from "../src/spa.controller.js";
import { invitationLogo } from "../src/common/invitation-logo.js";
import { readThatCampusWordmark, thatCampusWordmark } from "../src/common/brand-assets.js";
import * as configuration from "../src/config.js";

const repositoryRoot = resolve(process.cwd(), "..");
const legacyBrand = /\b(?:OmniSchool|Eduvera|Eduera|Edura|Edera|Educera)\b/g;
const sourceExtensions = new Set([".html", ".json", ".py", ".ts", ".tsx", ".webmanifest"]);

const publicSurfaceRoots = [
  "frontend/index.html",
  "frontend/public/manifest.webmanifest",
  "frontend/src",
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

  it("keeps the approved name on sign-in and the tagline on descriptive identity surfaces", () => {
    const auth = readFileSync(resolve(repositoryRoot, "frontend/src/features/auth/AuthPages.tsx"), "utf8");
    const manifest = readFileSync(resolve(repositoryRoot, "frontend/public/manifest.webmanifest"), "utf8");
    const invitations = readFileSync(resolve(repositoryRoot, "backend/src/common/invitation-template.ts"), "utf8");
    for (const source of [auth, manifest, invitations]) {
      expect(source).toContain("ThatCampus");
    }
    // Compact sign-in deliberately uses the shared wordmark without adding a
    // repeated marketing line above the user's task.
    expect(auth).toContain("<BrandLogo");
    for (const source of [manifest, invitations]) expect(source).toContain("Not just any campus. That campus.");
  });

  it("uses the supplied ThatCampus mark on app and install surfaces", () => {
    const brand = readFileSync(resolve(repositoryRoot, "frontend/src/features/school/SchoolBrand.tsx"), "utf8");
    const suppliedMark = readFileSync(resolve(repositoryRoot, "frontend/src/components/BrandLogo.tsx"), "utf8");
    const mobileDocument = readFileSync(resolve(repositoryRoot, "frontend/index.html"), "utf8");
    const manifest = readFileSync(resolve(repositoryRoot, "frontend/public/manifest.webmanifest"), "utf8");
    expect(brand).toContain('import { BrandLogo } from "../../components/BrandLogo"');
    expect(brand).toContain("<BrandLogo");
    expect(suppliedMark).toContain('/assets/thatcampus-wordmark-light-v3.png');
    expect(suppliedMark).toContain('/assets/thatcampus-wordmark-dark-v3.png');
    expect(suppliedMark).not.toMatch(/feColorMatrix|feComponentTransfer|brand-dark-filter/);
    expect(mobileDocument).toContain("/icons/thatcampus-favicon-light-v3.png");
    expect(mobileDocument).toContain("/icons/thatcampus-favicon-dark-v3.png");
    expect(mobileDocument).toContain('href="/icons/thatcampus-touch-v4.png"');
    expect(mobileDocument).toContain('href="/icons/manifest-v4.webmanifest"');
    expect(mobileDocument).not.toContain('thatcampus-touch-${resolved}');
    expect(mobileDocument).not.toContain('manifest-${resolved}');
    expect(manifest).toContain("/icons/thatcampus-icon-192-v4.png");
    expect(manifest).toContain("/icons/thatcampus-icon-512-v4.png");
    for (const path of [
      "frontend/public/manifest.webmanifest",
      "frontend/public/icons/manifest-light-v3.webmanifest",
      "frontend/public/icons/manifest-dark-v3.webmanifest",
      "frontend/public/icons/manifest-v4.webmanifest",
    ]) {
      const install = JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as {
        id: string; start_url: string; scope: string; icons: Array<{ src: string }>;
      };
      expect(install.id).toBe("/");
      expect(install.start_url).toBe("/");
      expect(install.scope).toBe("/");
      expect(install.icons.map(icon => icon.src)).toEqual([
        "/icons/thatcampus-icon-192-v4.png", "/icons/thatcampus-icon-512-v4.png",
      ]);
    }
    for (const path of [
      "frontend/public/assets/thatcampus-logo.png",
      "frontend/public/assets/thatcampus-logo-light.png",
      "frontend/public/assets/thatcampus-logo-dark.png",
      "frontend/public/assets/thatcampus-wordmark-light-v3.png",
      "frontend/public/assets/thatcampus-wordmark-dark-v3.png",
      "frontend/public/favicon.png",
      "frontend/public/favicon-dark.png",
      "frontend/public/apple-touch-icon.png",
      "frontend/public/icon-192.png",
      "frontend/public/icon-512.png",
      "frontend/public/icons/thatcampus-favicon-light-v3.png",
      "frontend/public/icons/thatcampus-favicon-dark-v3.png",
      "frontend/public/icons/thatcampus-touch-light-v3.png",
      "frontend/public/icons/thatcampus-touch-dark-v3.png",
      "frontend/public/icons/thatcampus-icon-192-light-v3.png",
      "frontend/public/icons/thatcampus-icon-192-dark-v3.png",
      "frontend/public/icons/thatcampus-icon-512-light-v3.png",
      "frontend/public/icons/thatcampus-icon-512-dark-v3.png",
      "frontend/public/icons/manifest-light-v3.webmanifest",
      "frontend/public/icons/manifest-dark-v3.webmanifest",
      "frontend/public/icons/manifest-v4.webmanifest",
      "frontend/public/icons/thatcampus-touch-v4.png",
      "frontend/public/icons/thatcampus-icon-192-v4.png",
      "frontend/public/icons/thatcampus-icon-512-v4.png",
      "backend/assets/receipt/thatcampus-logo.png",
      "backend/assets/receipt/thatcampus-wordmark-light-v3.png",
    ]) expect(readFileSync(resolve(repositoryRoot, path)).byteLength).toBeGreaterThan(100);
  });

  it("serves the supplied transparent email wordmark without a built SPA and preserves immutable old email URLs", async () => {
    const expected = readFileSync(resolve(repositoryRoot, "frontend/public/assets/thatcampus-wordmark-light-v3.png"));
    const artwork = await readThatCampusWordmark();
    expect(artwork).toEqual(expected);
    expect(artwork.subarray(1, 4).toString()).toBe("PNG");
    expect(artwork[25]).toBe(6);
    expect(thatCampusWordmark.emailPath).toBe("/email-assets/thatcampus-wordmark-light-v3.png");

    const reply = { header: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis(), send: vi.fn() };
    const controller = new SpaController();
    await controller.emailWordmark(reply as unknown as FastifyReply);
    expect(reply.header).toHaveBeenCalledWith("Cache-Control", "public, max-age=31536000, immutable");
    expect(reply.header).toHaveBeenCalledWith("Content-Disposition", "inline");
    expect(reply.type).toHaveBeenCalledWith("image/png");
    expect(reply.send).toHaveBeenCalledWith(expected);

    const legacyReply = { header: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis(), send: vi.fn() };
    controller.emailLogo(legacyReply as unknown as FastifyReply);
    expect(legacyReply.send).toHaveBeenCalledWith(Buffer.from(invitationLogo.content, "base64"));
    expect(Buffer.from(invitationLogo.content, "base64")).not.toEqual(expected);
  });

  it("serves the matching dark favicon through the public static compatibility route", async () => {
    const settings = vi.spyOn(configuration, "config").mockReturnValue({
      spaDistDir: resolve(repositoryRoot, "frontend/public"),
    } as ReturnType<typeof configuration.config>);
    try {
      const reply = { header: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis(), send: vi.fn() };
      await new SpaController().faviconDarkPng(reply as unknown as FastifyReply);
      expect(reply.type).toHaveBeenCalledWith("image/png");
      expect(reply.header).toHaveBeenCalledWith("Cache-Control", "public, max-age=0");
      expect(reply.send).toHaveBeenCalledWith(readFileSync(resolve(repositoryRoot, "frontend/public/favicon-dark.png")));
    } finally {
      settings.mockRestore();
    }
  });
});
