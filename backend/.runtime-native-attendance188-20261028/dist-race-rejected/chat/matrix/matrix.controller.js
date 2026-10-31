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
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../roles/permissions.js';
import { MatrixTransportService } from './matrix-transport.service.js';
let MatrixController = class MatrixController {
    matrix;
    constructor(matrix) {
        this.matrix = matrix;
    }
    status(request, id) {
        return this.matrix.status(request.authUser, id);
    }
    retry(request, id) {
        return this.matrix.retry(request.authUser, id);
    }
    configure(request, id, input) {
        const body = z.object({ enabled: z.boolean() }).strict().parse(input);
        return this.matrix.configureSchool(request.authUser, id, body.enabled);
    }
};
__decorate([
    Get('conversations/:conversationId/'),
    RequirePermission('messages.view'),
    __param(0, Req()),
    __param(1, Param('conversationId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MatrixController.prototype, "status", null);
__decorate([
    Post('conversations/:conversationId/retry/'),
    HttpCode(200),
    RequirePermission('messages.send'),
    __param(0, Req()),
    __param(1, Param('conversationId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MatrixController.prototype, "retry", null);
__decorate([
    Patch('schools/:schoolId/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], MatrixController.prototype, "configure", null);
MatrixController = __decorate([
    ApiTags('chat'),
    ApiCookieAuth(),
    Controller('api/v1/chat/engine'),
    __metadata("design:paramtypes", [MatrixTransportService])
], MatrixController);
export { MatrixController };
//# sourceMappingURL=matrix.controller.js.map