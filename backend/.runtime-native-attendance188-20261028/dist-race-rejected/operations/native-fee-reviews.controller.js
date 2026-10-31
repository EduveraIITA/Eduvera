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
import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { NativeFeeReviewsService } from "./native-fee-reviews.service.js";
let NativeFeeReviewsController = class NativeFeeReviewsController {
    reviews;
    constructor(reviews) {
        this.reviews = reviews;
    }
    writable(req) {
        const world = req.executionEnvironmentView;
        if (world?.mode === "simulation" && (world.unavailable || ["completed", "stopped"].includes(world.run_status ?? "")))
            throw new ForbiddenException("This Simulation is read-only. Return to a working world before changing fee work.");
    }
    workspace(req, schoolId, invoiceId, studentId, personId, commandId) {
        return this.reviews.workspace(req.authUser, schoolId, { ...(invoiceId ? { invoice_id: invoiceId } : {}), ...(studentId ? { student_id: studentId } : {}),
            ...(personId ? { person_id: personId } : {}), ...(commandId ? { command_id: commandId } : {}) });
    }
    report(req, schoolId, invoiceId, body) {
        this.writable(req);
        return this.reviews.report(req.authUser, schoolId, invoiceId, body);
    }
    decide(req, schoolId, reviewId, body) {
        this.writable(req);
        return this.reviews.decide(req.authUser, schoolId, reviewId, body);
    }
    withdraw(req, schoolId, reviewId, body) {
        this.writable(req);
        return this.reviews.withdraw(req.authUser, schoolId, reviewId, body);
    }
    recovery(req, schoolId, reviewId, commandId) {
        return this.reviews.recovery(req.authUser, schoolId, reviewId, commandId);
    }
};
__decorate([
    Get("payment-reviews/workspace/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("invoice_id")),
    __param(3, Query("student_id")),
    __param(4, Query("person_id")),
    __param(5, Query("command_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], NativeFeeReviewsController.prototype, "workspace", null);
__decorate([
    Post("invoices/:invoiceId/payment-reviews/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("invoiceId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], NativeFeeReviewsController.prototype, "report", null);
__decorate([
    Post("payment-reviews/:reviewId/decision/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("reviewId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], NativeFeeReviewsController.prototype, "decide", null);
__decorate([
    Post("payment-reviews/:reviewId/withdraw/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("reviewId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], NativeFeeReviewsController.prototype, "withdraw", null);
__decorate([
    Get("payment-reviews/:reviewId/recovery/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("reviewId")),
    __param(3, Query("command_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], NativeFeeReviewsController.prototype, "recovery", null);
NativeFeeReviewsController = __decorate([
    Controller("api/v1/schools/:schoolId/fees"),
    __metadata("design:paramtypes", [NativeFeeReviewsService])
], NativeFeeReviewsController);
export { NativeFeeReviewsController };
//# sourceMappingURL=native-fee-reviews.controller.js.map