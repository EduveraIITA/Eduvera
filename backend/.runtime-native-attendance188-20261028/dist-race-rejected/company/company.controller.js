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
import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import { CompanyService } from './company.service.js';
let CompanyController = class CompanyController {
    company;
    constructor(company) {
        this.company = company;
    }
    workspace(req) { return this.company.workspace(req.authUser); }
    create(req) { return this.company.create(req.authUser, req.body); }
    invite(req, school) { return this.company.inviteAdmin(req.authUser, school, req.body); }
    resend(req, school, id) { return this.company.resend(req.authUser, school, id); }
    revoke(req, school, id) { return this.company.revoke(req.authUser, school, id); }
    reviewApplication(req, id) { return this.company.reviewApplication(req.authUser, id, req.body); }
};
__decorate([
    Get('workspace/'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CompanyController.prototype, "workspace", null);
__decorate([
    Post('institutions/'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CompanyController.prototype, "create", null);
__decorate([
    Post('institutions/:schoolId/admin-invitations/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CompanyController.prototype, "invite", null);
__decorate([
    Post('institutions/:schoolId/admin-invitations/:id/resend/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CompanyController.prototype, "resend", null);
__decorate([
    Post('institutions/:schoolId/admin-invitations/:id/revoke/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CompanyController.prototype, "revoke", null);
__decorate([
    Post('institution-applications/:id/review/'),
    __param(0, Req()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CompanyController.prototype, "reviewApplication", null);
CompanyController = __decorate([
    Controller('api/v1/company'),
    __metadata("design:paramtypes", [CompanyService])
], CompanyController);
export { CompanyController };
//# sourceMappingURL=company.controller.js.map