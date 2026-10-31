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
import { Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { AiService } from "./ai.service.js";
let AiController = class AiController {
    ai;
    constructor(ai) {
        this.ai = ai;
    }
    query(request) {
        return this.ai.query(request.authUser, request.body, request);
    }
};
__decorate([
    Post("attendance/query/"),
    HttpCode(200),
    RequirePermission("ai.use"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "query", null);
AiController = __decorate([
    ApiTags("attendance-copilot"),
    ApiCookieAuth(),
    Controller("api/v1/ai"),
    __metadata("design:paramtypes", [AiService])
], AiController);
export { AiController };
//# sourceMappingURL=ai.controller.js.map