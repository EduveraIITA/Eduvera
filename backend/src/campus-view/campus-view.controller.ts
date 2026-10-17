import { Controller, Get, Param, Optional, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { CampusViewKpiService } from "./campus-view-kpi.service.js";
import { CampusViewService } from "./campus-view.service.js";

@Controller("api/v1/schools/:schoolId/campus-view")
export class CampusViewController {
  constructor(
    private readonly campusView: CampusViewService,
    @Optional() private readonly campusKpis?: CampusViewKpiService,
  ) {}

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
