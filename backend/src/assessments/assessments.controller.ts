import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../common/request.js";
import { RequirePermission } from "../roles/permissions.js";
import { AssessmentsService, type AssessmentUpload } from "./assessments.service.js";
import { ExamOperationsService } from "./exam-operations.service.js";

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
  constructor(private readonly assessments: AssessmentsService,private readonly examOperations:ExamOperationsService) {}

  @Get("exam-policy/")
  examPolicy(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string){ return this.examOperations.policy(req.authUser,schoolId); }

  @Post("exam-policy/")
  saveExamPolicy(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Body() body:unknown){ return this.examOperations.savePolicy(req.authUser,schoolId,body); }

  @Get('calendar/')
  calendar(@Req() req:AuthenticatedRequest,@Param('schoolId') schoolId:string,@Query('from') from:string,@Query('to') to:string,@Query('student_id') student?:string) {
    return this.assessments.calendar(req.authUser,schoolId,from,to,student);
  }

  @Get("workspace/")
  workspace(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.assessments.workspace(req.authUser, schoolId);
  }

  @Get("family/")
  family(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query("student_id") studentId: string) {
    return this.assessments.familyResults(req.authUser, schoolId, studentId);
  }

  @Get(":assessmentId/")
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

  @Get(":assessmentId/sitting/")
  sitting(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("assessmentId") assessmentId:string){ return this.examOperations.detail(req.authUser,schoolId,assessmentId); }

  @Get(":assessmentId/sitting/readiness/")
  sittingReadiness(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("assessmentId") assessmentId:string){ return this.examOperations.readiness(req.authUser,schoolId,assessmentId); }

  @Post(":assessmentId/sitting/")
  createSitting(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("assessmentId") assessmentId:string,@Body() body:unknown){ return this.examOperations.createSitting(req.authUser,schoolId,assessmentId,body); }

  @Post(":assessmentId/sitting/arrangements/")
  updateSittingArrangements(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("assessmentId") assessmentId:string,@Body() body:unknown){ return this.examOperations.updateArrangements(req.authUser,schoolId,assessmentId,body); }

  @Post(":assessmentId/sitting/invigilators/:assignmentId/response/")
  respondInvigilator(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("assessmentId") assessmentId:string,@Param("assignmentId") assignmentId:string,@Body() body:unknown){ return this.examOperations.respondInvigilator(req.authUser,schoolId,assessmentId,assignmentId,body); }

  @Post(":assessmentId/sitting/actions/start/")
  startSitting(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("assessmentId") assessmentId:string,@Body() body:unknown){ return this.examOperations.start(req.authUser,schoolId,assessmentId,body); }

  @Post(":assessmentId/sitting/attendance/")
  recordSittingAttendance(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("assessmentId") assessmentId:string,@Body() body:unknown){ return this.examOperations.recordAttendance(req.authUser,schoolId,assessmentId,body); }

  @Post(":assessmentId/sitting/incidents/")
  createSittingIncident(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("assessmentId") assessmentId:string,@Body() body:unknown){ return this.examOperations.createIncident(req.authUser,schoolId,assessmentId,body); }

  @Post(":assessmentId/sitting/incidents/:incidentId/resolve/")
  resolveSittingIncident(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("assessmentId") assessmentId:string,@Param("incidentId") incidentId:string,@Body() body:unknown){ return this.examOperations.resolveIncident(req.authUser,schoolId,assessmentId,incidentId,body); }

  @Post(":assessmentId/sitting/actions/complete/")
  completeSitting(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("assessmentId") assessmentId:string,@Body() body:unknown){ return this.examOperations.complete(req.authUser,schoolId,assessmentId,body); }

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
