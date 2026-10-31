import { Controller, Get, Param, Optional, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { CampusViewKpiService } from "./campus-view-kpi.service.js";
import { CampusViewService } from "./campus-view.service.js";
import { CampusPersonalService } from "./campus-personal.service.js";
import { CampusOperationsService } from "./campus-operations.service.js";

@Controller("api/v1/schools/:schoolId/campus-view")
export class CampusViewController {
  constructor(
    private readonly campusView: CampusViewService,
    @Optional() private readonly campusKpis?: CampusViewKpiService,
    @Optional() private readonly personal?: CampusPersonalService,
    @Optional() private readonly operations?: CampusOperationsService,
  ) {}

  @Get('/operations')
  operationsView(@Req() request: AuthenticatedRequest, @Param('schoolId') schoolId: string, @Query() query: Record<string,string>) {
    if(!this.operations)throw new Error('Campus asset and activity context is unavailable.');
    return this.operations.view(request.authUser,schoolId,query);
  }

  @Get("/mine")
  mine(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query() query: Record<string, string>) {
    if (!this.personal) throw new Error("Personal campus context is unavailable.");
    return this.personal.mine(request.authUser, schoolId, query);
  }

  @Get("/")
  view(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Query("campus_id") campusId?: string,
    @Query("at") at?: string,
  ) {
    return this.campusView.view(request.authUser, schoolId, {
      ...(campusId ? { campus_id: campusId } : {}),
      ...(at ? { at } : {}),
    });
  }

  @Get("/kpis")
  kpis(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Query("campus_id") campusId?: string,
    @Query("page") page?: string,
    @Query("range") range?: string,
    @Query("at") at?: string,
  ) {
    if (!this.campusKpis) throw new Error("Campus KPI service is unavailable.");
    return this.campusKpis.view(request.authUser, schoolId, {
      ...(campusId ? { campus_id: campusId } : {}),
      ...(page ? { page } : {}),
      ...(range ? { range } : {}),
      ...(at ? { at } : {}),
    });
  }
}
