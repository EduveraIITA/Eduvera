import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { RequirePermission } from "../roles/permissions.js";
import { DepartureCoordinationService } from "./departure-coordination.service.js";

@Controller("api/v1/departure")
export class DepartureCoordinationController {
  constructor(private readonly service: DepartureCoordinationService) {}

  @Get("family/")
  family(@Req() req:AuthenticatedRequest,@Query("student_id") studentId?:string) { return this.service.family(req.authUser,studentId); }

  @Post("family/requests/")
  request(@Req() req:AuthenticatedRequest,@Body() body:unknown) { return this.service.requestChange(req.authUser,body); }

  @Get("schools/:schoolId/workspace/")
  @RequirePermission("departure.manage")
  workspace(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string) { return this.service.workspace(req.authUser,schoolId); }

  @Patch("schools/:schoolId/policy/")
  @RequirePermission("departure.manage")
  policy(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Body() body:unknown) { return this.service.savePolicy(req.authUser,schoolId,body); }

  @Post("schools/:schoolId/routes/")
  @RequirePermission("departure.manage")
  route(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Body() body:unknown) { return this.service.createRoute(req.authUser,schoolId,body); }

  @Post("schools/:schoolId/assignments/")
  @RequirePermission("departure.manage")
  assignment(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Body() body:unknown) { return this.service.assignStudent(req.authUser,schoolId,body); }

  @Post("schools/:schoolId/trips/")
  @RequirePermission("departure.manage")
  trip(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Body() body:unknown) { return this.service.createTrip(req.authUser,schoolId,body); }

  @Post("schools/:schoolId/service-patterns/")
  @RequirePermission("departure.manage")
  servicePattern(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Body() body:unknown) { return this.service.createServicePattern(req.authUser,schoolId,body); }

  @Post("schools/:schoolId/trips/generate/")
  @RequirePermission("departure.manage")
  generateTrips(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Body() body:unknown) { return this.service.generateTrips(req.authUser,schoolId,body); }

  @Post("schools/:schoolId/trips/:tripId/roster/refresh/")
  @RequirePermission("departure.manage")
  refreshTripRoster(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("tripId") tripId:string,@Body() body:unknown) { return this.service.refreshTripRoster(req.authUser,schoolId,tripId,body); }

  @Post("schools/:schoolId/trips/:tripId/assignment/")
  @RequirePermission("departure.manage")
  assignTripCollector(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("tripId") tripId:string,@Body() body:unknown) { return this.service.assignTripCollector(req.authUser,schoolId,tripId,body); }

  @Post("schools/:schoolId/duty-swaps/:swapId/decision/")
  @RequirePermission("departure.manage")
  decideDutySwap(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("swapId") swapId:string,@Body() body:unknown) { return this.service.decideDutySwap(req.authUser,schoolId,swapId,body); }

  @Post("schools/:schoolId/authorities/")
  @RequirePermission("departure.manage")
  authority(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Body() body:unknown) { return this.service.createAuthority(req.authUser,schoolId,body); }

  @Post("schools/:schoolId/authorities/:authorityId/revoke/")
  @RequirePermission("departure.manage")
  revokeAuthority(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("authorityId") authorityId:string,@Body() body:unknown) { return this.service.revokeAuthority(req.authUser,schoolId,authorityId,body); }

  @Post("schools/:schoolId/plans/")
  @RequirePermission("departure.manage")
  plan(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Body() body:unknown) { return this.service.createPlan(req.authUser,schoolId,body); }

  @Post("schools/:schoolId/requests/")
  @RequirePermission("departure.manage")
  officeRequest(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Body() body:unknown) { return this.service.recordOfficeRequest(req.authUser,schoolId,body); }

  @Post("schools/:schoolId/requests/:requestId/decision/")
  @RequirePermission("departure.manage")
  decision(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("requestId") requestId:string,@Body() body:unknown) { return this.service.decideRequest(req.authUser,schoolId,requestId,body); }

  @Post("schools/:schoolId/plans/:planId/handover/")
  @RequirePermission("departure.manage")
  handover(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("planId") planId:string,@Body() body:unknown) { return this.service.recordHandover(req.authUser,schoolId,planId,body); }

  @Post("schools/:schoolId/plans/:planId/actions/:action/")
  @RequirePermission("departure.manage")
  planAction(@Req() req:AuthenticatedRequest,@Param("schoolId") schoolId:string,@Param("planId") planId:string,@Param("action") action:string,@Body() body:unknown) { return this.service.planAction(req.authUser,schoolId,planId,action,body); }

  @Get("collector/")
  @RequirePermission("departure.collect")
  collector(@Req() req:AuthenticatedRequest) { return this.service.collectorWorkspace(req.authUser); }

  @Post("collector/duty-swaps/")
  @RequirePermission("departure.collect")
  requestDutySwap(@Req() req:AuthenticatedRequest,@Body() body:unknown) { return this.service.requestDutySwap(req.authUser,body); }

  @Post("collector/duty-swaps/:swapId/respond/")
  @RequirePermission("departure.collect")
  respondDutySwap(@Req() req:AuthenticatedRequest,@Param("swapId") swapId:string,@Body() body:unknown) { return this.service.respondDutySwap(req.authUser,swapId,body); }

  @Post("trips/:tripId/actions/:action/")
  @RequirePermission("departure.collect")
  tripAction(@Req() req:AuthenticatedRequest,@Param("tripId") tripId:string,@Param("action") action:string,@Body() body:unknown) { return this.service.tripAction(req.authUser,tripId,action,body); }

  @Post("trips/:tripId/location/")
  @RequirePermission("departure.collect")
  location(@Req() req:AuthenticatedRequest,@Param("tripId") tripId:string,@Body() body:unknown) { return this.service.recordLocation(req.authUser,tripId,body); }

  @Post("trips/:tripId/riders/:studentId/")
  @RequirePermission("departure.collect")
  rider(@Req() req:AuthenticatedRequest,@Param("tripId") tripId:string,@Param("studentId") studentId:string,@Body() body:unknown) { return this.service.recordRider(req.authUser,tripId,studentId,body); }
}
