import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { CampusDatesService } from "./campus-dates.service.js";
@Controller("api/v1/schools/:schoolId/campus-dates")
export class CampusDatesController {
  constructor(private readonly dates: CampusDatesService) {}
  @Get() list(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Query() query: Record<string, string>) { return this.dates.list(req.authUser, school, query); }
  @Get(":id") detail(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.dates.detail(req.authUser, school, id); }
  @Post() publish(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Body() body: unknown) { return this.dates.publish(req.authUser, school, body); }
  @Post(":id/correct") correct(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string, @Body() body: unknown) { return this.dates.correct(req.authUser, school, id, body); }
  @Post(":id/cancel") cancel(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string, @Body() body: unknown) { return this.dates.cancel(req.authUser, school, id, body); }
}
