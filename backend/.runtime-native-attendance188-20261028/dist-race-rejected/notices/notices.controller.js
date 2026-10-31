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
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../roles/permissions.js";
import { NoticesService } from "./notices.service.js";
let NoticesController = class NoticesController {
    notices;
    constructor(notices) {
        this.notices = notices;
    }
    references(request, query) {
        return this.notices.references(request.authUser, query);
    }
    list(request, query) {
        return this.notices.list(request.authUser, query);
    }
    detail(request, id, query) {
        return this.notices.detail(request.authUser, id, query);
    }
    create(request, body) {
        return this.notices.create(request, body);
    }
    update(request, id, body) {
        return this.notices.update(request, id, body);
    }
    publish(request, id, body) {
        return this.notices.publish(request, id, body);
    }
    cancel(request, id, body) {
        return this.notices.cancel(request, id, body);
    }
    open(request, id, body) {
        return this.notices.open(request, id, body);
    }
    respond(request, id, body) {
        return this.notices.respond(request, id, body);
    }
    assistedResponse(request, id, body) {
        return this.notices.assistedResponse(request, id, body);
    }
    recordDelivery(request, id, body) {
        return this.notices.recordDelivery(request, id, body);
    }
};
__decorate([
    Get("references"),
    RequirePermission("messages.send"),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], NoticesController.prototype, "references", null);
__decorate([
    Get(),
    RequirePermission("messages.view"),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], NoticesController.prototype, "list", null);
__decorate([
    Get(":id"),
    RequirePermission("messages.view"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], NoticesController.prototype, "detail", null);
__decorate([
    Post(),
    HttpCode(200),
    RequirePermission("messages.send"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], NoticesController.prototype, "create", null);
__decorate([
    Patch(":id"),
    RequirePermission("messages.send"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], NoticesController.prototype, "update", null);
__decorate([
    Post(":id/publish"),
    HttpCode(200),
    RequirePermission("messages.send"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], NoticesController.prototype, "publish", null);
__decorate([
    Post(":id/cancel"),
    HttpCode(200),
    RequirePermission("messages.send"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], NoticesController.prototype, "cancel", null);
__decorate([
    Post(":id/open"),
    HttpCode(200),
    RequirePermission("messages.view"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], NoticesController.prototype, "open", null);
__decorate([
    Post(":id/respond"),
    HttpCode(200),
    RequirePermission("messages.view"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], NoticesController.prototype, "respond", null);
__decorate([
    Post(":id/assisted-responses"),
    HttpCode(200),
    RequirePermission("messages.send"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], NoticesController.prototype, "assistedResponse", null);
__decorate([
    Post(":id/deliveries"),
    HttpCode(200),
    RequirePermission("messages.send"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], NoticesController.prototype, "recordDelivery", null);
NoticesController = __decorate([
    ApiTags("notices"),
    ApiCookieAuth(),
    Controller("api/v1/notices"),
    __metadata("design:paramtypes", [NoticesService])
], NoticesController);
export { NoticesController };
//# sourceMappingURL=notices.controller.js.map