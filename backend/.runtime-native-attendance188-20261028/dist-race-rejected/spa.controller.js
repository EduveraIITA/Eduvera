var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Res } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Public } from "./common/decorators.js";
import { config } from "./config.js";
import { invitationLogo } from './common/invitation-logo.js';
import { readThatCampusWordmark } from './common/brand-assets.js';
let SpaController = class SpaController {
    async emailWordmark(reply) {
        return reply.header('Cache-Control', 'public, max-age=31536000, immutable')
            .header('Content-Disposition', 'inline').type('image/png').send(await readThatCampusWordmark());
    }
    emailLogo(reply) {
        return reply.header('Cache-Control', 'public, max-age=31536000, immutable')
            .header('Content-Disposition', 'inline').type('image/png').send(Buffer.from(invitationLogo.content, 'base64'));
    }
    async thatCampusEmailLogo(reply) {
        return this.serveAsset(reply, 'assets/thatcampus-logo-light.png', 'image/png');
    }
    async manifest(reply) {
        try {
            const manifest = await readFile(join(config().spaDistDir, "manifest.webmanifest"));
            return reply
                .header("Cache-Control", "public, max-age=0")
                .type("application/manifest+json; charset=utf-8")
                .send(manifest);
        }
        catch {
            return reply.status(404).send();
        }
    }
    async favicon(reply) {
        try {
            const icon = await readFile(join(config().spaDistDir, "favicon.svg"));
            return reply.type("image/svg+xml").send(icon);
        }
        catch {
            return reply.status(404).send();
        }
    }
    async faviconPng(reply) {
        return this.serveAsset(reply, "favicon.png", "image/png");
    }
    async faviconDarkPng(reply) {
        return this.serveAsset(reply, "favicon-dark.png", "image/png");
    }
    async eduraLeafFavicon(reply) {
        return this.serveAsset(reply, "edura-leaf-favicon.png", "image/png");
    }
    async appleTouchIcon(reply) {
        try {
            const icon = await readFile(join(config().spaDistDir, "apple-touch-icon.svg"));
            return reply
                .header("Cache-Control", "public, max-age=0")
                .type("image/svg+xml")
                .send(icon);
        }
        catch {
            return reply.status(404).send();
        }
    }
    async appleTouchIconPng(reply) {
        return this.serveAsset(reply, "apple-touch-icon.png", "image/png");
    }
    async legacyAppleTouchIcon(reply) {
        return this.serveAsset(reply, "apple-touch-icon-edura.png", "image/png");
    }
    async index(reply) {
        return this.serve(reply, config().spaDistDir, "Build the React application before serving the SPA.");
    }
    // Preserve old bookmarks after retiring the separate desktop bundle. The main
    // application is responsive and owns every current staff workflow.
    staff(reply) {
        return reply.redirect("/", 308);
    }
    async serve(reply, dir, detail) {
        try {
            const html = await readFile(join(dir, "index.html"));
            return reply.type("text/html; charset=utf-8").send(html);
        }
        catch {
            return reply.status(503).send({ error: { status: 503, code: "frontend_not_built", detail } });
        }
    }
    async serveAsset(reply, filename, contentType) {
        try {
            const asset = await readFile(join(config().spaDistDir, filename));
            return reply
                .header("Cache-Control", "public, max-age=0")
                .type(contentType)
                .send(asset);
        }
        catch {
            return reply.status(404).send();
        }
    }
};
__decorate([
    Public(),
    Get('email-assets/thatcampus-wordmark-light-v3.png'),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SpaController.prototype, "emailWordmark", null);
__decorate([
    Public(),
    Get(['email-assets/thatcampus-logo-v2.png', 'email-assets/eduera-logo-v1.png']),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SpaController.prototype, "emailLogo", null);
__decorate([
    Public(),
    Get('email-assets/thatcampus-logo.png'),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SpaController.prototype, "thatCampusEmailLogo", null);
__decorate([
    Public(),
    Get("manifest.webmanifest"),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SpaController.prototype, "manifest", null);
__decorate([
    Public(),
    Get("favicon.svg"),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SpaController.prototype, "favicon", null);
__decorate([
    Public(),
    Get("favicon.png"),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SpaController.prototype, "faviconPng", null);
__decorate([
    Public(),
    Get("favicon-dark.png"),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SpaController.prototype, "faviconDarkPng", null);
__decorate([
    Public(),
    Get("edura-leaf-favicon.png"),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SpaController.prototype, "eduraLeafFavicon", null);
__decorate([
    Public(),
    Get("apple-touch-icon.svg"),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SpaController.prototype, "appleTouchIcon", null);
__decorate([
    Public(),
    Get("apple-touch-icon.png"),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SpaController.prototype, "appleTouchIconPng", null);
__decorate([
    Public(),
    Get("apple-touch-icon-edura.png"),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SpaController.prototype, "legacyAppleTouchIcon", null);
__decorate([
    Public(),
    Get([
        "/",
        "login",
        "signup",
        "forgot-password",
        "reset-password",
        "demo",
        "company",
        "company/*",
        "join",
        "launcher",
        "workspace",
        "account/*",
        "onboarding/*",
        "today",
        "today/*",
        "work",
        "work/*",
        "areas",
        "areas/*",
        "more",
        "more/*",
        "gate",
        "gate/*",
        "parent",
        "parent/*",
        "student",
        "student/*",
        "teacher",
        "teacher/*",
        "principal",
        "principal/*",
    ]),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SpaController.prototype, "index", null);
__decorate([
    Public(),
    Get(["staff", "staff/*"]),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SpaController.prototype, "staff", null);
SpaController = __decorate([
    Controller()
], SpaController);
export { SpaController };
//# sourceMappingURL=spa.controller.js.map