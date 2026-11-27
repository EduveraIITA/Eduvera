import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import { expect, it } from "vitest";
import { WEB_ASSET_IMAGE_SOURCES } from "../src/web-assets.js";

it("allows private object-URL photos and campus map tiles in the production image directive", async () => {
  const server = Fastify();
  try {
    await server.register(helmet, { contentSecurityPolicy: { directives: { imgSrc: WEB_ASSET_IMAGE_SOURCES } } });
    server.get("/", () => ({ ready: true }));
    const response = await server.inject({ method: "GET", url: "/" });
    const policy = String(response.headers["content-security-policy"]);
    expect(policy.split(";")).toContain("img-src 'self' data: blob: https://tile.openstreetmap.org");
    for (const directive of policy.split(";").filter(value => !value.startsWith("img-src ")))
      expect(directive).not.toContain("blob:");
    const bootstrap = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(bootstrap).toContain("imgSrc: WEB_ASSET_IMAGE_SOURCES");
  } finally { await server.close(); }
});
