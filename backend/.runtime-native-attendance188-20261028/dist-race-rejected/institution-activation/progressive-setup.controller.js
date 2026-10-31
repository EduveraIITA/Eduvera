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
import { RequirePermission } from "../roles/permissions.js";
import { ProgressiveSetupService } from "./progressive-setup.service.js";
let ProgressiveSetupController = class ProgressiveSetupController {
    setup;
    constructor(setup) {
        this.setup = setup;
    }
    workspace(request, schoolId) {
        return this.setup.workspace(request.authUser, schoolId);
    }
    configure(request, schoolId, capability) {
        return this.setup.setup(request.authUser, schoolId, capability, request.body, request);
    }
};
__decorate([
    Get("/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ProgressiveSetupController.prototype, "workspace", null);
__decorate([
    Post(":capability/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("capability")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ProgressiveSetupController.prototype, "configure", null);
ProgressiveSetupController = __decorate([
    Controller("api/v1/schools/:schoolId/get-started"),
    RequirePermission("sis.manage"),
    __metadata("design:paramtypes", [ProgressiveSetupService])
], ProgressiveSetupController);
export { ProgressiveSetupController };
//# sourceMappingURL=progressive-setup.controller.js.map