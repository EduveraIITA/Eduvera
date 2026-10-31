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
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import { RequirePermission } from "../roles/permissions.js";
import { GateService } from "./gate.service.js";
let GateController = class GateController {
    service;
    constructor(service) {
        this.service = service;
    }
    approvals(r) { return this.service.approvals(r.authUser); }
    workspace(r, s, page, filter, visitorId) {
        return this.service.workspace(r.authUser, s, { visitor_page: page, visitor_filter: filter, visitor_id: visitorId });
    }
    students(r, s, q = '') { return this.service.students(r.authUser, s, q); }
    student(r, s, id) { return this.service.student(r.authUser, s, id); }
    staff(r, s, q = '') { return this.service.staff(r.authUser, s, q); }
    staffProfile(r, s, id) { return this.service.staffProfile(r.authUser, s, id); }
    scan(r, s, b) { return this.service.scan(r.authUser, s, b); }
    movement(r, s, b) { return this.service.movement(r.authUser, s, b); }
    staffMovement(r, s, b) { return this.service.staffMovement(r.authUser, s, b); }
    pass(r, s, b) { return this.service.issuePass(r.authUser, s, b); }
    async visitor(r, s, b) {
        if (!r.isMultipart())
            return this.service.visitor(r.authUser, s, b);
        const body = {};
        let upload;
        for await (const part of r.parts({ limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 8 } })) {
            if (part.type === 'file') {
                if (part.fieldname !== 'photo' || upload)
                    throw new BadRequestException('Attach one visitor photo.');
                upload = { data: await part.toBuffer(), mimetype: part.mimetype };
            }
            else
                body[part.fieldname] = part.value;
        }
        return this.service.visitor(r.authUser, s, body, upload);
    }
    async photo(r, reply, s, id) {
        const photo = await this.service.visitorPhoto(r.authUser, s, id);
        reply.type(photo.type).header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').header('Content-Disposition', 'inline');
        reply.header('X-ThatCampus-Evidence-Mode', photo.evidence_mode).header('X-ThatCampus-Source-Content-Omitted', String(photo.source_content_omitted));
        return reply.send(photo.stream);
    }
    visitorAction(r, s, id, a, b) { return this.service.visitorAction(r.authUser, s, id, a, b); }
    visitorPass(r, s, id) { return this.service.visitorPass(r.authUser, s, id); }
    gatekeeper(r, s, b) { return this.service.gatekeeper(r.authUser, s, b); }
};
__decorate([
    Get("visitor-approvals/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "approvals", null);
__decorate([
    Get("schools/:schoolId/workspace/"),
    RequirePermission("gate.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("visitor_page")),
    __param(3, Query("visitor_filter")),
    __param(4, Query("visitor_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "workspace", null);
__decorate([
    Get("schools/:schoolId/students/"),
    RequirePermission("gate.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("q")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "students", null);
__decorate([
    Get("schools/:schoolId/students/:studentId/"),
    RequirePermission("gate.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("studentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "student", null);
__decorate([
    Get("schools/:schoolId/staff/"),
    RequirePermission("gate.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("q")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "staff", null);
__decorate([
    Get("schools/:schoolId/staff/:staffId/"),
    RequirePermission("gate.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("staffId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "staffProfile", null);
__decorate([
    Post("schools/:schoolId/scan/"),
    RequirePermission("gate.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "scan", null);
__decorate([
    Post("schools/:schoolId/movements/"),
    RequirePermission("gate.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "movement", null);
__decorate([
    Post("schools/:schoolId/staff-movements/"),
    RequirePermission("gate.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "staffMovement", null);
__decorate([
    Post("schools/:schoolId/passes/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "pass", null);
__decorate([
    Post("schools/:schoolId/visitors/"),
    RequirePermission("gate.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], GateController.prototype, "visitor", null);
__decorate([
    Get("schools/:schoolId/visitors/:id/photo/"),
    __param(0, Req()),
    __param(1, Res()),
    __param(2, Param("schoolId")),
    __param(3, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], GateController.prototype, "photo", null);
__decorate([
    Post("schools/:schoolId/visitors/:id/:action/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Param("action")),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "visitorAction", null);
__decorate([
    Post("schools/:schoolId/visitors/:id/pass/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "visitorPass", null);
__decorate([
    Post("schools/:schoolId/gatekeepers/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], GateController.prototype, "gatekeeper", null);
GateController = __decorate([
    Controller("api/v1/gate"),
    __metadata("design:paramtypes", [GateService])
], GateController);
export { GateController };
//# sourceMappingURL=gate.controller.js.map