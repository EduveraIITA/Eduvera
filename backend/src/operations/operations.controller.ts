import { RequirePermission } from "../roles/permissions.js";
import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Optional } from "@nestjs/common";
import { LiveAccountControl, Public, SkipCsrf } from "../common/decorators.js";
import type { AuthenticatedRequest } from "../common/request.js";
import { FeeReviewService } from "./fee-review.service.js";
import { OperationsService } from "./operations.service.js";
import { FeeLedgerService } from "./fee-ledger.service.js";

@Controller("api/v1")
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operations: OperationsService, @Inject(FeeReviewService) private readonly feeReviews: FeeReviewService, @Optional() @Inject(FeeLedgerService) private readonly feeLedger?: FeeLedgerService) {}

  @Get("schools/:schoolId/fees/workspace/")
  feeWorkspace(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Query("student_id") student?: string, @Query("person_id") person?: string, @Query("invoice_id") invoice?: string, @Query() query: Record<string, string> = {}) { return this.feeReviews.workspace(req.authUser, school, student, person, invoice, query); }
  @Get("schools/:schoolId/fees/accounts/")
  feeAccounts(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.feeLedger!.accounts(req.authUser, school); }
  @Get("schools/:schoolId/fees/invoices/:id/confirmation/")
  feeConfirmation(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string, @Query("command_id") command: string) { return this.feeLedger!.confirmation(req.authUser, school, id, command); }

  @Get("schools/:schoolId/fees/gateway-orders/:orderId/")
  @RequirePermission("fees.manage")
  feeGatewayOrder(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("orderId") orderId: string) { return this.feeReviews.gatewayPaymentReview(req.authUser, school, orderId); }

  @Post("schools/:schoolId/fees/settings/")
  @RequirePermission("fees.manage")
  feeSettings(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.feeReviews.settings(req.authUser, school, req.body); }

  @Post("schools/:schoolId/fees/invoices/:id/reviews/")
  feeSubmit(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.feeReviews.submit(req.authUser, school, id, req.body); }

  @Post("schools/:schoolId/fees/reviews/:id/decision/")
  @RequirePermission("fees.manage")
  feeDecide(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.feeReviews.decide(req.authUser, school, id, req.body); }

  @Post("schools/")
  school() { return this.operations.createSchool(); }

  @Public()
  @LiveAccountControl()
  @Post("invitations/accept/")
  @HttpCode(200)
  accept(@Req() req: AuthenticatedRequest) { return this.operations.acceptInvite(req.body); }

  @Public()
  @LiveAccountControl()
  @Post("invitations/recipient-proof/")
  @HttpCode(200)
  recipientProof(@Req() req: AuthenticatedRequest) { return this.operations.recipientProof(req.body); }

  // Native recipients present the same invitation/password/mailbox proofs.
  // These handlers never use an ambient cookie to grant account authority or
  // create a session. The browser keeps its original CSRF-protected endpoints.
  @Public()
  @LiveAccountControl()
  @SkipCsrf()
  @Post("auth/native/invitations/accept/")
  @HttpCode(200)
  nativeAccept(@Req() req: AuthenticatedRequest) { return this.operations.acceptInvite(req.body); }

  @Public()
  @LiveAccountControl()
  @SkipCsrf()
  @Post("auth/native/invitations/recipient-proof/")
  @HttpCode(200)
  nativeRecipientProof(@Req() req: AuthenticatedRequest) { return this.operations.recipientProof(req.body); }

  @Get("schools/:schoolId/administration/")
  @RequirePermission("sis.manage")
  overview(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.overview(req.authUser, school); }

  @Post("schools/:schoolId/catalog/:kind/")
  @RequirePermission("sis.manage")
  createCatalog(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("kind") kind: string) { return this.operations.saveCatalog(req.authUser, school, kind, req.body); }

  @Patch("schools/:schoolId/catalog/:kind/:id/")
  @RequirePermission("sis.manage")
  updateCatalog(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("kind") kind: string, @Param("id") id: string) { return this.operations.saveCatalog(req.authUser, school, kind, req.body, id); }

  @Post("schools/:schoolId/students/")
  @RequirePermission("sis.manage")
  student(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.student(req.authUser, school, req.body); }

  @Patch("schools/:schoolId/students/:id/")
  @RequirePermission("sis.manage")
  updateStudent(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.student(req.authUser, school, req.body, id); }

  @Post("schools/:schoolId/student-import/")
  @RequirePermission("sis.manage")
  importStudents(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.importStudents(req.authUser, school, req.body); }

  @Post("schools/:schoolId/enrollments/")
  @RequirePermission("sis.manage")
  enroll(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.enroll(req.authUser, school, req.body); }

  @Post("schools/:schoolId/rollover/")
  @RequirePermission("sis.manage")
  rollover(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.rollover(req.authUser, school, req.body); }

  @Get("schools/:schoolId/invitations/workspace/")
  invitations(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) {return this.operations.invitationWorkspace(req.authUser,school);}

  @Post("schools/:schoolId/invitations/")
  invite(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.invite(req.authUser, school, req.body); }

  @Get("schools/:schoolId/invitations/:id/")
  invitation(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.invitationDetail(req.authUser, school, id); }

  @Get('schools/:schoolId/invitations/:id/continuation/')
  invitationContinuation(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string) { return this.operations.invitationContinuation(req.authUser, school, id); }

  @Post("schools/:schoolId/invitations/:id/resend/")
  resend(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.resendInvitation(req.authUser, school, id); }

  @Post("schools/:schoolId/invitations/:id/revoke/")
  revoke(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.revokeInvitation(req.authUser, school, id); }

  @Patch("schools/:schoolId/members/:id/")
  member(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.member(req.authUser, school, id, req.body, req.requestId); }

  @Get("schools/:schoolId/fees/")
  fees(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Query("student_id") student?: string, @Query("person_id") person?: string, @Query("invoice_id") invoice?: string, @Query() query: Record<string, string> = {}) { return this.operations.fees(req.authUser, school, student, person, invoice, query); }

  @Get("schools/:schoolId/fees/students/")
  @RequirePermission("fees.manage")
  feeStudents(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Query() query: Record<string, string> = {}) { return this.operations.feeStudents(req.authUser, school, query); }

  @Post("schools/:schoolId/fees/invoices/")
  @RequirePermission("fees.manage")
  invoice(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.invoice(req.authUser, school, req.body); }

  @Post("schools/:schoolId/fees/invoices/:id/payments/")
  @RequirePermission("fees.manage")
  payment(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.payment(req.authUser, school, id, req.body); }
}
