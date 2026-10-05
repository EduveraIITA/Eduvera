import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { RequirePermission } from "../roles/permissions.js";
import { AcademicReportsService } from "./academic-reports.service.js";

@Controller("api/v1/schools/:schoolId/academic-reports")
export class AcademicReportsController {
  constructor(private readonly reports: AcademicReportsService) {}

  @Get("workspace/")
  workspace(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.reports.workspace(req.authUser, schoolId);
  }

  @Get("family/")
  family(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query("student_id") studentId: string) {
    return this.reports.familyReports(req.authUser, schoolId, studentId);
  }

  @Post("schemes/")
  createScheme(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.reports.createScheme(req.authUser, schoolId, body);
  }

  @Get("schemes/:schemeId/")
  schemeDetail(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("schemeId") schemeId: string) {
    return this.reports.schemeDetail(req.authUser, schoolId, schemeId);
  }

  @Put("schemes/:schemeId/subjects/")
  saveSubject(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("schemeId") schemeId: string, @Body() body: unknown) {
    return this.reports.saveSubjectPlan(req.authUser, schoolId, schemeId, body);
  }

  @Post("schemes/:schemeId/activate/")
  activate(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("schemeId") schemeId: string, @Body() body: unknown) {
    return this.reports.activateScheme(req.authUser, schoolId, schemeId, body);
  }

  @Post("schemes/:schemeId/generate/")
  generate(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("schemeId") schemeId: string, @Body() body: unknown) {
    return this.reports.generateReport(req.authUser, schoolId, schemeId, body);
  }

  @Get("batches/:batchId/")
  reportDetail(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("batchId") batchId: string) {
    return this.reports.reportDetail(req.authUser, schoolId, batchId);
  }

  @Put("batches/:batchId/students/:studentId/comments/")
  @RequirePermission("reports.comment")
  comments(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("batchId") batchId: string, @Param("studentId") studentId: string, @Body() body: unknown) {
    return this.reports.updateComments(req.authUser, schoolId, batchId, studentId, body);
  }

  @Post("batches/:batchId/actions/:action/")
  action(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("batchId") batchId: string, @Param("action") action: string, @Body() body: unknown) {
    return this.reports.batchAction(req.authUser, schoolId, batchId, action, body);
  }
}
