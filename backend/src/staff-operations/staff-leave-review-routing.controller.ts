import { Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { StaffLeaveReviewRoutingService } from "./staff-leave-review-routing.service.js";

@Controller("api/v1/schools/:schoolId/staff/leave-review-routing")
export class StaffLeaveReviewRoutingController {
  constructor(private readonly routing: StaffLeaveReviewRoutingService) {}

  @Get("/")
  workspace(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.routing.workspace(request.authUser, schoolId);
  }

  @Post("/")
  confirm(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.routing.confirm(request.authUser, schoolId, request.body);
  }
}
