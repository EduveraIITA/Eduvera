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
import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Public, SkipCsrf } from '../common/decorators.js';
import { CalendarIntegrationsService } from './calendar-integrations.service.js';
let CalendarIntegrationsController = class CalendarIntegrationsController {
    calendars;
    constructor(calendars) {
        this.calendars = calendars;
    }
    status(request, query) { return this.calendars.status(request, query); }
    create(request) { return this.calendars.createSubscription(request); }
    revoke(request, id) { return this.calendars.revoke(request, id); }
    async export(request, query, reply) {
        const result = await this.calendars.export(request, query);
        return reply.header('Cache-Control', 'private, no-store')
            .header('Content-Disposition', `attachment; filename="${result.filename}"`).type('text/calendar; charset=utf-8').send(result.body);
    }
    async preview(request, id, reply) {
        const body = await this.calendars.preview(request, id);
        return reply.header('Cache-Control', 'private, no-store').header('X-Evidence-Mode', 'simulation')
            .header('Content-Disposition', 'attachment; filename="thatcampus-simulation-calendar.ics"').type('text/calendar; charset=utf-8').send(body);
    }
    async feed(request, token, reply) {
        const body = await this.calendars.feed(token);
        const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;
        if (request.headers['if-none-match'] === etag)
            return reply.status(304).send();
        return reply.header('Cache-Control', 'private, max-age=300').header('ETag', etag).type('text/calendar; charset=utf-8').send(body);
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CalendarIntegrationsController.prototype, "status", null);
__decorate([
    Post('subscriptions'),
    HttpCode(201),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CalendarIntegrationsController.prototype, "create", null);
__decorate([
    Delete('subscriptions/:id'),
    __param(0, Req()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CalendarIntegrationsController.prototype, "revoke", null);
__decorate([
    Get('export.ics'),
    __param(0, Req()),
    __param(1, Query()),
    __param(2, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], CalendarIntegrationsController.prototype, "export", null);
__decorate([
    Get('subscriptions/:id/preview.ics'),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CalendarIntegrationsController.prototype, "preview", null);
__decorate([
    Public(),
    SkipCsrf(),
    Get('subscriptions/:token/feed.ics'),
    __param(0, Req()),
    __param(1, Param('token')),
    __param(2, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CalendarIntegrationsController.prototype, "feed", null);
CalendarIntegrationsController = __decorate([
    Controller('api/v1/calendar-connections'),
    __metadata("design:paramtypes", [CalendarIntegrationsService])
], CalendarIntegrationsController);
export { CalendarIntegrationsController };
//# sourceMappingURL=calendar-integrations.controller.js.map