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
import { RequirePermission } from "../roles/permissions.js";
import { Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Optional } from "@nestjs/common";
import { LiveAccountControl, Public } from "../common/decorators.js";
import { FeeReviewService } from "./fee-review.service.js";
import { OperationsService } from "./operations.service.js";
import { FeeLedgerService } from "./fee-ledger.service.js";
let OperationsController = class OperationsController {
    operations;
    feeReviews;
    feeLedger;
    constructor(operations, feeReviews, feeLedger) {
        this.operations = operations;
        this.feeReviews = feeReviews;
        this.feeLedger = feeLedger;
    }
    feeWorkspace(req, school, student, person, invoice, query = {}) { return this.feeReviews.workspace(req.authUser, school, student, person, invoice, query); }
    feeAccounts(req, school) { return this.feeLedger.accounts(req.authUser, school); }
    feeConfirmation(req, school, id, command) { return this.feeLedger.confirmation(req.authUser, school, id, command); }
    feeGatewayOrder(req, school, orderId) { return this.feeReviews.gatewayPaymentReview(req.authUser, school, orderId); }
    feeSettings(req, school) { return this.feeReviews.settings(req.authUser, school, req.body); }
    feeSubmit(req, school, id) { return this.feeReviews.submit(req.authUser, school, id, req.body); }
    feeDecide(req, school, id) { return this.feeReviews.decide(req.authUser, school, id, req.body); }
    school() { return this.operations.createSchool(); }
    accept(req) { return this.operations.acceptInvite(req.body); }
    recipientProof(req) { return this.operations.recipientProof(req.body); }
    overview(req, school) { return this.operations.overview(req.authUser, school); }
    createCatalog(req, school, kind) { return this.operations.saveCatalog(req.authUser, school, kind, req.body); }
    updateCatalog(req, school, kind, id) { return this.operations.saveCatalog(req.authUser, school, kind, req.body, id); }
    student(req, school) { return this.operations.student(req.authUser, school, req.body); }
    updateStudent(req, school, id) { return this.operations.student(req.authUser, school, req.body, id); }
    importStudents(req, school) { return this.operations.importStudents(req.authUser, school, req.body); }
    enroll(req, school) { return this.operations.enroll(req.authUser, school, req.body); }
    rollover(req, school) { return this.operations.rollover(req.authUser, school, req.body); }
    invitations(req, school) { return this.operations.invitationWorkspace(req.authUser, school); }
    invite(req, school) { return this.operations.invite(req.authUser, school, req.body); }
    invitation(req, school, id) { return this.operations.invitationDetail(req.authUser, school, id); }
    invitationContinuation(req, school, id) { return this.operations.invitationContinuation(req.authUser, school, id); }
    resend(req, school, id) { return this.operations.resendInvitation(req.authUser, school, id); }
    revoke(req, school, id) { return this.operations.revokeInvitation(req.authUser, school, id); }
    member(req, school, id) { return this.operations.member(req.authUser, school, id, req.body, req.requestId); }
    fees(req, school, student, person, invoice, query = {}) { return this.operations.fees(req.authUser, school, student, person, invoice, query); }
    feeStudents(req, school, query = {}) { return this.operations.feeStudents(req.authUser, school, query); }
    invoice(req, school) { return this.operations.invoice(req.authUser, school, req.body); }
    payment(req, school, id) { return this.operations.payment(req.authUser, school, id, req.body); }
};
__decorate([
    Get("schools/:schoolId/fees/workspace/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("student_id")),
    __param(3, Query("person_id")),
    __param(4, Query("invoice_id")),
    __param(5, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "feeWorkspace", null);
__decorate([
    Get("schools/:schoolId/fees/accounts/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "feeAccounts", null);
__decorate([
    Get("schools/:schoolId/fees/invoices/:id/confirmation/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query("command_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "feeConfirmation", null);
__decorate([
    Get("schools/:schoolId/fees/gateway-orders/:orderId/"),
    RequirePermission("fees.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("orderId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "feeGatewayOrder", null);
__decorate([
    Post("schools/:schoolId/fees/settings/"),
    RequirePermission("fees.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "feeSettings", null);
__decorate([
    Post("schools/:schoolId/fees/invoices/:id/reviews/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "feeSubmit", null);
__decorate([
    Post("schools/:schoolId/fees/reviews/:id/decision/"),
    RequirePermission("fees.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "feeDecide", null);
__decorate([
    Post("schools/"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "school", null);
__decorate([
    Public(),
    LiveAccountControl(),
    Post("invitations/accept/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "accept", null);
__decorate([
    Public(),
    LiveAccountControl(),
    Post("invitations/recipient-proof/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "recipientProof", null);
__decorate([
    Get("schools/:schoolId/administration/"),
    RequirePermission("sis.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "overview", null);
__decorate([
    Post("schools/:schoolId/catalog/:kind/"),
    RequirePermission("sis.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("kind")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "createCatalog", null);
__decorate([
    Patch("schools/:schoolId/catalog/:kind/:id/"),
    RequirePermission("sis.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("kind")),
    __param(3, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "updateCatalog", null);
__decorate([
    Post("schools/:schoolId/students/"),
    RequirePermission("sis.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "student", null);
__decorate([
    Patch("schools/:schoolId/students/:id/"),
    RequirePermission("sis.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "updateStudent", null);
__decorate([
    Post("schools/:schoolId/student-import/"),
    RequirePermission("sis.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "importStudents", null);
__decorate([
    Post("schools/:schoolId/enrollments/"),
    RequirePermission("sis.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "enroll", null);
__decorate([
    Post("schools/:schoolId/rollover/"),
    RequirePermission("sis.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "rollover", null);
__decorate([
    Get("schools/:schoolId/invitations/workspace/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "invitations", null);
__decorate([
    Post("schools/:schoolId/invitations/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "invite", null);
__decorate([
    Get("schools/:schoolId/invitations/:id/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "invitation", null);
__decorate([
    Get('schools/:schoolId/invitations/:id/continuation/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "invitationContinuation", null);
__decorate([
    Post("schools/:schoolId/invitations/:id/resend/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "resend", null);
__decorate([
    Post("schools/:schoolId/invitations/:id/revoke/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "revoke", null);
__decorate([
    Patch("schools/:schoolId/members/:id/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "member", null);
__decorate([
    Get("schools/:schoolId/fees/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("student_id")),
    __param(3, Query("person_id")),
    __param(4, Query("invoice_id")),
    __param(5, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "fees", null);
__decorate([
    Get("schools/:schoolId/fees/students/"),
    RequirePermission("fees.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "feeStudents", null);
__decorate([
    Post("schools/:schoolId/fees/invoices/"),
    RequirePermission("fees.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "invoice", null);
__decorate([
    Post("schools/:schoolId/fees/invoices/:id/payments/"),
    RequirePermission("fees.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "payment", null);
OperationsController = __decorate([
    Controller("api/v1"),
    __param(2, Optional()),
    __metadata("design:paramtypes", [OperationsService, FeeReviewService, FeeLedgerService])
], OperationsController);
export { OperationsController };
//# sourceMappingURL=operations.controller.js.map