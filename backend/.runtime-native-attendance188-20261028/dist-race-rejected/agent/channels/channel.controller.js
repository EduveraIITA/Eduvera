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
import { Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Public, SkipCsrf } from '../../common/decorators.js';
import { AgentChannelService } from './channel.service.js';
let AgentChannelController = class AgentChannelController {
    channels;
    constructor(channels) {
        this.channels = channels;
    }
    list(request) { return this.channels.list(request); }
    link(request) { return this.channels.issueLink(request); }
    disconnect(request, provider) { return this.channels.revoke(request, provider); }
    webhook(request, provider) {
        const secret = request.headers['x-telegram-bot-api-secret-token'];
        return this.channels.ingest(provider, typeof secret === 'string' ? secret : undefined, request.body);
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgentChannelController.prototype, "list", null);
__decorate([
    Post('link'),
    HttpCode(201),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgentChannelController.prototype, "link", null);
__decorate([
    Delete(':provider'),
    __param(0, Req()),
    __param(1, Param('provider')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AgentChannelController.prototype, "disconnect", null);
__decorate([
    Public(),
    SkipCsrf(),
    Post(':provider/webhook'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('provider')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AgentChannelController.prototype, "webhook", null);
AgentChannelController = __decorate([
    Controller('api/v1/agent/channels'),
    __metadata("design:paramtypes", [AgentChannelService])
], AgentChannelController);
export { AgentChannelController };
//# sourceMappingURL=channel.controller.js.map