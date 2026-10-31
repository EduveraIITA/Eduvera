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
import { Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { RolesService } from "./roles.service.js";
let RolesController = class RolesController {
    roles;
    constructor(roles) {
        this.roles = roles;
    }
    workspace(req, school) { return this.roles.workspace(req.authUser, school); }
    effective(req, school) { return this.roles.effective(req.authUser, school); }
    create(req, school) { return this.roles.save(req.authUser, school, req.body); }
    update(req, school, id) { return this.roles.save(req.authUser, school, req.body, id); }
    remove(req, school, id) { return this.roles.remove(req.authUser, school, id, req.body); }
    assign(req, school, member) { return this.roles.assign(req.authUser, school, member, req.body); }
    memberAccess(req, school, member) { return this.roles.memberAccess(req.authUser, school, member); }
    addException(req, school, member) { return this.roles.addException(req.authUser, school, member, req.body); }
    revokeException(req, school, id) { return this.roles.revokeException(req.authUser, school, id, req.body); }
};
__decorate([
    Get("workspace/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "workspace", null);
__decorate([
    Get("effective/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "effective", null);
__decorate([
    Post(),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "create", null);
__decorate([
    Patch(":id/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "update", null);
__decorate([
    Post(":id/delete/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "remove", null);
__decorate([
    Post("members/:userId/assignment/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("userId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "assign", null);
__decorate([
    Get("members/:userId/access/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("userId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "memberAccess", null);
__decorate([
    Post("members/:userId/exceptions/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("userId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "addException", null);
__decorate([
    Post("exceptions/:id/revoke/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "revokeException", null);
RolesController = __decorate([
    Controller("api/v1/schools/:schoolId/roles"),
    __metadata("design:paramtypes", [RolesService])
], RolesController);
export { RolesController };
//# sourceMappingURL=roles.controller.js.map