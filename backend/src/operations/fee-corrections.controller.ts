import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { FeeCorrectionsService } from "./fee-corrections.service.js";
@Controller("api/v1/schools/:schoolId/fees")
export class FeeCorrectionsController {
  constructor(private readonly corrections: FeeCorrectionsService) {}
  @Post("corrections/preview/") @HttpCode(200) preview(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.corrections.preview(req.authUser, school, req.body); }
  @Post("corrections/") @HttpCode(200) apply(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string) { return this.corrections.apply(req.authUser, school, req.body); }
  @Get("corrections/:id/") detail(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.corrections.detail(req.authUser, school, id); }
  @Get("corrections/:id/confirmation/") confirmation(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string, @Query("command_id") command: string) { return this.corrections.confirmation(req.authUser, school, id, command); }
  @Post("payments/:id/correction-preview/") @HttpCode(200) paymentPreview(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.corrections.paymentPreview(req.authUser, school, id, req.body); }
  @Post("payments/:id/corrections/") @HttpCode(200) paymentApply(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.corrections.correctPayment(req.authUser, school, id, req.body); }
  @Get("payment-corrections/:id/") paymentDetail(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.corrections.paymentDetail(req.authUser, school, id); }
  @Get("payment-corrections/:id/confirmation/") paymentConfirmation(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string, @Query("command_id") command: string) { return this.corrections.paymentConfirmation(req.authUser, school, id, command); }
}
