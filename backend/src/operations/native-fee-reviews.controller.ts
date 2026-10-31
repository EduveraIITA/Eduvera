import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { NativeFeeReviewsService } from "./native-fee-reviews.service.js";

@Controller("api/v1/schools/:schoolId/fees")
export class NativeFeeReviewsController {
  constructor(private readonly reviews: NativeFeeReviewsService) {}
  private writable(req: AuthenticatedRequest) {
    const world = req.executionEnvironmentView;
    if (world?.mode === "simulation" && (world.unavailable || ["completed", "stopped"].includes(world.run_status ?? "")))
      throw new ForbiddenException("This Simulation is read-only. Return to a working world before changing fee work.");
  }
  @Get("payment-reviews/workspace/")
  workspace(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query("invoice_id") invoiceId?: string,
    @Query("student_id") studentId?: string, @Query("person_id") personId?: string, @Query("command_id") commandId?: string) {
    return this.reviews.workspace(req.authUser, schoolId, { ...(invoiceId ? { invoice_id: invoiceId } : {}), ...(studentId ? { student_id: studentId } : {}),
      ...(personId ? { person_id: personId } : {}), ...(commandId ? { command_id: commandId } : {}) });
  }
  @Post("invoices/:invoiceId/payment-reviews/") @HttpCode(200)
  report(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("invoiceId") invoiceId: string, @Body() body: unknown) {
    this.writable(req); return this.reviews.report(req.authUser, schoolId, invoiceId, body);
  }
  @Post("payment-reviews/:reviewId/decision/") @HttpCode(200)
  decide(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("reviewId") reviewId: string, @Body() body: unknown) {
    this.writable(req); return this.reviews.decide(req.authUser, schoolId, reviewId, body);
  }
  @Post("payment-reviews/:reviewId/withdraw/") @HttpCode(200)
  withdraw(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("reviewId") reviewId: string, @Body() body: unknown) {
    this.writable(req); return this.reviews.withdraw(req.authUser, schoolId, reviewId, body);
  }
  @Get("payment-reviews/:reviewId/recovery/")
  recovery(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("reviewId") reviewId: string, @Query("command_id") commandId?: string) {
    return this.reviews.recovery(req.authUser, schoolId, reviewId, commandId);
  }
}
