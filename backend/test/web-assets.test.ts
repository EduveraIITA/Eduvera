import Fastify from "fastify";
import helmet from "@fastify/helmet";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerWebAssets, WEB_ASSET_SCRIPT_SOURCES } from "../src/web-assets.js";

describe("packaged universal web delivery", () => {
  it("serves Expo JavaScript, CanvasKit WASM, fonts and retained public icons with their actual MIME types", async () => {
    const directory = await mkdtemp(join(tmpdir(), "thatcampus-web-assets-")), server = Fastify();
    try {
      await writeFile(join(directory, "index.html"), "<!doctype html><div id=\"root\"></div>");
      for (const name of ["_expo/static/js/web", "skia", "assets/fonts", "icons"]) await mkdir(join(directory, name), { recursive: true });
      await writeFile(join(directory, "_expo/static/js/web/entry.abcdef123456.js"), "globalThis.campusLoaded=true;");
      const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
      await writeFile(join(directory, "skia/canvaskit-0.41.0-abcdef123456.wasm"), wasm);
      await writeFile(join(directory, "assets/fonts/campus.ttf"), "font-fixture");
      await writeFile(join(directory, "icons/campus.png"), "icon-fixture");
      await registerWebAssets(server, directory);
      const script = await server.inject("/_expo/static/js/web/entry.abcdef123456.js");
      expect(script.statusCode).toBe(200); expect(script.headers["content-type"]).toContain("javascript");
      expect(script.body).toBe("globalThis.campusLoaded=true;");
      const module = await server.inject("/skia/canvaskit-0.41.0-abcdef123456.wasm");
      expect(module.statusCode).toBe(200); expect(module.headers["content-type"]).toBe("application/wasm");
      expect(module.rawPayload).toEqual(wasm);
      expect((await server.inject("/assets/fonts/campus.ttf")).headers["content-type"]).toContain("font/ttf");
      expect((await server.inject("/icons/campus.png")).headers["content-type"]).toContain("image/png");
    } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("keeps source maps, hidden files, missing assets and non-public roots outside the asset boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "thatcampus-web-assets-")), server = Fastify();
    try {
      await writeFile(join(directory, "index.html"), "campus-shell");
      await mkdir(join(directory, "_expo")); await mkdir(join(directory, "skia"));
      await writeFile(join(directory, "_expo/entry.js.map"), "private source map");
      await writeFile(join(directory, "_expo/.private"), "private metadata");
      await writeFile(join(directory, "secret.txt"), "outside public asset directories");
      await registerWebAssets(server, directory);
      server.get("/api/v1/private", (_request, reply) => reply.code(401).send({ code: "unauthorized" }));
      for (const url of ["/_expo/entry.js.map", "/_expo/.private", "/skia/missing.wasm", "/secret.txt", "/api/v1/missing"]) {
        const response = await server.inject(url); expect(response.statusCode, url).toBe(404);
        expect(response.body).not.toContain("campus-shell"); expect(response.body).not.toContain("private source map");
      }
      expect((await server.inject("/skia/")).statusCode).toBe(403); // No directory listing.
      expect((await server.inject("/api/v1/private")).statusCode).toBe(401);
      expect((await server.inject("/_expo/%2e%2e/secret.txt")).statusCode).toBe(404);
    } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("can start the API without a web export and without optional legacy asset directories", async () => {
    const directory = await mkdtemp(join(tmpdir(), "thatcampus-web-assets-")), server = Fastify();
    try {
      await registerWebAssets(server, directory);
      server.get("/healthz", () => ({ status: "ok" }));
      expect((await server.inject("/healthz")).statusCode).toBe(200);
      expect((await server.inject("/skia/missing.wasm")).statusCode).toBe(404);
    } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("allows same-origin WebAssembly without permitting JavaScript eval or untrusted script schemes", async () => {
    const server = Fastify();
    try {
      await server.register(helmet, { contentSecurityPolicy: { directives: { scriptSrc: [...WEB_ASSET_SCRIPT_SOURCES] } } });
      server.get("/", () => "campus-shell");
      const policy = String((await server.inject("/")).headers["content-security-policy"]);
      const script = policy.split(";").find(value => value.startsWith("script-src "))!;
      expect(script).toBe("script-src 'self' 'wasm-unsafe-eval'");
      expect(script).not.toContain("'unsafe-eval'"); expect(script).not.toContain("blob:"); expect(script).not.toContain("data:");
      const bootstrap = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
      expect(bootstrap).toContain("scriptSrc: [...WEB_ASSET_SCRIPT_SOURCES");
      expect(bootstrap).toContain("await registerWebAssets(server, settings.spaDistDir)");
    } finally { await server.close(); }
  });
});
