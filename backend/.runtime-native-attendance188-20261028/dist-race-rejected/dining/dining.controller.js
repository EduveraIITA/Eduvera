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
import { Controller, Get, Post, Req, Param, Query, HttpCode, } from "@nestjs/common";
import { z } from "zod";
import { DiningService } from "./dining.service.js";
let DiningController = class DiningController {
    dining;
    constructor(dining) {
        this.dining = dining;
    }
    recoverPlan(r, s, id) {
        return this.dining.recoverPlan(r.authUser, z.uuid().parse(s), z.uuid().parse(id), r.body);
    }
    availability(r, s, q) {
        return this.dining.availability(r.authUser, z.uuid().parse(s), q);
    }
    savePlan(r, s) {
        return this.dining.savePlan(r.authUser, z.uuid().parse(s), r.body);
    }
    plans(r, s, q) {
        return this.dining.plans(r.authUser, z.uuid().parse(s), q);
    }
    plan(r, s, id, q) {
        return this.dining.plan(r.authUser, z.uuid().parse(s), z.uuid().parse(id), q);
    }
    publishPlan(r, s, id) {
        return this.dining.publishPlan(r.authUser, z.uuid().parse(s), z.uuid().parse(id), r.body);
    }
    revisePlan(r, s, id) {
        return this.dining.revisePlan(r.authUser, z.uuid().parse(s), z.uuid().parse(id), r.body);
    }
    stopPlan(r, s, id) {
        return this.dining.stopPlan(r.authUser, z.uuid().parse(s), z.uuid().parse(id), r.body);
    }
    preview(r, s, id, q) {
        return this.dining.planOccurrences(r.authUser, z.uuid().parse(s), z.uuid().parse(id), q, true);
    }
    occurrences(r, s, id, q) {
        return this.dining.planOccurrences(r.authUser, z.uuid().parse(s), z.uuid().parse(id), q);
    }
    planDate(r, s, series, date) {
        return this.dining.planDate(r.authUser, z.uuid().parse(s), z.uuid().parse(series), date);
    }
    actPlanDate(r, s, series, date) {
        return this.dining.actPlanDate(r.authUser, z.uuid().parse(s), z.uuid().parse(series), date, r.body);
    }
    workspace(r, s, q) {
        return this.dining.workspace(r.authUser, z.uuid().parse(s), q);
    }
    options(r, s, q) {
        return this.dining.options(r.authUser, z.uuid().parse(s), q);
    }
    saveService(r, s) {
        return this.dining.saveService(r.authUser, z.uuid().parse(s), r.body);
    }
    service(r, s, id, q) {
        return this.dining.service(r.authUser, z.uuid().parse(s), z.uuid().parse(id), q);
    }
    createSession(r, s) {
        return this.dining.createSession(r.authUser, z.uuid().parse(s), r.body);
    }
    detail(r, s, id, q) {
        return this.dining.detail(r.authUser, z.uuid().parse(s), z.uuid().parse(id), q);
    }
    act(r, s, id) {
        return this.dining.act(r.authUser, z.uuid().parse(s), z.uuid().parse(id), r.body);
    }
    reportIssue(r, s, id) {
        return this.dining.reportIssue(r.authUser, z.uuid().parse(s), z.uuid().parse(id), r.body);
    }
    issue(r, s, id, q) {
        return this.dining.issueDetail(r.authUser, z.uuid().parse(s), z.uuid().parse(id), q);
    }
    actIssue(r, s, id) {
        return this.dining.actIssue(r.authUser, z.uuid().parse(s), z.uuid().parse(id), r.body);
    }
    confirmation(r, s, id, command) {
        return this.dining.confirmation(r.authUser, z.uuid().parse(s), z.uuid().parse(id), z.uuid().parse(command));
    }
};
__decorate([
    Post("plans/:id/recover"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "recoverPlan", null);
__decorate([
    Get("availability"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "availability", null);
__decorate([
    Post("plans"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "savePlan", null);
__decorate([
    Get("plans"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "plans", null);
__decorate([
    Get("plans/:id"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "plan", null);
__decorate([
    Post("plans/:id/publish"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "publishPlan", null);
__decorate([
    Post("plans/:id/revise"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "revisePlan", null);
__decorate([
    Post("plans/:id/stop"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "stopPlan", null);
__decorate([
    Get("plans/:id/preview"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "preview", null);
__decorate([
    Get("plans/:id/occurrences"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "occurrences", null);
__decorate([
    Get("plans/:series/dates/:date"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("series")),
    __param(3, Param("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "planDate", null);
__decorate([
    Post("plans/:series/dates/:date/actions"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("series")),
    __param(3, Param("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "actPlanDate", null);
__decorate([
    Get("workspace"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "workspace", null);
__decorate([
    Get("options"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "options", null);
__decorate([
    Post("services"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "saveService", null);
__decorate([
    Get("services/:id"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "service", null);
__decorate([
    Post("sessions"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "createSession", null);
__decorate([
    Get("sessions/:id"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "detail", null);
__decorate([
    Post("sessions/:id/actions"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "act", null);
__decorate([
    Post("sessions/:id/issues"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "reportIssue", null);
__decorate([
    Get("issues/:id"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "issue", null);
__decorate([
    Post("issues/:id/actions"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "actIssue", null);
__decorate([
    Get("confirmation"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("source_id")),
    __param(3, Query("command_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], DiningController.prototype, "confirmation", null);
DiningController = __decorate([
    Controller("api/v1/schools/:schoolId/dining"),
    __metadata("design:paramtypes", [DiningService])
], DiningController);
export { DiningController };
//# sourceMappingURL=dining.controller.js.map