import { Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { Public } from "../common/decorators.js";
import type { AuthenticatedRequest } from "../common/request.js";
import { OperationsService } from "./operations.service.js";

@Controller("api/v1")
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Post("schools/")
  school(@Req() req: AuthenticatedRequest) { return this.operations.createSchool(req.authUser, req.body); }

  @Public()
  @Post("invitations/accept/")
  @HttpCode(200)
  accept(@Req() req: AuthenticatedRequest) { return this.operations.acceptInvite(req.body); }

  @Get("schools/:schoolId/administration/")
  overview(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.overview(req.authUser, school); }

  @Post("schools/:schoolId/catalog/:kind/")
  createCatalog(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("kind") kind: string) { return this.operations.saveCatalog(req.authUser, school, kind, req.body); }

  @Patch("schools/:schoolId/catalog/:kind/:id/")
  updateCatalog(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("kind") kind: string, @Param("id") id: string) { return this.operations.saveCatalog(req.authUser, school, kind, req.body, id); }

  @Post("schools/:schoolId/students/")
  student(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.student(req.authUser, school, req.body); }

  @Patch("schools/:schoolId/students/:id/")
  updateStudent(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.student(req.authUser, school, req.body, id); }

  @Post("schools/:schoolId/student-import/")
  importStudents(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.importStudents(req.authUser, school, req.body); }

  @Post("schools/:schoolId/guardians/")
  guardian(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.guardian(req.authUser, school, req.body); }

  @Post("schools/:schoolId/enrollments/")
  enroll(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.enroll(req.authUser, school, req.body); }

  @Post("schools/:schoolId/rollover/")
  rollover(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.rollover(req.authUser, school, req.body); }

  @Post("schools/:schoolId/invitations/")
  invite(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.invite(req.authUser, school, req.body); }

  @Post("schools/:schoolId/invitations/:id/revoke/")
  revoke(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.revokeInvitation(req.authUser, school, id); }

  @Patch("schools/:schoolId/members/:id/")
  member(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.member(req.authUser, school, id, req.body); }

  @Get("schools/:schoolId/fees/")
  fees(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Query("student_id") student?: string) { return this.operations.fees(req.authUser, school, student); }

  @Get("schools/:schoolId/fees/students/")
  feeStudents(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.feeStudents(req.authUser, school); }

  @Post("schools/:schoolId/fees/invoices/")
  invoice(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.operations.invoice(req.authUser, school, req.body); }

  @Post("schools/:schoolId/fees/invoices/:id/payments/")
  payment(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.operations.payment(req.authUser, school, id, req.body); }
}
