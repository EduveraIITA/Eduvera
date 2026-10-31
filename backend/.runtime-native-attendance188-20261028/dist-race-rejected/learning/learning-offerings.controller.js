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
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { LearningOfferingsService } from "./learning-offerings.service.js";
let LearningOfferingsController = class LearningOfferingsController {
    offerings;
    constructor(offerings) {
        this.offerings = offerings;
    }
    list(req, query) { return this.offerings.list(req.authUser, query); }
    create(req, body) { return this.offerings.create(req.authUser, body); }
    detail(req, id) { return this.offerings.detail(req.authUser, id); }
    confirmation(req, id, commandId, action) { return this.offerings.confirmation(req.authUser, id, commandId, action); }
    enroll(req, id, body) { return this.offerings.enroll(req.authUser, id, body); }
    endEnrollment(req, id, recordId, body) { return this.offerings.endEnrollment(req.authUser, id, recordId, body); }
    appoint(req, id, body) { return this.offerings.appointInstructor(req.authUser, id, body); }
    endInstructor(req, id, recordId, body) { return this.offerings.endInstructor(req.authUser, id, recordId, body); }
};
__decorate([
    Get("/"),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LearningOfferingsController.prototype, "list", null);
__decorate([
    Post("/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LearningOfferingsController.prototype, "create", null);
__decorate([
    Get(":id/"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], LearningOfferingsController.prototype, "detail", null);
__decorate([
    Get(":id/confirmation/"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("command_id")),
    __param(3, Query("action")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], LearningOfferingsController.prototype, "confirmation", null);
__decorate([
    Post(":id/enrollments/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], LearningOfferingsController.prototype, "enroll", null);
__decorate([
    Post(":id/enrollments/:recordId/end/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("recordId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], LearningOfferingsController.prototype, "endEnrollment", null);
__decorate([
    Post(":id/instructors/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], LearningOfferingsController.prototype, "appoint", null);
__decorate([
    Post(":id/instructors/:recordId/end/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("recordId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], LearningOfferingsController.prototype, "endInstructor", null);
LearningOfferingsController = __decorate([
    Controller("api/v1/learning/offerings"),
    __metadata("design:paramtypes", [LearningOfferingsService])
], LearningOfferingsController);
export { LearningOfferingsController };
//# sourceMappingURL=learning-offerings.controller.js.map