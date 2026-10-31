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
import { Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { Public, SkipCsrf } from "../common/decorators.js";
import { RazorpayService } from "./razorpay.service.js";
let RazorpayController = class RazorpayController {
    payments;
    constructor(payments) {
        this.payments = payments;
    }
    order(req, school, id) { return this.payments.create(req.authUser, school, id, req.body); }
    verify(req, school, id) { return this.payments.verify(req.authUser, school, id, req.body); }
    status(req, school, id) { return this.payments.status(req.authUser, school, id); }
    async receipt(req, school, id, receiptId, reply) {
        const pdf = await this.payments.receipt(req.authUser, school, id, receiptId);
        return reply.header('Cache-Control', 'private, no-store').header('Content-Disposition', `attachment; filename="ThatCampus-test-receipt-${receiptId}.pdf"`).type('application/pdf').send(pdf);
    }
    webhook(req) { return this.payments.webhook(req.rawBody, String(req.headers["x-razorpay-signature"] ?? ""), String(req.headers["x-razorpay-event-id"] ?? "")); }
};
__decorate([
    Post("schools/:schoolId/fees/invoices/:id/razorpay/order/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RazorpayController.prototype, "order", null);
__decorate([
    Post("schools/:schoolId/fees/invoices/:id/razorpay/verify/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RazorpayController.prototype, "verify", null);
__decorate([
    Get("schools/:schoolId/fees/invoices/:id/razorpay/status/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RazorpayController.prototype, "status", null);
__decorate([
    Get('schools/:schoolId/fees/invoices/:id/razorpay/receipts/:receiptId/pdf/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Param('receiptId')),
    __param(4, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], RazorpayController.prototype, "receipt", null);
__decorate([
    Public(),
    SkipCsrf(),
    Post("payments/razorpay/webhook/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RazorpayController.prototype, "webhook", null);
RazorpayController = __decorate([
    Controller("api/v1"),
    __metadata("design:paramtypes", [RazorpayService])
], RazorpayController);
export { RazorpayController };
//# sourceMappingURL=razorpay.controller.js.map