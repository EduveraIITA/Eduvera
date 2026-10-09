import { RequirePermission } from "../roles/permissions.js";
import { Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { Public } from "../common/decorators.js";
import type { AuthenticatedRequest } from "../common/request.js";
import { FeeReviewService } from "./fee-review.service.js";
import { OperationsService } from "./operations.service.js";

@Controller("api/v1")
export class OperationsController {
  constructor(private readonly operations: OperationsService, private readonly feeReviews: FeeReviewService) {}

  @Get("schools/:schoolId/fees/workspace/")
  @RequirePermission("fees.manage")
  feeWorkspace(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Query("student_id") student?: string) { return this.feeReviews.workspace(req.authUser, school, student); }

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
  @Post("invitations/accept/")
  @HttpCode(200)
  accept(@Req() req: AuthenticatedRequest) { return this.operations.acceptInvite(req.body); }

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

  @Post("schools/:schoolId/guardians/")
  @RequirePermission("sis.manage")
  guardian(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.guardian(req.authUser, school, req.body); }

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

  @Post("schools/:schoolId/invitations/:id/resend/")
  resend(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.resendInvitation(req.authUser, school, id); }

  @Post("schools/:schoolId/invitations/:id/revoke/")
  revoke(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.revokeInvitation(req.authUser, school, id); }

  @Patch("schools/:schoolId/members/:id/")
  member(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.member(req.authUser, school, id, req.body); }

  @Get("schools/:schoolId/fees/")
  @RequirePermission("fees.manage")
  fees(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Query("student_id") student?: string) { return this.operations.fees(req.authUser, school, student); }

  @Get("schools/:schoolId/fees/students/")
  @RequirePermission("fees.manage")
  feeStudents(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.feeStudents(req.authUser, school); }

  @Post("schools/:schoolId/fees/invoices/")
  @RequirePermission("fees.manage")
  invoice(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.invoice(req.authUser, school, req.body); }

  @Post("schools/:schoolId/fees/invoices/:id/payments/")
  @RequirePermission("fees.manage")
  payment(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.payment(req.authUser, school, id, req.body); }
}
