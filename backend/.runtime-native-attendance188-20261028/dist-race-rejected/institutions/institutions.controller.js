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
import { Controller, Get, Req, Param } from "@nestjs/common";
import { Public } from "../common/decorators.js";
import { InstitutionsService } from "./institutions.service.js";
let InstitutionsController = class InstitutionsController {
    institutions;
    constructor(institutions) {
        this.institutions = institutions;
    }
    // Public catalogue contains institution metadata only, never administrators or student data.
    search(request) { return this.institutions.search(request.query); }
    async operator(request) {
        await this.institutions.requireOperator(request.authUser.id);
        return { is_company_operator: true };
    }
    async get(request, id) {
        await this.institutions.requireOperator(request.authUser.id);
        return this.institutions.get(id);
    }
};
__decorate([
    Public(),
    Get("search/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InstitutionsController.prototype, "search", null);
__decorate([
    Get("operator/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InstitutionsController.prototype, "operator", null);
__decorate([
    Get(":id/"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InstitutionsController.prototype, "get", null);
InstitutionsController = __decorate([
    Controller("api/v1/institutions"),
    __metadata("design:paramtypes", [InstitutionsService])
], InstitutionsController);
export { InstitutionsController };
//# sourceMappingURL=institutions.controller.js.map