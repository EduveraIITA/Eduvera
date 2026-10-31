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
import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import { OrganizationService } from "./organization.service.js";
let OrganizationController = class OrganizationController {
    organization;
    constructor(organization) {
        this.organization = organization;
    }
    workspace(req, schoolId) {
        return this.organization.workspace(req.authUser, schoolId);
    }
    save(req, schoolId, body) {
        return this.organization.save(req.authUser, schoolId, body);
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OrganizationController.prototype, "workspace", null);
__decorate([
    Put(),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], OrganizationController.prototype, "save", null);
OrganizationController = __decorate([
    Controller("api/v1/schools/:schoolId/organization"),
    __metadata("design:paramtypes", [OrganizationService])
], OrganizationController);
export { OrganizationController };
//# sourceMappingURL=organization.controller.js.map