import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../common/request.js";
import { LearningAssignmentsService } from "./learning-assignments.service.js";
import type { AssignmentUpload } from "./learning-assignment.contracts.js";
import { attachmentContentDisposition } from "../common/attachment-headers.js";

@Controller("api/v1/learning/assignments")
export class LearningAssignmentsController {
  constructor(private readonly assignments: LearningAssignmentsService) {}
  @Get("/") list(@Req() req: AuthenticatedRequest, @Query() query: { class_section_id?: string; student_id?: string; offering_id?: string; person_id?: string; page?: string }) { return this.assignments.list(req.authUser, query); }
  @Post("/") @HttpCode(200) create(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.assignments.save(req.authUser, body); }
  @Patch(":id/") save(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    if (!body || typeof body !== "object" || !("assignment_id" in body) || body.assignment_id !== id) throw new BadRequestException("Open the exact assignment before saving.");
    return this.assignments.save(req.authUser, body);
  }
  @Get(":id/") detail(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Query("student_id") studentId?: string, @Query("page") page?: string) { return this.assignments.detail(req.authUser, id, studentId, page); }
  @Post(":id/publish/") @HttpCode(200) publish(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) { return this.assignments.publish(req.authUser, id, body); }
  @Get([":id/work/:studentId/", ":id/people/:studentId/"]) work(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("studentId") studentId: string) { return this.assignments.detail(req.authUser, id, studentId); }
  @Put([":id/work/:studentId/", ":id/people/:studentId/"]) saveWork(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("studentId") studentId: string, @Body() body: unknown) { return this.assignments.saveWork(req.authUser, id, studentId, body); }
  @Post([":id/work/:studentId/files/", ":id/people/:studentId/files/"]) @HttpCode(200) async upload(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("studentId") studentId: string) {
    if (!req.isMultipart()) throw new BadRequestException("Choose one attachment using multipart form data.");
    let upload: AssignmentUpload | undefined; const body: Record<string, unknown> = {};
    for await (const part of req.parts({ limits: { files: 1, fields: 4, fileSize: 5 * 1024 * 1024 } })) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || upload) throw new BadRequestException("Choose one attachment.");
        const data = await part.toBuffer(); if (part.file.truncated) throw new BadRequestException("Choose a file up to 5 MiB.");
        upload = { filename: part.filename, mimetype: part.mimetype, data };
      } else body[part.fieldname] = part.fieldname === "expected_revision" ? Number(part.value) : part.value;
    }
    if (!upload) throw new BadRequestException("Choose an attachment.");
    return this.assignments.upload(req.authUser, id, studentId, body, upload);
  }
  @Delete([":id/work/:studentId/files/:fileId/", ":id/people/:studentId/files/:fileId/"]) detach(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("studentId") studentId: string, @Param("fileId") fileId: string, @Body() body: unknown) { return this.assignments.detach(req.authUser, id, studentId, fileId, body); }
  @Get([":id/work/:studentId/files/:fileId/", ":id/people/:studentId/files/:fileId/"]) async file(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("id") id: string, @Param("studentId") studentId: string, @Param("fileId") fileId: string) {
    const file = await this.assignments.file(req.authUser, id, studentId, fileId);
    reply.type(file.content_type); reply.header("Content-Disposition", attachmentContentDisposition(file.original_name));
    reply.header("X-Content-Type-Options", "nosniff"); reply.header("Cache-Control", "private, no-store");
    reply.header("X-ThatCampus-Evidence-Mode", file.evidence_mode); reply.header("X-ThatCampus-Source-Content-Omitted", String(file.source_content_omitted));
    return reply.send(file.stream);
  }
  @Post([":id/work/:studentId/submit/", ":id/people/:studentId/submit/"]) @HttpCode(200) submit(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("studentId") studentId: string, @Body() body: unknown) { return this.assignments.submit(req.authUser, id, studentId, body); }
  @Post([":id/work/:studentId/review/", ":id/people/:studentId/review/"]) @HttpCode(200) review(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("studentId") studentId: string, @Body() body: unknown) { return this.assignments.review(req.authUser, id, studentId, body); }
}
