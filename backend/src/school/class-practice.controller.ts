import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { ClassPracticeService } from "./class-practice.service.js";

@Controller("api/v1/learning/practice")
export class ClassPracticeController {
  constructor(private readonly practice: ClassPracticeService) {}
  private writable(req: AuthenticatedRequest) {
    const world = req.executionEnvironmentView;
    if (world?.mode === "simulation" && (world.unavailable || ["completed", "stopped"].includes(world.run_status ?? ""))) throw new ForbiddenException("This simulation has ended or is unavailable. Practice is read-only.");
  }
  @Get("/") list(@Req() req: AuthenticatedRequest, @Query("class_section_id") classId: string, @Query("page") page?: string) { return this.practice.list(req.authUser, classId, page); }
  @Post("/") @HttpCode(200) publish(@Req() req: AuthenticatedRequest, @Body() body: unknown) { this.writable(req); return this.practice.publish(req.authUser, body); }
  @Get(":id/") detail(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Query("class_section_id") classId: string, @Query("page") page?: string, @Query("student_id") studentId?: string) { return this.practice.detail(req.authUser, id, classId, page, studentId); }
  @Post(":id/notes/") @HttpCode(200) note(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) { this.writable(req); return this.practice.note(req.authUser, id, body, true); }
}
