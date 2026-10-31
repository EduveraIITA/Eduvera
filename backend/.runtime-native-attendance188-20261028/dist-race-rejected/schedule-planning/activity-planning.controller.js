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
import { Controller, Get, Post, Put, Req, Query, Param, HttpCode } from '@nestjs/common';
import { ActivityPlanningService } from './activity-planning.service.js';
let ActivityPlanningController = class ActivityPlanningController {
    service;
    constructor(service) {
        this.service = service;
    }
    catalogue(r, school) { return this.service.catalogue(r.authUser, school); }
    plans(r, school, query) { return this.service.listPlans(r.authUser, school, query); }
    plan(r, school, id) { return this.service.getPlan(r.authUser, school, id); }
    create(r, school) { return this.service.create(r, school, r.body); }
    update(r, school, id) { return this.service.update(r, school, id, r.body); }
    publish(r, school, id) { return this.service.publish(r, school, id, r.body); }
    revise(r, school, id) { return this.service.revise(r, school, id, r.body); }
    cancel(r, school, id) { return this.service.cancel(r, school, id, r.body); }
    occurrences(r, school, query) { return this.service.listOccurrences(r.authUser, school, query); }
};
__decorate([
    Get('catalogue'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ActivityPlanningController.prototype, "catalogue", null);
__decorate([
    Get('plans'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ActivityPlanningController.prototype, "plans", null);
__decorate([
    Get('plans/:id'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityPlanningController.prototype, "plan", null);
__decorate([
    Post('plans'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ActivityPlanningController.prototype, "create", null);
__decorate([
    Put('plans/:id'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityPlanningController.prototype, "update", null);
__decorate([
    Post('plans/:id/publish'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityPlanningController.prototype, "publish", null);
__decorate([
    Post('plans/:id/revise'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityPlanningController.prototype, "revise", null);
__decorate([
    Post('plans/:id/cancel'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityPlanningController.prototype, "cancel", null);
__decorate([
    Get('occurrences'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ActivityPlanningController.prototype, "occurrences", null);
ActivityPlanningController = __decorate([
    Controller('api/v1/schools/:schoolId/activities'),
    __metadata("design:paramtypes", [ActivityPlanningService])
], ActivityPlanningController);
export { ActivityPlanningController };
//# sourceMappingURL=activity-planning.controller.js.map