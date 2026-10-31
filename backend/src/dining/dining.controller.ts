import {
  Controller,
  Get,
  Post,
  Req,
  Param,
  Query,
  HttpCode,
} from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedRequest } from "../common/request.js";
import { DiningService } from "./dining.service.js";
@Controller("api/v1/schools/:schoolId/dining")
export class DiningController {
  constructor(private readonly dining: DiningService) {}
  @Post("plans/:id/recover") @HttpCode(200) recoverPlan(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
  ) {
    return this.dining.recoverPlan(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      r.body,
    );
  }
  @Get("availability") availability(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Query() q: Record<string, string>,
  ) {
    return this.dining.availability(r.authUser, z.uuid().parse(s), q);
  }
  @Post("plans") @HttpCode(200) savePlan(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
  ) {
    return this.dining.savePlan(r.authUser, z.uuid().parse(s), r.body);
  }
  @Get("plans") plans(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Query() q: Record<string, string>,
  ) {
    return this.dining.plans(r.authUser, z.uuid().parse(s), q);
  }
  @Get("plans/:id") plan(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
    @Query() q: Record<string, string>,
  ) {
    return this.dining.plan(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      q,
    );
  }
  @Post("plans/:id/publish") @HttpCode(200) publishPlan(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
  ) {
    return this.dining.publishPlan(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      r.body,
    );
  }
  @Post("plans/:id/revise") @HttpCode(200) revisePlan(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
  ) {
    return this.dining.revisePlan(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      r.body,
    );
  }
  @Post("plans/:id/stop") @HttpCode(200) stopPlan(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
  ) {
    return this.dining.stopPlan(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      r.body,
    );
  }
  @Get("plans/:id/preview") preview(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
    @Query() q: Record<string, string>,
  ) {
    return this.dining.planOccurrences(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      q,
      true,
    );
  }
  @Get("plans/:id/occurrences") occurrences(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
    @Query() q: Record<string, string>,
  ) {
    return this.dining.planOccurrences(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      q,
    );
  }
  @Get("plans/:series/dates/:date") planDate(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("series") series: string,
    @Param("date") date: string,
  ) {
    return this.dining.planDate(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(series),
      date,
    );
  }
  @Post("plans/:series/dates/:date/actions") @HttpCode(200) actPlanDate(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("series") series: string,
    @Param("date") date: string,
  ) {
    return this.dining.actPlanDate(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(series),
      date,
      r.body,
    );
  }
  @Get("workspace") workspace(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Query() q: Record<string, string>,
  ) {
    return this.dining.workspace(r.authUser, z.uuid().parse(s), q);
  }
  @Get("options") options(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Query() q: Record<string, string>,
  ) {
    return this.dining.options(r.authUser, z.uuid().parse(s), q);
  }
  @Post("services") @HttpCode(200) saveService(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
  ) {
    return this.dining.saveService(r.authUser, z.uuid().parse(s), r.body);
  }
  @Get("services/:id") service(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
    @Query() q: Record<string, string>,
  ) {
    return this.dining.service(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      q,
    );
  }
  @Post("sessions") @HttpCode(200) createSession(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
  ) {
    return this.dining.createSession(r.authUser, z.uuid().parse(s), r.body);
  }
  @Get("sessions/:id") detail(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
    @Query() q: Record<string, string>,
  ) {
    return this.dining.detail(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      q,
    );
  }
  @Post("sessions/:id/actions") @HttpCode(200) act(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
  ) {
    return this.dining.act(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      r.body,
    );
  }
  @Post("sessions/:id/issues") @HttpCode(200) reportIssue(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
  ) {
    return this.dining.reportIssue(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      r.body,
    );
  }
  @Get("issues/:id") issue(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
    @Query() q: Record<string, string>,
  ) {
    return this.dining.issueDetail(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      q,
    );
  }
  @Post("issues/:id/actions") @HttpCode(200) actIssue(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Param("id") id: string,
  ) {
    return this.dining.actIssue(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      r.body,
    );
  }
  @Get("confirmation") confirmation(
    @Req() r: AuthenticatedRequest,
    @Param("schoolId") s: string,
    @Query("source_id") id: string,
    @Query("command_id") command: string,
  ) {
    return this.dining.confirmation(
      r.authUser,
      z.uuid().parse(s),
      z.uuid().parse(id),
      z.uuid().parse(command),
    );
  }
}
