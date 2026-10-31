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
import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ClassPracticeService } from "./class-practice.service.js";
let ClassPracticeController = class ClassPracticeController {
    practice;
    constructor(practice) {
        this.practice = practice;
    }
    writable(req) {
        const world = req.executionEnvironmentView;
        if (world?.mode === "simulation" && (world.unavailable || ["completed", "stopped"].includes(world.run_status ?? "")))
            throw new ForbiddenException("This simulation has ended or is unavailable. Practice is read-only.");
    }
    list(req, classId, page) { return this.practice.list(req.authUser, classId, page); }
    publish(req, body) { this.writable(req); return this.practice.publish(req.authUser, body); }
    detail(req, id, classId, page, studentId) { return this.practice.detail(req.authUser, id, classId, page, studentId); }
    note(req, id, body) { this.writable(req); return this.practice.note(req.authUser, id, body, true); }
};
__decorate([
    Get("/"),
    __param(0, Req()),
    __param(1, Query("class_section_id")),
    __param(2, Query("page")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ClassPracticeController.prototype, "list", null);
__decorate([
    Post("/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ClassPracticeController.prototype, "publish", null);
__decorate([
    Get(":id/"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("class_section_id")),
    __param(3, Query("page")),
    __param(4, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], ClassPracticeController.prototype, "detail", null);
__decorate([
    Post(":id/notes/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ClassPracticeController.prototype, "note", null);
ClassPracticeController = __decorate([
    Controller("api/v1/learning/practice"),
    __metadata("design:paramtypes", [ClassPracticeService])
], ClassPracticeController);
export { ClassPracticeController };
//# sourceMappingURL=class-practice.controller.js.map