import { Controller, Get, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { ResponsibilityAttendanceWorkspaceService } from "./responsibility-attendance-workspace.service.js";

@Controller("api/v1/attendance")
export class ResponsibilityAttendanceWorkspaceController {
  constructor(private readonly attendance: ResponsibilityAttendanceWorkspaceService) {}

  @Get("workspace")
  workspace(
    @Req() request: AuthenticatedRequest,
    @Query("surface") surface?: string,
    @Query("date") date?: string,
    @Query("case_id") caseId?: string,
  ) {
    return this.attendance.workspace(
      request.authUser,
      request.executionEnvironment,
      request.executionEnvironmentView,
      { surface, date, case_id: caseId },
    );
  }
}
