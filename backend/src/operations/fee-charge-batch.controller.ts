import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { FeeChargeBatchService } from "./fee-charge-batch.service.js";

@Controller("api/v1/schools/:schoolId/fees")
export class FeeChargeBatchController {
  constructor(private readonly batches: FeeChargeBatchService) {}
  @Get("charge-audience/") catalogue(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Query() query: Record<string, string>) { return this.batches.catalogue(req.authUser, school, query); }
  @Post("charge-audience/preview/") @HttpCode(200) preview(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.batches.preview(req.authUser, school, req.body); }
  @Post("charge-batches/") @HttpCode(201) issue(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.batches.issue(req.authUser, school, req.body); }
  @Get("charge-batches/:id/") detail(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.batches.detail(req.authUser, school, id); }
  @Get("charge-batches/:id/confirmation/") confirmation(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string, @Query("command_id") commandId: string) { return this.batches.confirmation(req.authUser, school, id, commandId); }
}
