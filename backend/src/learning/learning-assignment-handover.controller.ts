import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { LearningAssignmentHandoverService } from "./learning-assignment-handover.service.js";
@Controller("api/v1/learning/assignments/review-handovers")
export class LearningAssignmentHandoverController {
  constructor(private readonly handovers: LearningAssignmentHandoverService) {}
  @Get("/") list(@Req() req: AuthenticatedRequest, @Query() query: { page?: string }) { return this.handovers.list(req.authUser, query); }
  @Get(":id/") detail(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.handovers.detail(req.authUser, id); }
  @Post(":id/") @HttpCode(200) transfer(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) { return this.handovers.transfer(req.authUser, id, body); }
}
