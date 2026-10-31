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
import { Controller, Get, Param, Post, Req } from "@nestjs/common";
import { StaffLeaveReviewRoutingService } from "./staff-leave-review-routing.service.js";
let StaffLeaveReviewRoutingController = class StaffLeaveReviewRoutingController {
    routing;
    constructor(routing) {
        this.routing = routing;
    }
    workspace(request, schoolId) {
        return this.routing.workspace(request.authUser, schoolId);
    }
    confirm(request, schoolId) {
        return this.routing.confirm(request.authUser, schoolId, request.body);
    }
};
__decorate([
    Get("/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffLeaveReviewRoutingController.prototype, "workspace", null);
__decorate([
    Post("/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffLeaveReviewRoutingController.prototype, "confirm", null);
StaffLeaveReviewRoutingController = __decorate([
    Controller("api/v1/schools/:schoolId/staff/leave-review-routing"),
    __metadata("design:paramtypes", [StaffLeaveReviewRoutingService])
], StaffLeaveReviewRoutingController);
export { StaffLeaveReviewRoutingController };
//# sourceMappingURL=staff-leave-review-routing.controller.js.map