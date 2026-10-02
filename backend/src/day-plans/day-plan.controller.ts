import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  HttpCode,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { DayPlanService } from "./day-plan.service.js";
@Controller("api/v1/day-plans")
export class DayPlanController {
  constructor(private readonly plans: DayPlanService) {}
  @Get("options") options(
    @Req() req: AuthenticatedRequest,
    @Query("school_id") school: string,
    @Query("date") date: string,
  ) {
    return this.plans.options(req.authUser, school, date);
  }
  @Get("teacher") teacher(
    @Req() req: AuthenticatedRequest,
    @Query("school_id") school: string,
    @Query("date") date: string,
  ) {
    return this.plans.teacher(req.authUser, school, date);
  }
  @Get("teacher/summary") teacherSummary(
    @Req() req: AuthenticatedRequest,
    @Query("school_id") school: string,
    @Query("start") start: string,
    @Query("end") end: string,
  ) {
    return this.plans.teacherSummary(req.authUser, school, start, end);
  }
  @Get("admin/summary") adminSummary(
    @Req() req: AuthenticatedRequest,
    @Query("school_id") school: string,
    @Query("start") start: string,
    @Query("end") end: string,
    @Query("class_section_id") classSectionId?: string,
  ) {
    return this.plans.adminSummary(
      req.authUser,
      school,
      start,
      end,
      classSectionId,
    );
  }
  @Get(":id") detail(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("school_id") school: string,
  ) {
    return this.plans.detail(req.authUser, id, school);
  }
  @Post() @HttpCode(200) start(@Req() req: AuthenticatedRequest) {
    return this.plans.start(req, req.body);
  }
  @Post(":id/save") @HttpCode(200) save(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.plans.save(req, id, req.body);
  }
  @Post(":id/publish") @HttpCode(200) publish(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.plans.publish(req, id, req.body);
  }
  @Post(":id/discard") @HttpCode(200) discard(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.plans.discard(req, id, req.body);
  }
  @Post("periods/:id/respond") @HttpCode(200) respond(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.plans.respond(req, id, req.body);
  }
}
