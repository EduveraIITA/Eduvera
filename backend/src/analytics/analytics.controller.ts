import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { AnalyticsService } from "./analytics.service.js";

@Controller("api/v1/schools/:schoolId/analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}
  // All four personas are authorized independently inside the read model.
  // No generic staff permission may widen a family or assigned-class scope.
  @Get(":portal/")
  overview(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string,
    @Param("portal") portal: string, @Query() query: Record<string, string>) {
    return this.analytics.overview(request.authUser, schoolId, portal, query);
  }
}
