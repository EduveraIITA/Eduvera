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
import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { CoordinationService } from "./coordination.service.js";
let CoordinationController = class CoordinationController {
    coordination;
    constructor(coordination) {
        this.coordination = coordination;
    }
    list(req, query) {
        return this.coordination.list(req.authUser, query);
    }
    detail(req, id, context) {
        return this.coordination.detail(req.authUser, id, context);
    }
    create(req) {
        return this.coordination.create(req, req.body);
    }
    respond(req, id) {
        return this.coordination.respond(req, id, req.body);
    }
};
__decorate([
    Get(),
    RequirePermission("followups.manage"),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CoordinationController.prototype, "list", null);
__decorate([
    Get(":id"),
    RequirePermission("followups.manage"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("context")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CoordinationController.prototype, "detail", null);
__decorate([
    Post(),
    HttpCode(200),
    RequirePermission("followups.manage"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CoordinationController.prototype, "create", null);
__decorate([
    Post(":id/entries"),
    HttpCode(200),
    RequirePermission("followups.manage"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CoordinationController.prototype, "respond", null);
CoordinationController = __decorate([
    ApiTags("coordination"),
    ApiCookieAuth(),
    Controller("api/v1/coordination/follow-ups"),
    __metadata("design:paramtypes", [CoordinationService])
], CoordinationController);
export { CoordinationController };
//# sourceMappingURL=coordination.controller.js.map