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
import { Controller, Get, Post, Param, Query, Req, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { ResourceLoansService } from './resource-loans.service.js';
let ResourceLoansController = class ResourceLoansController {
    resources;
    constructor(resources) {
        this.resources = resources;
    }
    workspace(req, school, query) { return this.resources.workspace(req.authUser, school, query); }
    options(req, school, query) { return this.resources.options(req.authUser, school, query); }
    createItem(req, school) { return this.resources.createItem(req.authUser, school, req.body, req); }
    issue(req, school) { return this.resources.issue(req.authUser, school, req.body); }
    detail(req, school, id) { return this.resources.detail(req.authUser, school, z.uuid().parse(id)); }
    confirmation(req, school, id, commandId) { return this.resources.confirmation(req.authUser, school, z.uuid().parse(id), z.uuid().parse(commandId)); }
    receive(req, school, id) { return this.resources.recordReturn(req.authUser, school, z.uuid().parse(id), req.body); }
    due(req, school, id) { return this.resources.changeDue(req.authUser, school, z.uuid().parse(id), req.body); }
    custodians(req, school, id, query) { return this.resources.custodianOptions(req.authUser, school, z.uuid().parse(id), query); }
    responsibility(req, school, id) { return this.resources.changeCustodian(req.authUser, school, z.uuid().parse(id), req.body); }
    ask(req, school, id) { return this.resources.ask(req.authUser, school, z.uuid().parse(id), req.body); }
    reply(req, school, id, question) { return this.resources.answer(req.authUser, school, z.uuid().parse(id), z.uuid().parse(question), req.body); }
    resolve(req, school, id, question) { return this.resources.answer(req.authUser, school, z.uuid().parse(id), z.uuid().parse(question), req.body, true); }
};
__decorate([
    Get('workspace'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "workspace", null);
__decorate([
    Get('options'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "options", null);
__decorate([
    Post('items'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "createItem", null);
__decorate([
    Post('loans'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "issue", null);
__decorate([
    Get('loans/:id'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "detail", null);
__decorate([
    Get('loans/:id/confirmation'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Query('command_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "confirmation", null);
__decorate([
    Post('loans/:id/returns'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "receive", null);
__decorate([
    Post('loans/:id/due-date'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "due", null);
__decorate([
    Get('loans/:id/custodians'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "custodians", null);
__decorate([
    Post('loans/:id/responsibility'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "responsibility", null);
__decorate([
    Post('loans/:id/questions'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "ask", null);
__decorate([
    Post('loans/:id/questions/:question/replies'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Param('question')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "reply", null);
__decorate([
    Post('loans/:id/questions/:question/resolve'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Param('question')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ResourceLoansController.prototype, "resolve", null);
ResourceLoansController = __decorate([
    Controller('api/v1/schools/:schoolId/resources'),
    __metadata("design:paramtypes", [ResourceLoansService])
], ResourceLoansController);
export { ResourceLoansController };
//# sourceMappingURL=resource-loans.controller.js.map