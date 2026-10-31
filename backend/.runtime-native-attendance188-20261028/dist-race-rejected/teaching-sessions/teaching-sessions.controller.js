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
import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { attachmentContentDisposition } from "../common/attachment-headers.js";
import { TeachingSessionsService } from "./teaching-sessions.service.js";
let TeachingSessionsController = class TeachingSessionsController {
    sessions;
    constructor(sessions) {
        this.sessions = sessions;
    }
    writable(req) {
        const world = req.executionEnvironmentView;
        if (world?.mode === "simulation" && (world.unavailable || ["completed", "stopped"].includes(world.run_status ?? "")))
            throw new ForbiddenException("This Simulation is read-only. The recorded lesson remains available.");
    }
    list(req, date, page) {
        return this.sessions.list(req.authUser, date, page);
    }
    open(req, date, query) {
        return this.sessions.open(req.authUser, date, query, query.history_page);
    }
    detail(req, id, date, page) {
        return this.sessions.detail(req.authUser, id, date, page);
    }
    workOptions(req, id, date, page) {
        if (!this.sessions.work)
            throw new ForbiddenException("This learning-work adapter is unavailable.");
        return this.sessions.work.options(req.authUser, id, date, page);
    }
    work(req, id, date, body) {
        this.writable(req);
        if (!this.sessions.work)
            throw new ForbiddenException("This learning-work adapter is unavailable.");
        return this.sessions.work.link(req.authUser, id, date, body);
    }
    save(req, id, date, body) {
        this.writable(req);
        return this.sessions.save(req.authUser, id, date, body);
    }
    material(req, id, date, body) {
        this.writable(req);
        return this.sessions.materials.add(req.authUser, id, date, body);
    }
    async upload(req, id, date) {
        this.writable(req);
        if (!req.isMultipart())
            throw new BadRequestException("Choose one file using multipart form data.");
        const body = {};
        let upload;
        for await (const part of req.parts({ limits: { files: 1, fields: 8, fileSize: 5 * 1024 * 1024 } })) {
            if (part.type === "file") {
                if (part.fieldname !== "file" || upload)
                    throw new BadRequestException("Choose one class resource file.");
                const data = await part.toBuffer();
                if (part.file.truncated)
                    throw new BadRequestException("Choose a file up to 5 MiB.");
                upload = { filename: part.filename, mimetype: part.mimetype, data };
            }
            else {
                if (Object.hasOwn(body, part.fieldname))
                    throw new BadRequestException("Use each resource field once.");
                body[part.fieldname] = part.fieldname === "expected_revision" ? Number(part.value)
                    : part.fieldname === "shared" ? part.value === "true" ? true : part.value === "false" ? false : part.value
                        : part.fieldname === "replaces_material_id" && part.value === "" ? null : part.value;
            }
        }
        if (!upload)
            throw new BadRequestException("Choose a file.");
        return this.sessions.materials.upload(req.authUser, id, date, body, upload);
    }
    async file(req, reply, id, materialId, date) {
        const file = await this.sessions.materials.file(req.authUser, id, date, materialId);
        reply.type(file.content_type).header("Content-Disposition", attachmentContentDisposition(file.original_name))
            .header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff")
            .header("X-ThatCampus-Evidence-Mode", file.evidence_mode).header("X-ThatCampus-Source-Content-Omitted", String(file.source_content_omitted));
        return reply.send(file.stream);
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __param(1, Query("date")),
    __param(2, Query("page")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], TeachingSessionsController.prototype, "list", null);
__decorate([
    Get("open"),
    __param(0, Req()),
    __param(1, Query("date")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], TeachingSessionsController.prototype, "open", null);
__decorate([
    Get(":id"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("date")),
    __param(3, Query("history_page")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], TeachingSessionsController.prototype, "detail", null);
__decorate([
    Get(":id/work-options"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("date")),
    __param(3, Query("page")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], TeachingSessionsController.prototype, "workOptions", null);
__decorate([
    Post(":id/work"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("date")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], TeachingSessionsController.prototype, "work", null);
__decorate([
    Put(":id/lesson"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("date")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], TeachingSessionsController.prototype, "save", null);
__decorate([
    Post(":id/materials"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("date")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], TeachingSessionsController.prototype, "material", null);
__decorate([
    Post(":id/materials/files"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], TeachingSessionsController.prototype, "upload", null);
__decorate([
    Get(":id/materials/:materialId/file"),
    __param(0, Req()),
    __param(1, Res()),
    __param(2, Param("id")),
    __param(3, Param("materialId")),
    __param(4, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String, String]),
    __metadata("design:returntype", Promise)
], TeachingSessionsController.prototype, "file", null);
TeachingSessionsController = __decorate([
    Controller("api/v1/learning/sessions"),
    __metadata("design:paramtypes", [TeachingSessionsService])
], TeachingSessionsController);
export { TeachingSessionsController };
//# sourceMappingURL=teaching-sessions.controller.js.map