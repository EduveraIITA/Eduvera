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
import { Controller, Get, Post, Req, Query, Param, HttpCode } from '@nestjs/common';
import { SchedulePlanningService } from './schedule-planning.service.js';
let SchedulePlanningController = class SchedulePlanningController {
    service;
    constructor(service) {
        this.service = service;
    }
    screen(r, term) { return this.service.screen(r.authUser, term); }
    year(r) { return this.service.prepareYear(r, r.body); }
    start(r) { return this.service.start(r, r.body); }
    save(r, id) { return this.service.save(r, id, r.body); }
    publish(r, id) { return this.service.publish(r, id, r.body); }
    discard(r, id) { return this.service.discard(r, id, r.body); }
};
__decorate([
    Get(),
    __param(0, Req()),
    __param(1, Query('term_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchedulePlanningController.prototype, "screen", null);
__decorate([
    Post('years'),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SchedulePlanningController.prototype, "year", null);
__decorate([
    Post('drafts'),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SchedulePlanningController.prototype, "start", null);
__decorate([
    Post(':id/save'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchedulePlanningController.prototype, "save", null);
__decorate([
    Post(':id/publish'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchedulePlanningController.prototype, "publish", null);
__decorate([
    Post(':id/discard'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchedulePlanningController.prototype, "discard", null);
SchedulePlanningController = __decorate([
    Controller('api/v1/schedule-planning'),
    __metadata("design:paramtypes", [SchedulePlanningService])
], SchedulePlanningController);
export { SchedulePlanningController };
//# sourceMappingURL=schedule-planning.controller.js.map