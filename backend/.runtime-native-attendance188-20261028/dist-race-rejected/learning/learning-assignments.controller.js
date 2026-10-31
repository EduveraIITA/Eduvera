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
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import { LearningAssignmentsService } from "./learning-assignments.service.js";
import { attachmentContentDisposition } from "../common/attachment-headers.js";
let LearningAssignmentsController = class LearningAssignmentsController {
    assignments;
    constructor(assignments) {
        this.assignments = assignments;
    }
    list(req, query) { return this.assignments.list(req.authUser, query); }
    create(req, body) { return this.assignments.save(req.authUser, body); }
    save(req, id, body) {
        if (!body || typeof body !== "object" || !("assignment_id" in body) || body.assignment_id !== id)
            throw new BadRequestException("Open the exact assignment before saving.");
        return this.assignments.save(req.authUser, body);
    }
    detail(req, id, studentId, page) { return this.assignments.detail(req.authUser, id, studentId, page); }
    publish(req, id, body) { return this.assignments.publish(req.authUser, id, body); }
    work(req, id, studentId) { return this.assignments.detail(req.authUser, id, studentId); }
    saveWork(req, id, studentId, body) { return this.assignments.saveWork(req.authUser, id, studentId, body); }
    async upload(req, id, studentId) {
        if (!req.isMultipart())
            throw new BadRequestException("Choose one attachment using multipart form data.");
        let upload;
        const body = {};
        for await (const part of req.parts({ limits: { files: 1, fields: 4, fileSize: 5 * 1024 * 1024 } })) {
            if (part.type === "file") {
                if (part.fieldname !== "file" || upload)
                    throw new BadRequestException("Choose one attachment.");
                const data = await part.toBuffer();
                if (part.file.truncated)
                    throw new BadRequestException("Choose a file up to 5 MiB.");
                upload = { filename: part.filename, mimetype: part.mimetype, data };
            }
            else
                body[part.fieldname] = part.fieldname === "expected_revision" ? Number(part.value) : part.value;
        }
        if (!upload)
            throw new BadRequestException("Choose an attachment.");
        return this.assignments.upload(req.authUser, id, studentId, body, upload);
    }
    detach(req, id, studentId, fileId, body) { return this.assignments.detach(req.authUser, id, studentId, fileId, body); }
    async file(req, reply, id, studentId, fileId) {
        const file = await this.assignments.file(req.authUser, id, studentId, fileId);
        reply.type(file.content_type);
        reply.header("Content-Disposition", attachmentContentDisposition(file.original_name));
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Cache-Control", "private, no-store");
        reply.header("X-ThatCampus-Evidence-Mode", file.evidence_mode);
        reply.header("X-ThatCampus-Source-Content-Omitted", String(file.source_content_omitted));
        return reply.send(file.stream);
    }
    submit(req, id, studentId, body) { return this.assignments.submit(req.authUser, id, studentId, body); }
    review(req, id, studentId, body) { return this.assignments.review(req.authUser, id, studentId, body); }
};
__decorate([
    Get("/"),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LearningAssignmentsController.prototype, "list", null);
__decorate([
    Post("/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LearningAssignmentsController.prototype, "create", null);
__decorate([
    Patch(":id/"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], LearningAssignmentsController.prototype, "save", null);
__decorate([
    Get(":id/"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("student_id")),
    __param(3, Query("page")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], LearningAssignmentsController.prototype, "detail", null);
__decorate([
    Post(":id/publish/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], LearningAssignmentsController.prototype, "publish", null);
__decorate([
    Get([":id/work/:studentId/", ":id/people/:studentId/"]),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("studentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], LearningAssignmentsController.prototype, "work", null);
__decorate([
    Put([":id/work/:studentId/", ":id/people/:studentId/"]),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("studentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], LearningAssignmentsController.prototype, "saveWork", null);
__decorate([
    Post([":id/work/:studentId/files/", ":id/people/:studentId/files/"]),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("studentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], LearningAssignmentsController.prototype, "upload", null);
__decorate([
    Delete([":id/work/:studentId/files/:fileId/", ":id/people/:studentId/files/:fileId/"]),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("studentId")),
    __param(3, Param("fileId")),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], LearningAssignmentsController.prototype, "detach", null);
__decorate([
    Get([":id/work/:studentId/files/:fileId/", ":id/people/:studentId/files/:fileId/"]),
    __param(0, Req()),
    __param(1, Res()),
    __param(2, Param("id")),
    __param(3, Param("studentId")),
    __param(4, Param("fileId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String, String]),
    __metadata("design:returntype", Promise)
], LearningAssignmentsController.prototype, "file", null);
__decorate([
    Post([":id/work/:studentId/submit/", ":id/people/:studentId/submit/"]),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("studentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], LearningAssignmentsController.prototype, "submit", null);
__decorate([
    Post([":id/work/:studentId/review/", ":id/people/:studentId/review/"]),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("studentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], LearningAssignmentsController.prototype, "review", null);
LearningAssignmentsController = __decorate([
    Controller("api/v1/learning/assignments"),
    __metadata("design:paramtypes", [LearningAssignmentsService])
], LearningAssignmentsController);
export { LearningAssignmentsController };
//# sourceMappingURL=learning-assignments.controller.js.map