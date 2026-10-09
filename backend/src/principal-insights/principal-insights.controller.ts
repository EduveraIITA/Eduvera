import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../common/request.js";
import { PrincipalInsightsService } from "./principal-insights.service.js";

@Controller("api/v1/schools/:schoolId/principal-insights")
export class PrincipalInsightsController {
  constructor(private readonly insights: PrincipalInsightsService) {}
  @Get('review')
  review(@Req() request:AuthenticatedRequest,@Param('schoolId') schoolId:string,@Query() query:Record<string,unknown>,@Res({passthrough:true}) reply:FastifyReply) {
    reply.header('Cache-Control','private, no-store');
    return this.insights.review(request.authUser,schoolId,query);
  }

  @Get()
  get(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string,
    @Query() query: Record<string, unknown>, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("Cache-Control", "private, no-store");
    return this.insights.overview(request.authUser, schoolId, query);
  }
}
