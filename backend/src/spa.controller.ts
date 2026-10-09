import { Controller, Get, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Public } from "./common/decorators.js";
import { config } from "./config.js";
import { invitationLogo } from './common/invitation-logo.js';

@Controller()
export class SpaController {
  @Public()
  @Get('email-assets/eduera-logo-v1.png')
  emailLogo(@Res() reply: FastifyReply) {
    return reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('Content-Disposition', 'inline').type('image/png').send(Buffer.from(invitationLogo.content, 'base64'));
  }

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
  @Get("favicon.png")
  async faviconPng(@Res() reply: FastifyReply) {
    return this.serveAsset(reply, "favicon.png", "image/png");
  }

  @Public()
  @Get("edura-leaf-favicon.png")
  async eduraLeafFavicon(@Res() reply: FastifyReply) {
    return this.serveAsset(reply, "edura-leaf-favicon.png", "image/png");
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
  @Get("apple-touch-icon.png")
  async appleTouchIconPng(@Res() reply: FastifyReply) {
    return this.serveAsset(reply, "apple-touch-icon.png", "image/png");
  }

  @Public()
  @Get("apple-touch-icon-edura.png")
  async appleTouchIconEdura(@Res() reply: FastifyReply) {
    return this.serveAsset(reply, "apple-touch-icon-edura.png", "image/png");
  }

  @Public()
  @Get(["/", "login", "signup", "company", "company/*", "join", "launcher", "workspace", "parent", "parent/*", "student", "student/*", "teacher", "teacher/*", "principal", "principal/*", "onboarding/*"])
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

  private async serveAsset(reply: FastifyReply, filename: string, contentType: string) {
    try {
      const asset = await readFile(join(config().spaDistDir, filename));
      return reply
        .header("Cache-Control", "public, max-age=0")
        .type(contentType)
        .send(asset);
    } catch {
      return reply.status(404).send();
    }
  }
}
