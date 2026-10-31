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
import { FeeCorrectionsService } from "./fee-corrections.service.js";
let FeeCorrectionsController = class FeeCorrectionsController {
    corrections;
    constructor(corrections) {
        this.corrections = corrections;
    }
    preview(req, school) { return this.corrections.preview(req.authUser, school, req.body); }
    apply(req, school) { return this.corrections.apply(req.authUser, school, req.body); }
    detail(req, school, id) { return this.corrections.detail(req.authUser, school, id); }
    confirmation(req, school, id, command) { return this.corrections.confirmation(req.authUser, school, id, command); }
    paymentPreview(req, school, id) { return this.corrections.paymentPreview(req.authUser, school, id, req.body); }
    paymentApply(req, school, id) { return this.corrections.correctPayment(req.authUser, school, id, req.body); }
    paymentDetail(req, school, id) { return this.corrections.paymentDetail(req.authUser, school, id); }
    paymentConfirmation(req, school, id, command) { return this.corrections.paymentConfirmation(req.authUser, school, id, command); }
};
__decorate([
    Post("corrections/preview/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FeeCorrectionsController.prototype, "preview", null);
__decorate([
    Post("corrections/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FeeCorrectionsController.prototype, "apply", null);
__decorate([
    Get("corrections/:id/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], FeeCorrectionsController.prototype, "detail", null);
__decorate([
    Get("corrections/:id/confirmation/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query("command_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], FeeCorrectionsController.prototype, "confirmation", null);
__decorate([
    Post("payments/:id/correction-preview/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], FeeCorrectionsController.prototype, "paymentPreview", null);
__decorate([
    Post("payments/:id/corrections/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], FeeCorrectionsController.prototype, "paymentApply", null);
__decorate([
    Get("payment-corrections/:id/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], FeeCorrectionsController.prototype, "paymentDetail", null);
__decorate([
    Get("payment-corrections/:id/confirmation/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query("command_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], FeeCorrectionsController.prototype, "paymentConfirmation", null);
FeeCorrectionsController = __decorate([
    Controller("api/v1/schools/:schoolId/fees"),
    __metadata("design:paramtypes", [FeeCorrectionsService])
], FeeCorrectionsController);
export { FeeCorrectionsController };
//# sourceMappingURL=fee-corrections.controller.js.map