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
import { VisitSharingService } from './visit-sharing.service.js';
/** Source readers never pass through the management controller's broad permission. */
let VisitSharingController = class VisitSharingController {
    service;
    constructor(service) {
        this.service = service;
    }
    discovery(req, school) { return this.service.discovery(req.authUser, school); }
    shared(req, school, query) { return this.service.sharedWorkspace(req.authUser, school, query); }
    detail(req, school, id) { return this.service.sharedDetail(req.authUser, school, id); }
    management(req, school, id) { return this.service.management(req.authUser, school, id); }
    share(req, school, id, body) { return this.service.share(req.authUser, school, id, body); }
    revoke(req, school, id, share, body) { return this.service.revoke(req.authUser, school, id, share, body); }
    takeover(req, school, id, share, body) { return this.service.takeover(req.authUser, school, id, share, body); }
    ask(req, school, id, body) { return this.service.ask(req.authUser, school, id, body); }
    reply(req, school, id, question, body) { return this.service.reply(req.authUser, school, id, question, body); }
    confirmation(req, school, id, command) { return this.service.confirmation(req.authUser, school, id, command); }
};
__decorate([
    Get('/shared/discovery'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], VisitSharingController.prototype, "discovery", null);
__decorate([
    Get('/shared'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], VisitSharingController.prototype, "shared", null);
__decorate([
    Get('/:id/shared'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], VisitSharingController.prototype, "detail", null);
__decorate([
    Get('/:id/sharing'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], VisitSharingController.prototype, "management", null);
__decorate([
    Post('/:id/shares'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], VisitSharingController.prototype, "share", null);
__decorate([
    Post('/:id/shares/:share/revoke'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Param('share')),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], VisitSharingController.prototype, "revoke", null);
__decorate([
    Post('/:id/shares/:share/takeover'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Param('share')),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], VisitSharingController.prototype, "takeover", null);
__decorate([
    Post('/:id/shared/questions'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], VisitSharingController.prototype, "ask", null);
__decorate([
    Post('/:id/shared/questions/:question/replies'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Param('question')),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], VisitSharingController.prototype, "reply", null);
__decorate([
    Get('/:id/shared/commands/:command'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Param('command')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], VisitSharingController.prototype, "confirmation", null);
VisitSharingController = __decorate([
    Controller('api/v1/gate/schools/:schoolId/visit-arrangements'),
    __metadata("design:paramtypes", [VisitSharingService])
], VisitSharingController);
export { VisitSharingController };
//# sourceMappingURL=visit-sharing.controller.js.map