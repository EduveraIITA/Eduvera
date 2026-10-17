import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Query, Req } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import type { AuthenticatedRequest } from "../common/request.js";
import { SchoolModule } from "../school/school.module.js";
import { AttendanceModelService } from "./attendance-model.service.js";

@Controller("api/v1/attendance-model")
class AttendanceModelController {
  constructor(private readonly attendance: AttendanceModelService) {}

  @Get("workspace")
  workspace(@Req() request: AuthenticatedRequest, @Query("date") date: string) {
    return this.attendance.workspace(request.authUser, date);
  }

  @Get("sessions/:sessionId")
  session(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string) {
    return this.attendance.screen(request.authUser, sessionId);
  }

  @Get("sessions/:sessionId/history")
  history(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string) {
    return this.attendance.history(request.authUser, sessionId);
  }

  @Post("sessions/:sessionId/submit")
  @HttpCode(200)
  submit(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string) {
    return this.attendance.save(request.authUser, sessionId, request.body, request);
  }

  @Post("sessions/:sessionId/lock")
  @HttpCode(200)
  lock(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string) {
    return this.attendance.setLock(request.authUser, sessionId, true, request.body, request);
  }

  @Delete("sessions/:sessionId/lock")
  @HttpCode(200)
  unlock(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string) {
    return this.attendance.setLock(request.authUser, sessionId, false, request.body, request);
  }

  @Post("sessions/:sessionId/qr")
  issueQr(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string) {
    return this.attendance.issueQr(request.authUser, sessionId);
  }

  @Post("sessions/:sessionId/evidence/:evidenceId/decision")
  @HttpCode(200)
  decideEvidence(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") sessionId: string,
    @Param("evidenceId") evidenceId: string,
  ) {
    return this.attendance.decideEvidence(request.authUser, sessionId, evidenceId, request.body, request);
  }

  @Post("self-check-in")
  @HttpCode(200)
  selfCheckIn(@Req() request: AuthenticatedRequest, @Body("token") token: unknown) {
    return this.attendance.selfCheckIn(request.authUser, token, request);
  }
}

@Module({ imports: [SchoolModule, CampusModelCoreModule], controllers: [AttendanceModelController], providers: [AttendanceModelService], exports: [AttendanceModelService] })
export class AttendanceModelModule {}
