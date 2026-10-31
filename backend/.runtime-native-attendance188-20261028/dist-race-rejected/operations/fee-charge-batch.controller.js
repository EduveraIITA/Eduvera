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
import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { FeeChargeBatchService } from "./fee-charge-batch.service.js";
let FeeChargeBatchController = class FeeChargeBatchController {
    batches;
    constructor(batches) {
        this.batches = batches;
    }
    catalogue(req, school, query) { return this.batches.catalogue(req.authUser, school, query); }
    preview(req, school) { return this.batches.preview(req.authUser, school, req.body); }
    issue(req, school) { return this.batches.issue(req.authUser, school, req.body); }
    detail(req, school, id) { return this.batches.detail(req.authUser, school, id); }
    confirmation(req, school, id, commandId) { return this.batches.confirmation(req.authUser, school, id, commandId); }
};
__decorate([
    Get("charge-audience/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], FeeChargeBatchController.prototype, "catalogue", null);
__decorate([
    Post("charge-audience/preview/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FeeChargeBatchController.prototype, "preview", null);
__decorate([
    Post("charge-batches/"),
    HttpCode(201),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FeeChargeBatchController.prototype, "issue", null);
__decorate([
    Get("charge-batches/:id/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], FeeChargeBatchController.prototype, "detail", null);
__decorate([
    Get("charge-batches/:id/confirmation/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query("command_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], FeeChargeBatchController.prototype, "confirmation", null);
FeeChargeBatchController = __decorate([
    Controller("api/v1/schools/:schoolId/fees"),
    __metadata("design:paramtypes", [FeeChargeBatchService])
], FeeChargeBatchController);
export { FeeChargeBatchController };
//# sourceMappingURL=fee-charge-batch.controller.js.map