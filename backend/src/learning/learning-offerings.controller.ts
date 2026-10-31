import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { LearningOfferingsService } from "./learning-offerings.service.js";

@Controller("api/v1/learning/offerings")
export class LearningOfferingsController {
  constructor(private readonly offerings: LearningOfferingsService) {}
  @Get("/") list(@Req() req: AuthenticatedRequest, @Query() query: { page?: string; search?: string }) { return this.offerings.list(req.authUser, query); }
  @Post("/") @HttpCode(200) create(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.offerings.create(req.authUser, body); }
  @Get(":id/") detail(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.offerings.detail(req.authUser, id); }
  @Get(":id/confirmation/") confirmation(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Query("command_id") commandId: string, @Query("action") action: string) { return this.offerings.confirmation(req.authUser, id, commandId, action); }
  @Post(":id/enrollments/") @HttpCode(200) enroll(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) { return this.offerings.enroll(req.authUser, id, body); }
  @Post(":id/enrollments/:recordId/end/") @HttpCode(200) endEnrollment(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("recordId") recordId: string, @Body() body: unknown) { return this.offerings.endEnrollment(req.authUser, id, recordId, body); }
  @Post(":id/instructors/") @HttpCode(200) appoint(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) { return this.offerings.appointInstructor(req.authUser, id, body); }
  @Post(":id/instructors/:recordId/end/") @HttpCode(200) endInstructor(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("recordId") recordId: string, @Body() body: unknown) { return this.offerings.endInstructor(req.authUser, id, recordId, body); }
}
