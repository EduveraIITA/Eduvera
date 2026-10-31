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
import { Controller, Delete, Get, Post, Req, Param, Query, HttpCode } from '@nestjs/common';
import { AgentService } from './agent.service.js';
import { AgentMemoryService } from './long-term-memory.js';
let AgentController = class AgentController {
    agent;
    memory;
    constructor(agent, memory) {
        this.agent = agent;
        this.memory = memory;
    }
    memories(r, q) { return this.memory.listForRequest(r, q); }
    clearMemories(r) { return this.memory.clearForRequest(r); }
    removeMemory(r, memoryId) { return this.memory.removeForRequest(r, memoryId); }
    status(r, q) { return this.agent.status(r, q); }
    list(r, q) { return this.agent.list(r, q); }
    create(r) { return this.agent.create(r); }
    detail(r, id) { return this.agent.detail(r, id); }
    send(r, id) { return this.agent.send(r, id); }
    cancel(r, id, runId) { return this.agent.cancel(r, id, runId); }
    decide(r, id, actionId) { return this.agent.decide(r, id, actionId); }
};
__decorate([
    Get('memories'),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AgentController.prototype, "memories", null);
__decorate([
    Delete('memories'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgentController.prototype, "clearMemories", null);
__decorate([
    Delete('memories/:memoryId'),
    __param(0, Req()),
    __param(1, Param('memoryId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AgentController.prototype, "removeMemory", null);
__decorate([
    Get('status'),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AgentController.prototype, "status", null);
__decorate([
    Get('threads'),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AgentController.prototype, "list", null);
__decorate([
    Post('threads'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgentController.prototype, "create", null);
__decorate([
    Get('threads/:id'),
    __param(0, Req()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AgentController.prototype, "detail", null);
__decorate([
    Post('threads/:id/messages'),
    HttpCode(202),
    __param(0, Req()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AgentController.prototype, "send", null);
__decorate([
    Post('threads/:id/runs/:runId/cancel'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Param('runId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AgentController.prototype, "cancel", null);
__decorate([
    Post('threads/:id/actions/:actionId'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Param('actionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AgentController.prototype, "decide", null);
AgentController = __decorate([
    Controller('api/v1/agent'),
    __metadata("design:paramtypes", [AgentService, AgentMemoryService])
], AgentController);
export { AgentController };
//# sourceMappingURL=agent.controller.js.map