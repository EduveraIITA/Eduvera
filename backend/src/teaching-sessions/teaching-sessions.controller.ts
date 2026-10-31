import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../common/request.js";
import { attachmentContentDisposition } from "../common/attachment-headers.js";
import { TeachingSessionsService } from "./teaching-sessions.service.js";
import type { SessionUpload } from "./teaching-session.contracts.js";

@Controller("api/v1/learning/sessions")
export class TeachingSessionsController {
  constructor(private readonly sessions: TeachingSessionsService) {}
  private writable(req: AuthenticatedRequest) {
    const world = req.executionEnvironmentView;
    if (world?.mode === "simulation" && (world.unavailable || ["completed","stopped"].includes(world.run_status ?? "")))
      throw new ForbiddenException("This Simulation is read-only. The recorded lesson remains available.");
  }
  @Get() list(@Req() req: AuthenticatedRequest,@Query("date") date: string,@Query("page") page?: string) {
    return this.sessions.list(req.authUser,date,page);
  }
  @Get("open") open(@Req() req: AuthenticatedRequest,@Query("date") date: string,
    @Query() query: { occurrence_id?: string;class_section_id?: string;period_number?: string;history_page?: string }) {
    return this.sessions.open(req.authUser,date,query,query.history_page);
  }
  @Get(":id") detail(@Req() req: AuthenticatedRequest,@Param("id") id: string,@Query("date") date: string,@Query("history_page") page?: string) {
    return this.sessions.detail(req.authUser,id,date,page);
  }
  @Get(":id/work-options") workOptions(@Req() req:AuthenticatedRequest,@Param("id") id:string,@Query("date") date:string,@Query("page") page?:string){
    if(!this.sessions.work)throw new ForbiddenException("This learning-work adapter is unavailable.");
    return this.sessions.work.options(req.authUser,id,date,page);
  }
  @Post(":id/work") @HttpCode(200) work(@Req() req:AuthenticatedRequest,@Param("id") id:string,@Query("date") date:string,@Body() body:unknown){
    this.writable(req);if(!this.sessions.work)throw new ForbiddenException("This learning-work adapter is unavailable.");
    return this.sessions.work.link(req.authUser,id,date,body);
  }
  @Put(":id/lesson") save(@Req() req: AuthenticatedRequest,@Param("id") id: string,@Query("date") date: string,@Body() body: unknown) {
    this.writable(req); return this.sessions.save(req.authUser,id,date,body);
  }
  @Post(":id/materials") @HttpCode(200) material(@Req() req: AuthenticatedRequest,@Param("id") id: string,@Query("date") date: string,@Body() body: unknown) {
    this.writable(req); return this.sessions.materials.add(req.authUser,id,date,body);
  }
  @Post(":id/materials/files") @HttpCode(200) async upload(@Req() req: AuthenticatedRequest,@Param("id") id: string,@Query("date") date: string) {
    this.writable(req);
    if (!req.isMultipart()) throw new BadRequestException("Choose one file using multipart form data.");
    const body: Record<string,unknown> = {}; let upload: SessionUpload | undefined;
    for await (const part of req.parts({ limits: { files:1,fields:8,fileSize:5*1024*1024 } })) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || upload) throw new BadRequestException("Choose one class resource file.");
        const data = await part.toBuffer(); if (part.file.truncated) throw new BadRequestException("Choose a file up to 5 MiB.");
        upload = { filename:part.filename,mimetype:part.mimetype,data };
      } else {
        if (Object.hasOwn(body,part.fieldname)) throw new BadRequestException("Use each resource field once.");
        body[part.fieldname] = part.fieldname === "expected_revision" ? Number(part.value)
          : part.fieldname === "shared" ? part.value === "true" ? true : part.value === "false" ? false : part.value
            : part.fieldname === "replaces_material_id" && part.value === "" ? null : part.value;
      }
    }
    if (!upload) throw new BadRequestException("Choose a file.");
    return this.sessions.materials.upload(req.authUser,id,date,body,upload);
  }
  @Get(":id/materials/:materialId/file") async file(@Req() req: AuthenticatedRequest,@Res() reply: FastifyReply,
    @Param("id") id: string,@Param("materialId") materialId: string,@Query("date") date: string) {
    const file = await this.sessions.materials.file(req.authUser,id,date,materialId);
    reply.type(file.content_type).header("Content-Disposition",attachmentContentDisposition(file.original_name))
      .header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff")
      .header("X-ThatCampus-Evidence-Mode",file.evidence_mode).header("X-ThatCampus-Source-Content-Omitted",String(file.source_content_omitted));
    return reply.send(file.stream);
  }
}
