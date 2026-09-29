import { Controller, Get, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Public } from "./common/decorators.js";
import { config } from "./config.js";

@Controller()
export class SpaController {
  @Public()
  @Get("manifest.webmanifest")
  async manifest(@Res() reply: FastifyReply) {
    try {
      const manifest = await readFile(join(config().spaDistDir, "manifest.webmanifest"));
      return reply
        .header("Cache-Control", "public, max-age=0")
        .type("application/manifest+json; charset=utf-8")
        .send(manifest);
    } catch {
      return reply.status(404).send();
    }
  }

  @Public()
  @Get("favicon.svg")
  async favicon(@Res() reply: FastifyReply) {
    try {
      const icon = await readFile(join(config().spaDistDir, "favicon.svg"));
      return reply.type("image/svg+xml").send(icon);
    } catch {
      return reply.status(404).send();
    }
  }

  @Public()
  @Get("apple-touch-icon.svg")
  async appleTouchIcon(@Res() reply: FastifyReply) {
    try {
      const icon = await readFile(join(config().spaDistDir, "apple-touch-icon.svg"));
      return reply
        .header("Cache-Control", "public, max-age=0")
        .type("image/svg+xml")
        .send(icon);
    } catch {
      return reply.status(404).send();
    }
  }

  @Public()
  @Get(["/", "login", "signup", "launcher", "workspace", "parent", "parent/*", "student", "student/*", "teacher", "teacher/*", "principal", "principal/*", "onboarding/*"])
  async index(@Res() reply: FastifyReply) {
    return this.serve(reply, config().spaDistDir, "Build the React application before serving the SPA.");
  }

  // Desktop staff console, built with base "/staff/". Same origin, same session.
  @Public()
  @Get(["staff", "staff/*"])
  async staff(@Res() reply: FastifyReply) {
    return this.serve(reply, config().staffDistDir, "Build the desktop dashboard before serving /staff.");
  }

  private async serve(reply: FastifyReply, dir: string, detail: string) {
    try {
      const html = await readFile(join(dir, "index.html"));
      return reply.type("text/html; charset=utf-8").send(html);
    } catch {
      return reply.status(503).send({ error: { status: 503, code: "frontend_not_built", detail } });
    }
  }
}
