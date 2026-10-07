import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../common/request.js";
import { RequirePermission } from "../roles/permissions.js";
import { AssessmentsService, type AssessmentUpload } from "./assessments.service.js";

async function uploadBody(request: AuthenticatedRequest): Promise<{ body: Record<string, unknown>; upload: AssessmentUpload }> {
  if (!request.isMultipart()) throw new BadRequestException("Upload evidence using multipart form data.");
  const body: Record<string, unknown> = {};
  let upload: AssessmentUpload | undefined;
  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "file") { await part.toBuffer(); continue; }
      if (upload) throw new BadRequestException("Only one evidence file may be uploaded at a time.");
      upload = { filename: part.filename, mimetype: part.mimetype, data: await part.toBuffer() };
    } else body[part.fieldname] = part.value;
  }
  if (!upload) throw new BadRequestException("Choose an evidence file.");
  return { body, upload };
}

@Controller("api/v1/schools/:schoolId/assessments")
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Get("workspace/")
  @RequirePermission("assessments.view")
  workspace(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.assessments.workspace(req.authUser, schoolId);
  }

  @Get("family/")
  family(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query("student_id") studentId: string) {
    return this.assessments.familyResults(req.authUser, schoolId, studentId);
  }

  @Get(":assessmentId/")
  @RequirePermission("assessments.view")
  detail(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("assessmentId") assessmentId: string) {
    return this.assessments.detail(req.authUser, schoolId, assessmentId);
  }

  @Post("cycles/")
  createCycle(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.assessments.createCycle(req.authUser, schoolId, body);
  }

  @Post()
  createAssessment(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.assessments.createAssessment(req.authUser, schoolId, body);
  }

  @Post(":assessmentId/actions/:action/")
  action(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("assessmentId") assessmentId: string, @Param("action") action: string, @Body() body: unknown) {
    return this.assessments.action(req.authUser, schoolId, assessmentId, action, body);
  }

  @Post(":assessmentId/results/")
  @RequirePermission("assessments.mark")
  results(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("assessmentId") assessmentId: string, @Body() body: unknown) {
    return this.assessments.recordResults(req.authUser, schoolId, assessmentId, body);
  }

  @Post(":assessmentId/results/:resultId/evidence/")
  @RequirePermission("assessments.mark")
  async addEvidence(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("assessmentId") assessmentId: string, @Param("resultId") resultId: string) {
    const parsed = await uploadBody(req);
    return this.assessments.addEvidence(req.authUser, schoolId, assessmentId, resultId, parsed.body, parsed.upload);
  }

  @Get(":assessmentId/evidence/:evidenceId/")
  @RequirePermission("assessments.view")
  async evidence(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("schoolId") schoolId: string, @Param("assessmentId") assessmentId: string, @Param("evidenceId") evidenceId: string) {
    const found = await this.assessments.evidence(req.authUser, schoolId, assessmentId, evidenceId);
    reply.type(found.record.content_type || "application/octet-stream");
    reply.header("Content-Disposition", `inline; filename="${found.record.original_name.replace(/[\r\n"]/g, "_")}"`);
    return reply.send(found.stream);
  }
}
