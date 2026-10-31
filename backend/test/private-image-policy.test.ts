import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import { expect, it } from "vitest";
import { PRIVATE_IMAGE_SOURCES } from "../src/common/attachment-headers.js";

it("allows private object-URL photos in production without permitting blob scripts or frames", async () => {
  const server = Fastify();
  try {
    await server.register(helmet, { contentSecurityPolicy: { directives: { imgSrc: PRIVATE_IMAGE_SOURCES } } });
    server.get("/", () => ({ ready: true }));
    const response = await server.inject({ method: "GET", url: "/" });
    const policy = String(response.headers["content-security-policy"]);
    expect(policy.split(";")).toContain("img-src 'self' data: blob:");
    for (const directive of policy.split(";").filter(value => !value.startsWith("img-src ")))
      expect(directive).not.toContain("blob:");
    const bootstrap = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(bootstrap).toContain("imgSrc: PRIVATE_IMAGE_SOURCES");
  } finally { await server.close(); }
});
