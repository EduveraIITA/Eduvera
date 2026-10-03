import { Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { StaffOperationsService } from "./staff-operations.service.js";

@Controller("api/v1/schools/:schoolId/staff")
export class StaffOperationsController {
  constructor(private readonly staff: StaffOperationsService) {}

  @Get("workspace/")
  workspace(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.staff.workspace(req.authUser, schoolId);
  }

  @Post("profiles/")
  createProfile(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.staff.createProfile(req.authUser, schoolId, req.body);
  }

  @Patch("profiles/:profileId/onboarding/")
  updateOnboarding(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("profileId") profileId: string) {
    return this.staff.updateOnboarding(req.authUser, schoolId, profileId, req.body);
  }

  @Post("leave-policies/")
  createPolicy(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.staff.savePolicy(req.authUser, schoolId, req.body);
  }

  @Patch("leave-policies/:policyId/")
  updatePolicy(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("policyId") policyId: string) {
    return this.staff.savePolicy(req.authUser, schoolId, req.body, policyId);
  }

  @Post("balance-adjustments/")
  adjustBalance(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.staff.adjustBalance(req.authUser, schoolId, req.body);
  }

  @Post("responsibilities/")
  createResponsibility(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.staff.createResponsibility(req.authUser, schoolId, req.body);
  }

  @Post("responsibilities/:assignmentId/response/")
  respondResponsibility(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("assignmentId") assignmentId: string) {
    return this.staff.respondResponsibility(req.authUser, schoolId, assignmentId, req.body);
  }

  @Post("responsibilities/:assignmentId/revoke/")
  revokeResponsibility(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("assignmentId") assignmentId: string) {
    return this.staff.revokeResponsibility(req.authUser, schoolId, assignmentId, req.body);
  }

  @Post("coverage-tasks/:taskId/assign/")
  assignCoverage(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("taskId") taskId: string) {
    return this.staff.assignCoverage(req.authUser, schoolId, taskId, req.body);
  }

  @Post("coverage-tasks/:taskId/response/")
  respondCoverage(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("taskId") taskId: string) {
    return this.staff.respondCoverage(req.authUser, schoolId, taskId, req.body);
  }

  @Post("leave-requests/")
  requestLeave(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.staff.requestLeave(req.authUser, schoolId, req.body);
  }

  @Post("leave-requests/:requestId/decision/")
  decideLeave(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("requestId") requestId: string) {
    return this.staff.decideLeave(req.authUser, schoolId, requestId, req.body);
  }

  @Post("leave-requests/:requestId/withdraw/")
  withdrawLeave(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("requestId") requestId: string) {
    return this.staff.withdrawLeave(req.authUser, schoolId, requestId, req.body);
  }
}
