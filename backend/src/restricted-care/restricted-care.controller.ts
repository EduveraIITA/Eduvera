import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { RestrictedCareService } from "./restricted-care.service.js";

@Controller("api/v1/schools/:schoolId/restricted-care")
export class RestrictedCareController {
  constructor(private readonly care: RestrictedCareService) {}

  @Get("workspace/")
  workspace(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.care.workspace(req.authUser, schoolId);
  }

  @Post("team-assignments/")
  assignTeamMember(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.care.assignTeamMember(req.authUser, schoolId, body);
  }

  @Post("team-assignments/:assignmentId/revoke/")
  revokeTeamMember(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("assignmentId") assignmentId: string, @Body() body: unknown) {
    return this.care.revokeTeamMember(req.authUser, schoolId, assignmentId, body);
  }

  @Post("cases/")
  openCase(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.care.openCase(req.authUser, schoolId, body);
  }

  @Get("cases/:caseId/")
  caseDetail(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("caseId") caseId: string) {
    return this.care.caseDetail(req.authUser, schoolId, caseId);
  }

  @Post("cases/:caseId/actions/")
  act(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("caseId") caseId: string, @Body() body: unknown) {
    return this.care.act(req.authUser, schoolId, caseId, body);
  }
}
