import { Controller, Get, HttpCode, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { ActivityAttendanceService } from "./activity-attendance.service.js";
import { ActivityAttendanceWorkspaceService } from "./activity-attendance-workspace.service.js";

@Controller("api/v1/schools/:schoolId/activities/registers")
export class ActivityAttendanceController {
  constructor(private readonly attendance: ActivityAttendanceService, private readonly workspace: ActivityAttendanceWorkspaceService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query() query: unknown) {
    return this.workspace.list(request.authUser, schoolId, query);
  }

  @Get("for-occurrence/:occurrenceId")
  forOccurrence(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("occurrenceId") id: string) {
    return this.workspace.openOccurrence(request.authUser, schoolId, id);
  }

  @Get(":registerId")
  detail(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("registerId") id: string) {
    return this.attendance.detail(request.authUser, schoolId, id);
  }

  @Get(":registerId/history")
  history(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("registerId") id: string, @Query() query: unknown) {
    return this.attendance.history(request.authUser, schoolId, id, query);
  }

  @Put(":registerId/marks")
  marks(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("registerId") id: string) {
    return this.attendance.marks(request.authUser, schoolId, id, request.body, request);
  }

  @Post(":registerId/submit")
  @HttpCode(200)
  submit(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("registerId") id: string) {
    if (request.body && typeof request.body === "object" && "records" in request.body) {
      return this.attendance.submitRecords(request.authUser, schoolId, id, request.body, request);
    }
    return this.attendance.transition(request.authUser, schoolId, id, "submit", request.body, request);
  }

  @Post(":registerId/finalize")
  @HttpCode(200)
  finalize(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("registerId") id: string) {
    return this.attendance.transition(request.authUser, schoolId, id, "finalize", request.body, request);
  }

  @Post(":registerId/reopen")
  @HttpCode(200)
  reopen(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("registerId") id: string) {
    return this.attendance.transition(request.authUser, schoolId, id, "reopen", request.body, request);
  }

  @Post(":registerId/evidence")
  @HttpCode(200)
  evidence(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("registerId") id: string) {
    return this.attendance.evidence(request.authUser, schoolId, id, request.body, request);
  }

  @Post(":registerId/evidence/:evidenceId/decision")
  @HttpCode(200)
  decideEvidence(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("registerId") id: string, @Param("evidenceId") evidenceId: string) {
    return this.attendance.decideEvidence(request.authUser, schoolId, id, evidenceId, request.body, request);
  }
}
