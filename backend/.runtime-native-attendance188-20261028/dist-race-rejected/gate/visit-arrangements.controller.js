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
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../roles/permissions.js';
import { VisitArrangementsService } from './visit-arrangements.service.js';
let VisitArrangementsController = class VisitArrangementsController {
    service;
    constructor(service) {
        this.service = service;
    }
    workspace(request, school, query) { return this.service.workspace(request.authUser, school, query); }
    options(request, school, query) { return this.service.options(request.authUser, school, query); }
    create(request, school, body) { return this.service.create(request.authUser, school, body); }
    detail(request, school, id) { return this.service.detail(request.authUser, school, id); }
    update(request, school, id, body) { return this.service.update(request.authUser, school, id, body); }
    cancel(request, school, id, body) { return this.service.cancel(request.authUser, school, id, body); }
    movement(request, school, id, body) { return this.service.movement(request.authUser, school, id, body); }
    confirmation(request, school, id, commandId) { return this.service.confirmation(request.authUser, school, id, commandId); }
};
__decorate([
    Get('/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], VisitArrangementsController.prototype, "workspace", null);
__decorate([
    Get('/options/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], VisitArrangementsController.prototype, "options", null);
__decorate([
    Post('/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], VisitArrangementsController.prototype, "create", null);
__decorate([
    Get('/:id/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], VisitArrangementsController.prototype, "detail", null);
__decorate([
    Post('/:id/update/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], VisitArrangementsController.prototype, "update", null);
__decorate([
    Post('/:id/cancel/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], VisitArrangementsController.prototype, "cancel", null);
__decorate([
    Post('/:id/movements/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], VisitArrangementsController.prototype, "movement", null);
__decorate([
    Get('/:id/commands/:commandId/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Param('commandId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], VisitArrangementsController.prototype, "confirmation", null);
VisitArrangementsController = __decorate([
    Controller('api/v1/gate/schools/:schoolId/visit-arrangements'),
    RequirePermission('gate.manage'),
    __metadata("design:paramtypes", [VisitArrangementsService])
], VisitArrangementsController);
export { VisitArrangementsController };
//# sourceMappingURL=visit-arrangements.controller.js.map