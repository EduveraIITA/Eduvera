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
import { Controller, Get, Post, Param, Query, Req, Res, HttpCode } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { PeopleImportService } from "./people-import.service.js";
let PeopleImportController = class PeopleImportController {
    imports;
    constructor(imports) {
        this.imports = imports;
    }
    list(req, query) { return this.imports.list(req.authUser, query); }
    stage(req) { return this.imports.stage(req, req.body); }
    async template(req, schoolId, reply) { const csv = await this.imports.template(req.authUser, schoolId); return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="student-import-template.csv"').header("Cache-Control", "no-store").send(csv); }
    detail(req, id, schoolId) { return this.imports.detail(req.authUser, id, schoolId); }
    row(req, id, row) { return this.imports.updateRow(req, id, Number(row), req.body); }
    commit(req, id) { return this.imports.commit(req, id, req.body); }
    cancel(req, id) { return this.imports.cancel(req, id, req.body); }
    async report(req, id, schoolId, reply) { const csv = await this.imports.report(req.authUser, id, schoolId); return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="student-import-report.csv"').header("Cache-Control", "no-store").send(csv); }
};
__decorate([
    Get(),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PeopleImportController.prototype, "list", null);
__decorate([
    Post(),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PeopleImportController.prototype, "stage", null);
__decorate([
    Get("template"),
    __param(0, Req()),
    __param(1, Query("school_id")),
    __param(2, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], PeopleImportController.prototype, "template", null);
__decorate([
    Get(":id"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("school_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], PeopleImportController.prototype, "detail", null);
__decorate([
    Post(":id/rows/:row"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("row")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], PeopleImportController.prototype, "row", null);
__decorate([
    Post(":id/commit"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PeopleImportController.prototype, "commit", null);
__decorate([
    Post(":id/cancel"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PeopleImportController.prototype, "cancel", null);
__decorate([
    Get(":id/report"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("school_id")),
    __param(3, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], PeopleImportController.prototype, "report", null);
PeopleImportController = __decorate([
    ApiTags("people imports"),
    ApiCookieAuth(),
    Controller("api/v1/people/imports"),
    __metadata("design:paramtypes", [PeopleImportService])
], PeopleImportController);
export { PeopleImportController };
//# sourceMappingURL=people-import.controller.js.map