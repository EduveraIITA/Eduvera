import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { OperatingDayService } from "./operating-day.service.js";

@Controller("api/v1/schools/:schoolId/operating-day")
export class OperatingDayController {
  constructor(private readonly operatingDay: OperatingDayService) {}

  @Get("/")
  view(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Query("date") date?: string,
  ) {
    return this.operatingDay.project(request.authUser, schoolId, date);
  }
}
