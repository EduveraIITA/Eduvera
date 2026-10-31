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
import { RequirePermission } from "../roles/permissions.js";
import { Controller, Get, Post, Param, Query, Req, HttpCode, } from "@nestjs/common";
import { DayPlanService } from "./day-plan.service.js";
let DayPlanController = class DayPlanController {
    plans;
    constructor(plans) {
        this.plans = plans;
    }
    options(req, school, date) {
        return this.plans.options(req.authUser, school, date);
    }
    teacher(req, school, date) {
        return this.plans.teacher(req.authUser, school, date);
    }
    teacherSummary(req, school, start, end) {
        return this.plans.teacherSummary(req.authUser, school, start, end);
    }
    adminSummary(req, school, start, end, classSectionId) {
        return this.plans.adminSummary(req.authUser, school, start, end, classSectionId);
    }
    detail(req, id, school) {
        return this.plans.detail(req.authUser, id, school);
    }
    start(req) {
        return this.plans.start(req, req.body);
    }
    save(req, id) {
        return this.plans.save(req, id, req.body);
    }
    publish(req, id) {
        return this.plans.publish(req, id, req.body);
    }
    discard(req, id) {
        return this.plans.discard(req, id, req.body);
    }
    respond(req, id) {
        return this.plans.respond(req, id, req.body);
    }
};
__decorate([
    RequirePermission("timetable.view"),
    Get("options"),
    __param(0, Req()),
    __param(1, Query("school_id")),
    __param(2, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], DayPlanController.prototype, "options", null);
__decorate([
    RequirePermission("timetable.view"),
    Get("teacher"),
    __param(0, Req()),
    __param(1, Query("school_id")),
    __param(2, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], DayPlanController.prototype, "teacher", null);
__decorate([
    RequirePermission("timetable.view"),
    Get("teacher/summary"),
    __param(0, Req()),
    __param(1, Query("school_id")),
    __param(2, Query("start")),
    __param(3, Query("end")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], DayPlanController.prototype, "teacherSummary", null);
__decorate([
    Get("admin/summary"),
    __param(0, Req()),
    __param(1, Query("school_id")),
    __param(2, Query("start")),
    __param(3, Query("end")),
    __param(4, Query("class_section_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], DayPlanController.prototype, "adminSummary", null);
__decorate([
    RequirePermission("timetable.view"),
    Get(":id"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("school_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], DayPlanController.prototype, "detail", null);
__decorate([
    Post(),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DayPlanController.prototype, "start", null);
__decorate([
    Post(":id/save"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DayPlanController.prototype, "save", null);
__decorate([
    Post(":id/publish"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DayPlanController.prototype, "publish", null);
__decorate([
    Post(":id/discard"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DayPlanController.prototype, "discard", null);
__decorate([
    RequirePermission("dayplans.respond"),
    Post("periods/:id/respond"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DayPlanController.prototype, "respond", null);
DayPlanController = __decorate([
    Controller("api/v1/day-plans"),
    __metadata("design:paramtypes", [DayPlanService])
], DayPlanController);
export { DayPlanController };
//# sourceMappingURL=day-plan.controller.js.map